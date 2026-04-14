package demoapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type WorkerClient struct {
	python   string
	script   string
	timeout  time.Duration
	repoRoot string
	envBase  []string
}

func NewWorkerClient(settings Settings) *WorkerClient {
	repoRoot := settings.RepoRoot
	if repoRoot == "" {
		repoRoot = "."
	}
	if settings.WorkerPython == "" {
		settings.WorkerPython = "python3"
	}
	if settings.WorkerScript == "" {
		settings.WorkerScript = filepath.Join(repoRoot, "apps", "demo-worker", "bridge.py")
	}
	pythonPaths := []string{filepath.Join(repoRoot, "src"), filepath.Join(repoRoot, "apps", "demo-api")}
	env := os.Environ()
	hasPythonPath := false
	for i, item := range env {
		if strings.HasPrefix(item, "PYTHONPATH=") {
			rest := strings.TrimPrefix(item, "PYTHONPATH=")
			if rest != "" {
				pythonPaths = append(strings.Split(rest, string(os.PathListSeparator)), pythonPaths...)
			}
			env[i] = "PYTHONPATH=" + strings.Join(pythonPaths, string(os.PathListSeparator))
			hasPythonPath = true
			break
		}
	}
	if !hasPythonPath {
		env = append(env, "PYTHONPATH="+strings.Join(pythonPaths, string(os.PathListSeparator)))
	}
	return &WorkerClient{
		python:   settings.WorkerPython,
		script:   settings.WorkerScript,
		timeout:  10 * time.Minute,
		repoRoot: repoRoot,
		envBase:  env,
	}
}

func (w *WorkerClient) RunJSON(ctx context.Context, command string, payload map[string]any) (map[string]any, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, w.timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, w.python, w.script, "--command", command)
	cmd.Env = w.envBase
	cmd.Dir = w.repoRoot
	cmd.Stdin = bytes.NewReader(data)
	output, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("worker command failed: %w", err)
	}
	result := map[string]any{}
	if err := parseLastJSONLine(bytes.TrimSpace(output), &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (w *WorkerClient) StreamJSON(ctx context.Context, payload map[string]any, onEvent func(map[string]any) error) (map[string]any, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, w.timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, w.python, w.script, "--command", "infer_stream")
	cmd.Env = w.envBase
	cmd.Dir = w.repoRoot
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return nil, err
	}
	if _, err := stdin.Write(data); err != nil {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, err
	}
	_ = stdin.Close()

	scan := bufio.NewScanner(stdout)
	completed := map[string]any{}
	waitErr := make(chan error, 1)
	go func() {
		waitErr <- cmd.Wait()
	}()

	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if line == "" {
			continue
		}
		event := map[string]any{}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		if err := onEvent(event); err != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return nil, err
		}
		if eventName := event["event"]; eventName == "completed" {
			if runRecord, ok := event["run"].(map[string]any); ok {
				completed = runRecord
			}
		}
	}
	if err := scan.Err(); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, err
	}
	if err := <-waitErr; err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	return completed, nil
}

func parseLastJSONLine(data []byte, target *map[string]any) error {
	var err error
	var line []byte
	for _, raw := range bytes.Split(data, []byte("\n")) {
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) == 0 {
			continue
		}
		candidate := map[string]any{}
		if jsonErr := json.Unmarshal(trimmed, &candidate); jsonErr == nil {
			line = trimmed
			err = nil
		} else {
			err = jsonErr
		}
	}
	if line == nil {
		return err
	}
	return json.Unmarshal(line, target)
}
