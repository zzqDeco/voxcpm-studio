package demoapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gorilla/websocket"
)

const (
	busyStateIdle = "idle"
)

type DemoAPI struct {
	settings        Settings
	storage         *DemoStorage
	taskMu          sync.Mutex
	busyState       map[string]any
	activeModelData *map[string]any
	worker          *WorkerClient
}

var wsUpgrader = websocket.Upgrader{CheckOrigin: func(_ *http.Request) bool { return true }}

func NewDemoAPI(settings Settings) (*DemoAPI, error) {
	dbPath := filepath.Join(settings.DataDir, "demo.sqlite3")
	storage, err := NewDemoStorage(dbPath)
	if err != nil {
		return nil, err
	}
	return &DemoAPI{
		settings:  settings,
		storage:   storage,
		busyState: map[string]any{"kind": busyStateIdle, "task_id": nil, "started_at": nil},
		worker:    NewWorkerClient(settings),
	}, nil
}

func (a *DemoAPI) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(a.cors)
	r.Use(middleware.Recoverer)

	r.Get("/api/health", a.handleHealth)
	r.Get("/api/runtime", a.handleRuntime)
	r.Get("/api/models", a.handleModels)
	r.Post("/api/models/load", a.handleLoadModel)
	r.Post("/api/infer/run", a.handleInferRun)
	r.Post("/api/infer/stream", a.handleInferStream)
	r.Get("/api/ws/infer-stream", a.handleInferStreamWS)
	r.Post("/api/asr/transcribe", a.handleASRTranscribe)
	r.Get("/api/runs", a.handleListRuns)
	r.Get("/api/runs/{run_id}", a.handleGetRun)
	r.Post("/api/bench/run", a.handleNotImplemented("bench run"))
	r.Get("/api/bench/{job_id}", a.handleNotImplemented("bench status"))
	r.Post("/api/train/start", a.handleNotImplemented("train start"))
	r.Post("/api/train/stop", a.handleNotImplemented("train stop"))
	r.Get("/api/train/status", a.handleNotImplemented("train status"))
	r.Get("/api/train/logs", a.handleNotImplemented("train logs"))
	r.Get("/api/checkpoints", a.handleCheckpoints)

	r.Route(a.settings.ArtifactsMount, func(rr chi.Router) {
		fs := http.FileServer(http.Dir(a.settings.DataDir))
		rr.Handle("/*", fs)
	})

	return r
}

func (a *DemoAPI) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (a *DemoAPI) handleRuntime(w http.ResponseWriter, _ *http.Request) {
	defaultDevice := a.resolveDevice(a.settings.DefaultDevice)
	caps := a.deviceCapabilities()
	runtime := map[string]any{
		"device":                 defaultDevice,
		"available_devices":      availableDevices(defaultDevice),
		"run_mode":               a.settings.RunMode,
		"supports_training":      supportsTraining(defaultDevice),
		"supports_mps_training":  hasMPS(),
		"supports_amp_training":  supportsAMP(defaultDevice),
		"default_precision_mode": resolvePrecisionMode(a.settings.DefaultPrecision, defaultDevice),
		"device_capabilities":    caps,
		"active_model":           a.getActiveModel(),
		"busy_state":             a.getBusyState(),
		"sensevoice_device":      a.resolveSenseVoice(defaultDevice),
		"asr_available":          false,
	}
	writeJSON(w, http.StatusOK, runtime)
}

func (a *DemoAPI) getActiveModel() map[string]any {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	if a.activeModelData == nil {
		return nil
	}
	return *a.activeModelData
}

func (a *DemoAPI) handleModels(w http.ResponseWriter, _ *http.Request) {
	models, err := a.scanModels()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan models failed", err)
		return
	}
	checkpoints, err := a.scanLoraCheckpoints()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan checkpoints failed", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"models":           models,
		"lora_checkpoints": checkpoints,
	})
}

func (a *DemoAPI) handleCheckpoints(w http.ResponseWriter, _ *http.Request) {
	checkpoints, err := a.scanLoraCheckpoints()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan checkpoints failed", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"checkpoints": checkpoints})
}

func (a *DemoAPI) handleLoadModel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ModelID string `json:"model_id"`
		Device  string `json:"device"`
		LoraID  string `json:"lora_checkpoint"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json", err)
		return
	}
	model := a.findModelByID(body.ModelID)
	if model == nil {
		writeError(w, http.StatusNotFound, "Model not found.", nil)
		return
	}
	a.taskMu.Lock()
	info := map[string]any{
		"id":                 model["id"],
		"label":              model["label"],
		"family":             model["family"],
		"architecture":       model["architecture"],
		"origin":             model["origin"],
		"path":               model["path"],
		"device":             a.resolveDeviceOrDefault(body.Device),
		"active_lora":        nil,
		"loaded_at":          isoNow(),
		"lora_config_source": "default",
	}
	if body.LoraID != "" {
		info["active_lora"] = body.LoraID
		info["lora_config_source"] = body.LoraID
	}
	a.activeModelData = &info
	a.taskMu.Unlock()

	writeJSON(w, http.StatusOK, info)
}

func (a *DemoAPI) handleInferRun(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart", err)
		return
	}
	payload := map[string]any{
		"model_id":            r.FormValue("model_id"),
		"device":              r.FormValue("device"),
		"mode":                r.FormValue("mode"),
		"text":                r.FormValue("text"),
		"control_instruction": r.FormValue("control_instruction"),
		"prompt_text":         r.FormValue("prompt_text"),
		"normalize":           parseBool(r.FormValue("normalize"), false),
		"denoise":             parseBool(r.FormValue("denoise"), false),
		"cfg_value":           parseFloat(r.FormValue("cfg_value"), 2.0),
		"inference_timesteps": parseInt(r.FormValue("inference_timesteps"), 10),
		"lora_checkpoint":     r.FormValue("lora_checkpoint"),
		"streaming":           true,
	}
	if payload["lora_checkpoint"] == nil || payload["lora_checkpoint"] == "" {
		payload["lora_checkpoint"] = nil
	}
	referenceAudio, referenceHeader, err := r.FormFile("reference_audio")
	if err != nil && err != http.ErrMissingFile {
		writeError(w, http.StatusBadRequest, "invalid reference_audio", err)
		return
	}
	if referenceAudio != nil {
		defer func() { _ = referenceAudio.Close() }()
		referencePath, err := saveUploadedFile(referenceAudio, referenceHeader.Filename)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save reference audio", err)
			return
		}
		defer func() { _ = os.Remove(referencePath) }()
		payload["reference_audio_path"] = referencePath
	}

	taskID := a.newTaskID("inference")
	if err := a.setBusy(taskID, "inference"); err != nil {
		writeError(w, http.StatusConflict, "Runtime is busy", err)
		return
	}
	cleanupTaskID := taskID
	defer func() {
		a.clearBusy(cleanupTaskID)
	}()

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	record, err := a.worker.RunJSON(ctx, "infer", payload)
	if err != nil {
		writeError(w, http.StatusBadGateway, "python worker failed", err)
		return
	}
	a.persistActiveModel(
		readString(payload["model_id"], ""),
		readString(payload["device"], "auto"),
		payload["lora_checkpoint"],
	)
	if runID, ok := record["id"].(string); ok {
		a.taskMu.Lock()
		a.busyState["task_id"] = runID
		a.taskMu.Unlock()
		cleanupTaskID = runID
	}
	if _, err := a.storage.SaveRun(record); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist run", err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) handleInferStream(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart", err)
		return
	}
	payload := map[string]any{
		"model_id":            r.FormValue("model_id"),
		"device":              r.FormValue("device"),
		"mode":                r.FormValue("mode"),
		"text":                r.FormValue("text"),
		"control_instruction": r.FormValue("control_instruction"),
		"prompt_text":         r.FormValue("prompt_text"),
		"normalize":           parseBool(r.FormValue("normalize"), false),
		"denoise":             parseBool(r.FormValue("denoise"), false),
		"cfg_value":           parseFloat(r.FormValue("cfg_value"), 2.0),
		"inference_timesteps": parseInt(r.FormValue("inference_timesteps"), 10),
		"lora_checkpoint":     r.FormValue("lora_checkpoint"),
	}
	if payload["lora_checkpoint"] == nil || payload["lora_checkpoint"] == "" {
		payload["lora_checkpoint"] = nil
	}
	referenceAudio, referenceHeader, err := r.FormFile("reference_audio")
	if err != nil && err != http.ErrMissingFile {
		writeError(w, http.StatusBadRequest, "invalid reference_audio", err)
		return
	}
	if referenceAudio != nil {
		defer func() { _ = referenceAudio.Close() }()
		referencePath, err := saveUploadedFile(referenceAudio, referenceHeader.Filename)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save reference audio", err)
			return
		}
		defer func() { _ = os.Remove(referencePath) }()
		payload["reference_audio_path"] = referencePath
	}

	taskID := a.newTaskID("streaming")
	if err := a.setBusy(taskID, "streaming"); err != nil {
		writeError(w, http.StatusConflict, "Runtime is busy", err)
		return
	}
	cleanupTaskID := taskID
	defer func() {
		a.clearBusy(cleanupTaskID)
	}()

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	record, err := a.worker.RunJSON(ctx, "infer", payload)
	if err != nil {
		writeError(w, http.StatusBadGateway, "python worker failed", err)
		return
	}
	a.persistActiveModel(
		readString(payload["model_id"], ""),
		readString(payload["device"], "auto"),
		payload["lora_checkpoint"],
	)
	if _, err := a.storage.SaveRun(record); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist run", err)
		return
	}
	if runID, ok := record["id"].(string); ok {
		cleanupTaskID = runID
		a.taskMu.Lock()
		a.busyState["task_id"] = runID
		a.taskMu.Unlock()
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) handleInferStreamWS(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() {
		_ = conn.Close()
	}()
	_, data, err := conn.ReadMessage()
	if err != nil {
		_ = conn.WriteJSON(map[string]any{"event": "error", "detail": "invalid websocket payload"})
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(bytes.NewReader(data)).Decode(&payload); err != nil {
		_ = conn.WriteJSON(map[string]any{"event": "error", "detail": "invalid json payload"})
		return
	}
	if _, ok := payload["model_id"]; !ok {
		_ = conn.WriteJSON(map[string]any{"event": "error", "detail": "model_id is required"})
		return
	}

	if payload["lora_checkpoint"] == nil || payload["lora_checkpoint"] == "" {
		payload["lora_checkpoint"] = nil
	}

	taskID := a.newTaskID("streaming")
	if err := a.setBusy(taskID, "streaming"); err != nil {
		_ = conn.WriteJSON(map[string]any{"event": "error", "detail": "Runtime is busy"})
		return
	}

	deferred := false
	defer func() {
		if !deferred {
			a.clearBusy(taskID)
		}
	}()

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Minute)
	defer cancel()
	record, err := a.worker.StreamJSON(ctx, payload, func(event map[string]any) error {
		if err := conn.WriteJSON(event); err != nil {
			return err
		}
		if event["event"] == "completed" || event["event"] == "error" {
			deferred = true
			_ = conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(time.Second))
			a.clearBusy(taskID)
		}
		return nil
	})
	if err != nil {
		_ = conn.WriteJSON(map[string]any{"event": "error", "detail": err.Error()})
		a.clearBusy(taskID)
		return
	}
	if record != nil {
		if _, err := a.storage.SaveRun(record); err != nil {
			_ = conn.WriteJSON(map[string]any{"event": "error", "detail": "failed to persist run"})
		}
	}
}

func (a *DemoAPI) handleASRTranscribe(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart", err)
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		if err == http.ErrMissingFile {
			writeError(w, http.StatusBadRequest, "file is required", err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid file upload", err)
		return
	}
	defer func() { _ = file.Close() }()

	path, err := saveUploadedFile(file, "asr.wav")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist file", err)
		return
	}
	defer func() { _ = os.Remove(path) }()

	payload := map[string]any{
		"file_path": path,
		"device":    r.FormValue("device"),
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	text, err := a.worker.RunJSON(ctx, "transcribe", payload)
	if err != nil {
		writeError(w, http.StatusBadGateway, "python worker failed", err)
		return
	}
	writeJSON(w, http.StatusOK, text)
}

func (a *DemoAPI) handleListRuns(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	records, err := a.storage.ListRuns(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list runs failed", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": records})
}

func (a *DemoAPI) handleGetRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "run_id")
	record, ok, err := a.storage.GetRun(runID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get run failed", err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "Run '"+runID+"' not found.", nil)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) handleNotImplemented(feature string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotImplemented, feature+" is not yet migrated to Go backend.", nil)
	}
}

func (a *DemoAPI) resolveDevice(requested string) string {
	candidate := strings.TrimSpace(requested)
	if candidate == "" || candidate == "auto" {
		candidate = a.settings.DefaultDevice
	}
	if candidate == "" || candidate == "auto" {
		return "cpu"
	}
	return candidate
}

func (a *DemoAPI) resolveDeviceOrDefault(requested string) string {
	if strings.TrimSpace(requested) == "" || requested == "auto" {
		return a.resolveDevice(a.settings.DefaultDevice)
	}
	return requested
}

func (a *DemoAPI) resolveSenseVoice(targetDevice string) string {
	if a.settings.SenseVoiceDevice != "auto" {
		return a.settings.SenseVoiceDevice
	}
	if strings.HasPrefix(targetDevice, "cuda") {
		return "cuda:0"
	}
	return "cpu"
}

func (a *DemoAPI) getBusyState() map[string]any {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	return map[string]any{
		"kind":       a.busyState["kind"],
		"task_id":    a.busyState["task_id"],
		"started_at": a.busyState["started_at"],
	}
}

func (a *DemoAPI) scanModels() ([]map[string]any, error) {
	discovered := map[string]map[string]any{}
	for _, root := range []struct {
		Path   string
		Origin string
	}{
		{a.settings.ModelsDir, "models"},
		{filepath.Join(a.settings.DataDir, "training"), "training"},
	} {
		configs, err := listFilesByName(root.Path, "config.json")
		if err != nil {
			continue
		}
		for _, configPath := range configs {
			modelDir := filepath.Dir(configPath)
			if !fileExists(filepath.Join(modelDir, "model.safetensors")) && !fileExists(filepath.Join(modelDir, "pytorch_model.bin")) {
				continue
			}
			rel := filepath.Base(modelDir)
			if relPath, err := filepath.Rel(root.Path, modelDir); err == nil {
				rel = relPath
			}
			modelID := rel
			if root.Origin == "training" {
				modelID = filepath.ToSlash(filepath.Join("training", rel))
			}
			if modelID == "." {
				modelID = filepath.Base(modelDir)
			}
			arch := "voxcpm"
			configBytes, err := os.ReadFile(configPath)
			if err == nil {
				var raw map[string]any
				if err := json.Unmarshal(configBytes, &raw); err == nil {
					if rawArch, ok := raw["architecture"].(string); ok {
						arch = strings.ToLower(rawArch)
					}
				}
			}
			entry := map[string]any{
				"id":           modelID,
				"label":        modelID,
				"family":       inferFamily(modelDir, arch),
				"architecture": arch,
				"origin":       root.Origin,
				"path":         modelDir,
				"capabilities": modelCapabilities(arch),
			}
			discovered[modelID] = entry
		}
	}
	out := make([]map[string]any, 0, len(discovered))
	for _, item := range discovered {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i]["label"].(string)) < strings.ToLower(out[j]["label"].(string))
	})
	return out, nil
}

func (a *DemoAPI) scanLoraCheckpoints() ([]map[string]any, error) {
	checkpoints := map[string]map[string]any{}
	roots := []struct {
		Path   string
		Origin string
	}{
		{a.settings.LoraDir, "lora"},
		{filepath.Join(a.settings.DataDir, "training"), "training"},
	}
	for _, root := range roots {
		for _, name := range []string{"lora_weights.safetensors", "lora_weights.ckpt"} {
			paths, err := listFilesByName(root.Path, name)
			if err != nil {
				continue
			}
			for _, path := range paths {
				checkpointDir := filepath.Dir(path)
				rel, err := filepath.Rel(root.Path, checkpointDir)
				if err != nil {
					continue
				}
				checkpointID := filepath.ToSlash(rel)
				if root.Origin == "training" {
					checkpointID = filepath.ToSlash(filepath.Join("training", rel))
				}
				entry := map[string]any{
					"id":         checkpointID,
					"label":      checkpointID,
					"path":       checkpointDir,
					"origin":     root.Origin,
					"base_model": nil,
				}
				if configBytes, err := os.ReadFile(filepath.Join(checkpointDir, "lora_config.json")); err == nil {
					var raw map[string]any
					if err := json.Unmarshal(configBytes, &raw); err == nil {
						entry["base_model"] = raw["base_model"]
					}
				}
				checkpoints[checkpointID] = entry
			}
		}
	}
	out := make([]map[string]any, 0, len(checkpoints))
	for _, item := range checkpoints {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i]["label"].(string)) < strings.ToLower(out[j]["label"].(string))
	})
	return out, nil
}

func (a *DemoAPI) findModelByID(modelID string) map[string]any {
	models, _ := a.scanModels()
	for _, model := range models {
		if model["id"] == modelID {
			return model
		}
	}
	return nil
}

func (a *DemoAPI) deviceCapabilities() map[string]map[string]any {
	capabilities := map[string]map[string]any{}
	for _, device := range a.availableDevices() {
		capabilities[device] = map[string]any{
			"supports_training":          supportsTraining(device),
			"supports_amp_training":      supportsAMP(device),
			"recommended_precision_mode": resolvePrecisionMode("", device),
		}
	}
	return capabilities
}

func (a *DemoAPI) availableDevices() []string {
	return availableDevices(a.settings.DefaultDevice)
}

func supportsTraining(device string) bool {
	switch {
	case strings.HasPrefix(device, "cuda"):
		return true
	case device == "mps":
		return true
	default:
		return false
	}
}

func supportsAMP(device string) bool {
	return strings.HasPrefix(device, "cuda")
}

func resolvePrecisionMode(mode string, device string) string {
	requested := strings.ToLower(strings.TrimSpace(mode))
	if requested == "amp" || requested == "fp32" {
		return requested
	}
	if requested == "auto" || requested == "" {
		if strings.HasPrefix(device, "cuda") {
			return "amp"
		}
		return "fp32"
	}
	return "fp32"
}

func inferFamily(modelDir string, arch string) string {
	lowerDir := strings.ToLower(filepath.Base(modelDir))
	if arch == "voxcpm2" {
		return "VoxCPM2"
	}
	if strings.Contains(lowerDir, "1.5") {
		return "VoxCPM1.5"
	}
	if strings.Contains(lowerDir, "0.5") || strings.Contains(lowerDir, "0_5") {
		return "VoxCPM-0.5B"
	}
	return "VoxCPM"
}

func modelCapabilities(arch string) map[string]any {
	return map[string]any{
		"supports_reference_audio": arch == "voxcpm2",
		"supports_prompt_text":     true,
		"supports_voice_design":    arch == "voxcpm2",
		"supports_streaming":       true,
		"supports_lora":            true,
		"supports_full_ft":         true,
	}
}

func availableDevices(requested string) []string {
	requested = strings.ToLower(strings.TrimSpace(requested))
	devices := []string{"cpu"}
	if strings.HasPrefix(requested, "cuda") {
		devices = append([]string{"cuda"}, devices...)
	}
	if requested == "mps" {
		devices = append([]string{"mps"}, devices...)
	}
	if requested == "auto" || requested == "" {
		devices = append([]string{"cuda", "mps"}, devices...)
	}
	return dedupeString(devices)
}

func hasMPS() bool {
	_, err := os.Stat("/opt/homebrew")
	return err == nil
}

func (a *DemoAPI) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	_ = enc.Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string, err error) {
	detail := message
	if err != nil {
		detail = message + ": " + err.Error()
	}
	writeJSON(w, status, map[string]any{"detail": detail})
}

func decodeJSON(r *http.Request, target any) error {
	defer func() {
		_ = r.Body.Close()
	}()
	return json.NewDecoder(r.Body).Decode(target)
}

func (a *DemoAPI) newTaskID(kind string) string {
	return kind + "-" + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
}

func (a *DemoAPI) setBusy(taskID string, kind string) error {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	if a.busyState["kind"] != busyStateIdle {
		return fmt.Errorf("runtime is currently %s", a.busyState["kind"])
	}
	a.busyState["kind"] = kind
	a.busyState["task_id"] = taskID
	a.busyState["started_at"] = isoNow()
	return nil
}

func (a *DemoAPI) clearBusy(taskID string) {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	if taskID == "" {
		a.busyState = map[string]any{"kind": busyStateIdle, "task_id": nil, "started_at": nil}
		return
	}
	if current, ok := a.busyState["task_id"].(string); ok && current != taskID {
		return
	}
	a.busyState = map[string]any{"kind": busyStateIdle, "task_id": nil, "started_at": nil}
}

func (a *DemoAPI) persistActiveModel(modelID string, device string, loraCheckpoint any) {
	if modelID == "" {
		return
	}
	model := a.findModelByID(modelID)
	if model == nil {
		return
	}
	active := map[string]any{
		"id":                 model["id"],
		"label":              model["label"],
		"family":             model["family"],
		"architecture":       model["architecture"],
		"origin":             model["origin"],
		"path":               model["path"],
		"device":             a.resolveDeviceOrDefault(device),
		"active_lora":        nil,
		"loaded_at":          isoNow(),
		"lora_config_source": "default",
	}
	if value, ok := loraCheckpoint.(string); ok && value != "" {
		active["active_lora"] = value
		active["lora_config_source"] = value
	}
	a.taskMu.Lock()
	a.activeModelData = &active
	a.taskMu.Unlock()
}

func parseBool(raw string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on", "y":
		return true
	case "0", "false", "off", "no", "n":
		return false
	}
	return fallback
}

func parseInt(raw string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return parsed
}

func parseFloat(raw string, fallback float64) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func readString(value any, fallback string) string {
	if text, ok := value.(string); ok {
		return text
	}
	return fallback
}

func saveUploadedFile(file multipart.File, filename string) (string, error) {
	if filename == "" {
		filename = "upload.bin"
	}
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".bin"
	}
	tmp, err := os.CreateTemp("", "demo-upload-*"+ext)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(tmp, file); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return "", err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}

func listFilesByName(root string, name string) ([]string, error) {
	if _, err := os.Stat(root); err != nil {
		return nil, err
	}
	paths := make([]string, 0)
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && filepath.Base(path) == name {
			paths = append(paths, path)
		}
		return nil
	})
	return paths, err
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func dedupeString(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func isoNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func mustLog(msg string, args ...any) {
	log.Printf(msg, args...)
}
