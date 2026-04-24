package demoapi

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

type trainingRunner struct {
	mu    sync.Mutex
	cmd   *exec.Cmd
	jobID string
}

func newTrainingRunner() *trainingRunner {
	return &trainingRunner{}
}

func (r *trainingRunner) set(jobID string, cmd *exec.Cmd) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.jobID = jobID
	r.cmd = cmd
}

func (r *trainingRunner) clear(jobID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.jobID != jobID {
		return
	}
	r.jobID = ""
	r.cmd = nil
}

func (r *trainingRunner) current() (string, *exec.Cmd) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.jobID, r.cmd
}

type trainingStartRequest struct {
	ModelID        string  `json:"model_id"`
	TrainingMode   string  `json:"training_mode"`
	Device         string  `json:"device"`
	PrecisionMode  string  `json:"precision_mode"`
	TrainManifest  string  `json:"train_manifest"`
	ValManifest    string  `json:"val_manifest"`
	LearningRate   float64 `json:"learning_rate"`
	BatchSize      int     `json:"batch_size"`
	NumIters       int     `json:"num_iters"`
	GradAccumSteps int     `json:"grad_accum_steps"`
	SaveInterval   int     `json:"save_interval"`
	LogInterval    int     `json:"log_interval"`
	ValidInterval  int     `json:"valid_interval"`
	NumWorkers     int     `json:"num_workers"`
	WeightDecay    float64 `json:"weight_decay"`
	WarmupSteps    int     `json:"warmup_steps"`
	MaxSteps       *int    `json:"max_steps"`
	MaxBatchTokens int     `json:"max_batch_tokens"`
	MaxGradNorm    float64 `json:"max_grad_norm"`
	CFGScale       float64 `json:"cfg_scale"`
	LoraRank       int     `json:"lora_rank"`
	LoraAlpha      int     `json:"lora_alpha"`
	LoraDropout    float64 `json:"lora_dropout"`
}

type benchRunRequest struct {
	ModelID        string   `json:"model_id"`
	Device         string   `json:"device"`
	Scenarios      []string `json:"scenarios"`
	LoraCheckpoint string   `json:"lora_checkpoint"`
}

func (r *trainingStartRequest) withDefaults() {
	if r.TrainingMode == "" {
		r.TrainingMode = "lora"
	}
	if r.Device == "" {
		r.Device = "auto"
	}
	if r.PrecisionMode == "" {
		r.PrecisionMode = "auto"
	}
	if r.LearningRate == 0 {
		r.LearningRate = 1e-4
	}
	if r.BatchSize == 0 {
		r.BatchSize = 1
	}
	if r.NumIters == 0 {
		r.NumIters = 1000
	}
	if r.GradAccumSteps == 0 {
		r.GradAccumSteps = 1
	}
	if r.SaveInterval == 0 {
		r.SaveInterval = 500
	}
	if r.LogInterval == 0 {
		r.LogInterval = 10
	}
	if r.ValidInterval == 0 {
		r.ValidInterval = 500
	}
	if r.NumWorkers == 0 {
		r.NumWorkers = 2
	}
	if r.WeightDecay == 0 {
		r.WeightDecay = 0.01
	}
	if r.WarmupSteps == 0 {
		r.WarmupSteps = 100
	}
	if r.MaxGradNorm == 0 {
		r.MaxGradNorm = 1.0
	}
	if r.CFGScale == 0 {
		r.CFGScale = 2.0
	}
	if r.LoraRank == 0 {
		r.LoraRank = 32
	}
	if r.LoraAlpha == 0 {
		r.LoraAlpha = 16
	}
}

func (a *DemoAPI) handleStartTraining(w http.ResponseWriter, r *http.Request) {
	var body trainingStartRequest
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json", err)
		return
	}
	body.withDefaults()

	model := a.findModelByID(body.ModelID)
	if model == nil {
		writeError(w, http.StatusNotFound, "Model not found.", nil)
		return
	}
	resolvedDevice := a.resolveDeviceOrDefault(body.Device)
	if resolvedDevice == "cpu" {
		writeError(w, http.StatusBadRequest, "Training is not supported on CPU.", nil)
		return
	}
	if !supportsTraining(resolvedDevice) {
		writeError(w, http.StatusBadRequest, "Training is not supported on device '"+resolvedDevice+"'.", nil)
		return
	}
	precision := resolvePrecisionMode(body.PrecisionMode, resolvedDevice)
	if resolvedDevice == "mps" && precision == "amp" && !supportsAMP("mps") {
		writeError(w, http.StatusBadRequest, "AMP training is not available on MPS in this environment.", nil)
		return
	}
	if body.TrainingMode != "lora" && body.TrainingMode != "full_ft" {
		writeError(w, http.StatusBadRequest, "training_mode must be lora or full_ft", nil)
		return
	}

	jobID := generateID("train")
	jobDir := filepath.Join(a.settings.DataDir, "training", jobID)
	checkpointsDir := filepath.Join(jobDir, "checkpoints")
	logsDir := filepath.Join(jobDir, "logs")
	if err := os.MkdirAll(checkpointsDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create checkpoint dir", err)
		return
	}
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create logs dir", err)
		return
	}

	configPath := filepath.Join(jobDir, "train_config.yaml")
	if err := writeTrainingConfig(configPath, model, body, resolvedDevice, precision, checkpointsDir, logsDir); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write training config", err)
		return
	}
	logPath := filepath.Join(logsDir, "train.log")
	command := []string{
		a.worker.python,
		filepath.Join(a.settings.RepoRoot, "scripts", "train_voxcpm_finetune.py"),
		"--config_path",
		configPath,
	}
	now := isoNow()
	record := map[string]any{
		"id":             jobID,
		"created_at":     now,
		"updated_at":     now,
		"training_mode":  body.TrainingMode,
		"model_id":       body.ModelID,
		"device":         resolvedDevice,
		"precision_mode": precision,
		"status":         "starting",
		"experimental":   resolvedDevice == "mps" && body.TrainingMode == "full_ft",
		"output_dir":     jobDir,
		"log_path":       logPath,
		"config_path":    configPath,
		"command":        command,
	}

	if err := a.setBusy(jobID, "training"); err != nil {
		writeError(w, http.StatusConflict, "Runtime is busy", err)
		return
	}

	cmd := exec.Command(command[0], command[1:]...)
	cmd.Dir = a.settings.RepoRoot
	cmd.Env = a.worker.envBase
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		a.clearBusy(jobID)
		writeError(w, http.StatusInternalServerError, "failed to attach training logs", err)
		return
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		a.clearBusy(jobID)
		writeError(w, http.StatusInternalServerError, "failed to start training", err)
		return
	}
	a.training.set(jobID, cmd)
	record["status"] = "running"
	record["updated_at"] = isoNow()
	if _, err := a.storage.SaveTrainingJob(record); err != nil {
		_ = cmd.Process.Kill()
		a.training.clear(jobID)
		a.clearBusy(jobID)
		writeError(w, http.StatusInternalServerError, "failed to persist training job", err)
		return
	}

	go a.watchTrainingJob(jobID, cmd, stdout, logPath, record)
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) watchTrainingJob(jobID string, cmd *exec.Cmd, stdout io.Reader, logPath string, fallback map[string]any) {
	status := "completed"
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			_, _ = logFile.WriteString(scanner.Text() + "\n")
		}
		_ = logFile.Close()
	} else {
		status = "failed"
	}
	if err := cmd.Wait(); err != nil {
		status = "failed"
	}
	record, ok, err := a.storage.GetTrainingJob(jobID)
	if err != nil || !ok {
		record = fallback
	}
	if record["status"] == "stopping" {
		status = "stopped"
	}
	record["updated_at"] = isoNow()
	record["status"] = status
	if status == "failed" && record["error"] == nil {
		record["error"] = "training process exited with non-zero status"
	}
	_, _ = a.storage.SaveTrainingJob(record)
	a.training.clear(jobID)
	a.clearBusy(jobID)
}

func (a *DemoAPI) handleStopTraining(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("job_id")
	currentID, cmd := a.training.current()
	if targetID == "" {
		targetID = currentID
	}
	if targetID == "" || cmd == nil {
		writeError(w, http.StatusNotFound, "No active training job.", nil)
		return
	}
	if currentID != targetID {
		writeError(w, http.StatusNotFound, "Training job '"+targetID+"' is not active.", nil)
		return
	}
	record, ok, err := a.storage.GetTrainingJob(targetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get training job failed", err)
		return
	}
	if !ok {
		record = map[string]any{"id": targetID}
	}
	record["updated_at"] = isoNow()
	record["status"] = "stopping"
	if _, err := a.storage.SaveTrainingJob(record); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist training job", err)
		return
	}
	if cmd.Process != nil {
		if err := cmd.Process.Signal(os.Interrupt); err != nil {
			_ = cmd.Process.Kill()
		}
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) handleTrainingStatus(w http.ResponseWriter, r *http.Request) {
	record, err := a.trainingStatus(r.URL.Query().Get("job_id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "training status failed", err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) handleTrainingLogs(w http.ResponseWriter, r *http.Request) {
	status, err := a.trainingStatus(r.URL.Query().Get("job_id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "training logs failed", err)
		return
	}
	jobID, _ := status["id"].(string)
	logPath, _ := status["log_path"].(string)
	if logPath == "" {
		writeJSON(w, http.StatusOK, map[string]any{"job_id": status["id"], "content": ""})
		return
	}
	content, err := os.ReadFile(logPath)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"job_id": jobID, "content": ""})
		return
	}
	if len(content) > 50000 {
		content = content[len(content)-50000:]
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": jobID, "content": string(content)})
}

func (a *DemoAPI) trainingStatus(jobID string) (map[string]any, error) {
	var (
		record map[string]any
		ok     bool
		err    error
	)
	if jobID != "" {
		record, ok, err = a.storage.GetTrainingJob(jobID)
	} else if currentID, _ := a.training.current(); currentID != "" {
		record, ok, err = a.storage.GetTrainingJob(currentID)
	} else {
		record, ok, err = a.storage.LatestTrainingJob()
	}
	if err != nil {
		return nil, err
	}
	if !ok {
		return map[string]any{
			"id":     nil,
			"status": "idle",
			"device": a.resolveDevice(a.settings.DefaultDevice),
			"busy":   a.getBusyState()["kind"] == "training",
		}, nil
	}
	busy := false
	if state := a.getBusyState(); state["kind"] == "training" && state["task_id"] == record["id"] {
		busy = true
	}
	record["busy"] = busy
	return record, nil
}

func (a *DemoAPI) handleStartBench(w http.ResponseWriter, r *http.Request) {
	var body benchRunRequest
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json", err)
		return
	}
	if body.Device == "" {
		body.Device = "auto"
	}
	model := a.findModelByID(body.ModelID)
	if model == nil {
		writeError(w, http.StatusNotFound, "Model not found.", nil)
		return
	}
	resolvedDevice := a.resolveDeviceOrDefault(body.Device)
	jobID := generateID("bench")
	now := isoNow()
	record := map[string]any{
		"id":         jobID,
		"created_at": now,
		"updated_at": now,
		"model_id":   body.ModelID,
		"device":     resolvedDevice,
		"status":     "running",
		"runs":       []map[string]any{},
		"skipped":    []map[string]any{},
	}
	if _, err := a.storage.SaveBenchJob(record); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to persist bench job", err)
		return
	}
	if err := a.setBusy(jobID, "bench"); err != nil {
		record["status"] = "failed"
		record["updated_at"] = isoNow()
		record["error"] = err.Error()
		_, _ = a.storage.SaveBenchJob(record)
		writeError(w, http.StatusConflict, "Runtime is busy", err)
		return
	}

	go a.runBenchJob(jobID, body, model, record)
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) handleGetBench(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "job_id")
	record, ok, err := a.storage.GetBenchJob(jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get bench job failed", err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "Bench job '"+jobID+"' not found.", nil)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (a *DemoAPI) runBenchJob(jobID string, request benchRunRequest, model map[string]any, record map[string]any) {
	defer a.clearBusy(jobID)
	scenarios := request.Scenarios
	if len(scenarios) == 0 {
		scenarios = []string{"design", "controlled_clone", "ultimate_clone", "streaming", "lora_compare"}
	}
	for _, scenario := range scenarios {
		runRecord, skip := a.runBenchScenario(request, model, scenario)
		if skip != nil {
			record["skipped"] = appendMap(record["skipped"], skip)
			record["updated_at"] = isoNow()
			_, _ = a.storage.SaveBenchJob(record)
			continue
		}
		if runRecord != nil {
			_, _ = a.storage.SaveRun(runRecord)
			entry := map[string]any{"scenario": scenario, "run_id": runRecord["id"]}
			if scenario == "lora_compare" {
				if request.LoraCheckpoint != "" {
					entry["lora_checkpoint"] = request.LoraCheckpoint
				} else if requestPayload, ok := runRecord["request"].(map[string]any); ok {
					if checkpoint, _ := requestPayload["lora_checkpoint"].(string); checkpoint != "" {
						entry["lora_checkpoint"] = checkpoint
					}
				}
			}
			record["runs"] = appendMap(record["runs"], entry)
			record["updated_at"] = isoNow()
			_, _ = a.storage.SaveBenchJob(record)
		}
	}
	record["status"] = "completed"
	record["updated_at"] = isoNow()
	_, _ = a.storage.SaveBenchJob(record)
}

func (a *DemoAPI) runBenchScenario(request benchRunRequest, model map[string]any, scenario string) (map[string]any, map[string]any) {
	capabilities, _ := model["capabilities"].(map[string]any)
	exampleAudio := filepath.Join(a.settings.RepoRoot, "examples", "reference_speaker.wav")
	payload := map[string]any{
		"model_id":            request.ModelID,
		"device":              a.resolveDeviceOrDefault(request.Device),
		"mode":                "design",
		"text":                "",
		"control_instruction": "",
		"prompt_text":         nil,
		"normalize":           false,
		"denoise":             false,
		"cfg_value":           2.0,
		"inference_timesteps": 10,
		"lora_checkpoint":     nil,
		"streaming":           false,
	}
	switch scenario {
	case "design":
		payload["text"] = "你好，这是 VoxCPM Studio 的音色设计基准样例。"
		if capabilities["supports_voice_design"] == true {
			payload["control_instruction"] = "年轻女性，温柔甜美"
		}
	case "controlled_clone":
		if capabilities["supports_reference_audio"] != true || !fileExists(exampleAudio) {
			return nil, map[string]any{"scenario": scenario, "reason": "unsupported_or_missing_reference"}
		}
		payload["mode"] = "controlled_clone"
		payload["text"] = "这是可控克隆基准测试样例。"
		payload["control_instruction"] = "语速稍快，语气自然"
		payload["reference_audio_path"] = exampleAudio
	case "ultimate_clone":
		if capabilities["supports_prompt_text"] != true || !fileExists(exampleAudio) {
			return nil, map[string]any{"scenario": scenario, "reason": "unsupported_or_missing_reference"}
		}
		payload["mode"] = "ultimate_clone"
		payload["text"] = "这是极致克隆基准测试样例。"
		payload["prompt_text"] = ""
		payload["reference_audio_path"] = exampleAudio
	case "streaming":
		payload["text"] = "这是流式生成基准测试样例。"
		payload["streaming"] = true
	case "lora_compare":
		checkpoint := request.LoraCheckpoint
		if checkpoint == "" {
			checkpoints, err := a.scanLoraCheckpoints()
			if err != nil || len(checkpoints) == 0 {
				return nil, map[string]any{"scenario": scenario, "reason": "no_lora_checkpoint"}
			}
			checkpoint, _ = checkpoints[0]["id"].(string)
		}
		payload["text"] = "这是 LoRA 对比基准测试样例。"
		payload["lora_checkpoint"] = checkpoint
	default:
		return nil, map[string]any{"scenario": scenario, "reason": "unknown_scenario"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	run, err := a.worker.RunJSON(ctx, "infer", payload)
	if err != nil {
		return nil, map[string]any{"scenario": scenario, "reason": err.Error()}
	}
	a.persistActiveModel(request.ModelID, request.Device, payload["lora_checkpoint"])
	return run, nil
}

func writeTrainingConfig(path string, model map[string]any, request trainingStartRequest, device string, precision string, checkpointsDir string, logsDir string) error {
	maxSteps := request.NumIters
	if request.MaxSteps != nil {
		maxSteps = *request.MaxSteps
	}
	config := map[string]any{
		"pretrained_path":  model["path"],
		"train_manifest":   request.TrainManifest,
		"val_manifest":     request.ValManifest,
		"device":           device,
		"precision_mode":   precision,
		"sample_rate":      16000,
		"batch_size":       request.BatchSize,
		"grad_accum_steps": request.GradAccumSteps,
		"num_workers":      request.NumWorkers,
		"num_iters":        request.NumIters,
		"log_interval":     request.LogInterval,
		"valid_interval":   request.ValidInterval,
		"save_interval":    request.SaveInterval,
		"learning_rate":    request.LearningRate,
		"weight_decay":     request.WeightDecay,
		"warmup_steps":     request.WarmupSteps,
		"max_steps":        maxSteps,
		"max_batch_tokens": request.MaxBatchTokens,
		"max_grad_norm":    request.MaxGradNorm,
		"save_path":        checkpointsDir,
		"tensorboard":      logsDir,
		"lambdas":          map[string]float64{"loss/diff": 1.0, "loss/stop": 1.0},
	}
	if request.TrainingMode == "lora" {
		config["lora"] = map[string]any{
			"enable_lm":          true,
			"enable_dit":         true,
			"enable_proj":        false,
			"r":                  request.LoraRank,
			"alpha":              request.LoraAlpha,
			"dropout":            request.LoraDropout,
			"target_modules_lm":  []string{"q_proj", "v_proj", "k_proj", "o_proj"},
			"target_modules_dit": []string{"q_proj", "v_proj", "k_proj", "o_proj"},
		}
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func appendMap(value any, item map[string]any) []map[string]any {
	if typed, ok := value.([]map[string]any); ok {
		return append(typed, item)
	}
	if typed, ok := value.([]any); ok {
		out := make([]map[string]any, 0, len(typed)+1)
		for _, raw := range typed {
			if m, ok := raw.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return append(out, item)
	}
	return []map[string]any{item}
}

func generateID(prefix string) string {
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return prefix + "_" + hex.EncodeToString(buf[:])
	}
	return fmt.Sprintf("%s_%d", prefix, time.Now().UTC().UnixNano())
}
