package demoapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTrainingStatusAndLogsIdleContract(t *testing.T) {
	api := newTestAPI(t)
	router := api.Router()

	statusResp := httptest.NewRecorder()
	router.ServeHTTP(statusResp, httptest.NewRequest(http.MethodGet, "/api/train/status", nil))
	if statusResp.Code != http.StatusOK {
		t.Fatalf("status code = %d, body = %s", statusResp.Code, statusResp.Body.String())
	}
	var status map[string]any
	if err := json.Unmarshal(statusResp.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status["id"] != nil || status["status"] != "idle" || status["device"] == "" {
		t.Fatalf("unexpected idle status: %#v", status)
	}
	if _, ok := status["busy"].(bool); !ok {
		t.Fatalf("busy field missing or not boolean: %#v", status)
	}

	logsResp := httptest.NewRecorder()
	router.ServeHTTP(logsResp, httptest.NewRequest(http.MethodGet, "/api/train/logs", nil))
	if logsResp.Code != http.StatusOK {
		t.Fatalf("logs code = %d, body = %s", logsResp.Code, logsResp.Body.String())
	}
	var logs map[string]any
	if err := json.Unmarshal(logsResp.Body.Bytes(), &logs); err != nil {
		t.Fatal(err)
	}
	if logs["job_id"] != nil || logs["content"] != "" {
		t.Fatalf("unexpected idle logs: %#v", logs)
	}
}

func TestRecoverInterruptedJobs(t *testing.T) {
	store, err := NewDemoStorage(filepath.Join(t.TempDir(), "demo.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	now := isoNow()
	_, err = store.SaveTrainingJob(map[string]any{
		"id":             "train_running",
		"created_at":     now,
		"updated_at":     now,
		"training_mode":  "lora",
		"model_id":       "model",
		"device":         "mps",
		"precision_mode": "fp32",
		"status":         "running",
		"experimental":   false,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SaveBenchJob(map[string]any{
		"id":         "bench_running",
		"created_at": now,
		"updated_at": now,
		"model_id":   "model",
		"device":     "cpu",
		"status":     "running",
		"runs":       []map[string]any{},
		"skipped":    []map[string]any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecoverInterruptedJobs("2026-04-24T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	training, ok, err := store.GetTrainingJob("train_running")
	if err != nil || !ok {
		t.Fatalf("training recovered ok=%v err=%v", ok, err)
	}
	if training["status"] != "failed" || training["error"] == "" {
		t.Fatalf("unexpected training recovery: %#v", training)
	}
	bench, ok, err := store.GetBenchJob("bench_running")
	if err != nil || !ok {
		t.Fatalf("bench recovered ok=%v err=%v", ok, err)
	}
	if bench["status"] != "failed" || bench["error"] == "" {
		t.Fatalf("unexpected bench recovery: %#v", bench)
	}
}

func TestBenchLifecyclePersistsRun(t *testing.T) {
	api := newTestAPI(t)
	router := api.Router()

	body := bytes.NewBufferString(`{"model_id":"VoxCPM2","device":"cpu","scenarios":["design"]}`)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/api/bench/run", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("bench start code = %d, body = %s", resp.Code, resp.Body.String())
	}
	var started map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	jobID, _ := started["id"].(string)
	if jobID == "" || started["status"] != "running" {
		t.Fatalf("unexpected bench start: %#v", started)
	}

	var latest map[string]any
	for i := 0; i < 40; i++ {
		poll := httptest.NewRecorder()
		router.ServeHTTP(poll, httptest.NewRequest(http.MethodGet, "/api/bench/"+jobID, nil))
		if poll.Code != http.StatusOK {
			t.Fatalf("bench poll code = %d, body = %s", poll.Code, poll.Body.String())
		}
		if err := json.Unmarshal(poll.Body.Bytes(), &latest); err != nil {
			t.Fatal(err)
		}
		if latest["status"] == "completed" {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if latest["status"] != "completed" {
		t.Fatalf("bench did not complete: %#v", latest)
	}
	runs, ok := latest["runs"].([]any)
	if !ok || len(runs) != 1 {
		t.Fatalf("unexpected bench runs: %#v", latest["runs"])
	}
	runID, _ := runs[0].(map[string]any)["run_id"].(string)
	if runID == "" {
		t.Fatalf("missing run id: %#v", runs[0])
	}
	runResp := httptest.NewRecorder()
	router.ServeHTTP(runResp, httptest.NewRequest(http.MethodGet, "/api/runs/"+runID, nil))
	if runResp.Code != http.StatusOK {
		t.Fatalf("run lookup code = %d, body = %s", runResp.Code, runResp.Body.String())
	}
}

func newTestAPI(t *testing.T) *DemoAPI {
	t.Helper()
	root := t.TempDir()
	modelDir := filepath.Join(root, "models", "VoxCPM2")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "config.json"), []byte(`{"architecture":"voxcpm2"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.safetensors"), []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}
	workerScript := filepath.Join(root, "fake_worker.py")
	if err := os.WriteFile(workerScript, []byte(fakeWorkerScript), 0o755); err != nil {
		t.Fatal(err)
	}
	api, err := NewDemoAPI(Settings{
		RepoRoot:         root,
		ModelsDir:        filepath.Join(root, "models"),
		LoraDir:          filepath.Join(root, "lora"),
		DataDir:          filepath.Join(root, "demo-data"),
		ArtifactsMount:   "/artifacts",
		DefaultDevice:    "cpu",
		DefaultPrecision: "auto",
		SenseVoiceDevice: "auto",
		RunMode:          "test",
		APIHost:          "127.0.0.1",
		APIPort:          0,
		WorkerPython:     "python3",
		WorkerScript:     workerScript,
	})
	if err != nil {
		t.Fatal(err)
	}
	return api
}

const fakeWorkerScript = `#!/usr/bin/env python3
import argparse
import json
import sys
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--command", required=True)
args = parser.parse_args()
payload = json.loads(sys.stdin.read() or "{}")
now = datetime.now(timezone.utc).isoformat()
if args.command != "infer":
    print(json.dumps({"error": "unsupported"}))
    raise SystemExit(2)
run_id = "run_" + payload.get("mode", "design")
print(json.dumps({
    "id": run_id,
    "created_at": now,
    "updated_at": now,
    "mode": payload.get("mode", "design"),
    "model_id": payload.get("model_id", "model"),
    "device": payload.get("device", "cpu"),
    "status": "completed",
    "request": {
        "text": payload.get("text", ""),
        "resolved_text": payload.get("text", ""),
        "control_instruction": payload.get("control_instruction", ""),
        "prompt_text": payload.get("prompt_text"),
        "cfg_value": payload.get("cfg_value", 2.0),
        "inference_timesteps": payload.get("inference_timesteps", 10),
        "normalize": payload.get("normalize", False),
        "denoise": payload.get("denoise", False),
        "lora_checkpoint": payload.get("lora_checkpoint"),
        "device": payload.get("device", "cpu"),
        "notes": []
    },
    "result": {"waveform_points": [0, 0.5, -0.5], "asr_text": ""},
    "metrics": {"wall_time_ms": 1.0, "audio_duration_s": 1.0, "rtf": 1.0, "sample_rate": 16000}
}, ensure_ascii=False))
`
