package demoapi

import (
	"os"
	"path/filepath"
	"strconv"
)

type Settings struct {
	RepoRoot         string `json:"repo_root"`
	ModelsDir        string `json:"models_dir"`
	LoraDir          string `json:"lora_dir"`
	DataDir          string `json:"data_dir"`
	ArtifactsMount   string `json:"artifacts_mount"`
	DefaultDevice    string `json:"default_device"`
	DefaultPrecision string `json:"default_precision_mode"`
	SenseVoiceDevice string `json:"sensevoice_device"`
	RunMode          string `json:"run_mode"`
	EnableDenoiser   bool   `json:"enable_denoiser"`
	Optimize         bool   `json:"optimize"`
	APIHost          string `json:"api_host"`
	APIPort          int    `json:"api_port"`
	WorkerPython     string `json:"worker_python"`
	WorkerScript     string `json:"worker_script"`
}

func envBool(name string, defaultValue bool) bool {
	value := os.Getenv(name)
	if value == "" {
		return defaultValue
	}
	switch value {
	case "1", "true", "TRUE", "True", "yes", "YES", "on", "ON":
		return true
	default:
		return false
	}
}

func detectRepoRoot() string {
	wd, err := os.Getwd()
	if err == nil {
		wd = filepath.Clean(wd)
		for i := 0; i < 4; i++ {
			if isRepoRoot(wd) {
				return wd
			}
			parent := filepath.Dir(wd)
			if parent == wd {
				break
			}
			wd = parent
		}
	}

	execPath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(filepath.Clean(execPath))
		for i := 0; i < 6; i++ {
			if isRepoRoot(dir) {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	return "."
}

func isRepoRoot(path string) bool {
	_, err := os.Stat(filepath.Join(path, "pyproject.toml"))
	return err == nil
}

func LoadSettingsFromEnv() Settings {
	repoRoot := os.Getenv("VOXCPM_REPO_ROOT")
	if repoRoot == "" {
		repoRoot = detectRepoRoot()
	}
	if repoRoot == "" {
		repoRoot = "."
	}
	repoRoot = filepath.Clean(repoRoot)

	settings := Settings{
		RepoRoot:         repoRoot,
		ModelsDir:        filepath.Join(repoRoot, "models"),
		LoraDir:          filepath.Join(repoRoot, "lora"),
		DataDir:          filepath.Join(repoRoot, "demo-data"),
		ArtifactsMount:   "/artifacts",
		DefaultDevice:    os.Getenv("VOXCPM_DEVICE"),
		DefaultPrecision: os.Getenv("VOXCPM_TRAIN_PRECISION"),
		SenseVoiceDevice: os.Getenv("SENSEVOICE_DEVICE"),
		RunMode:          os.Getenv("DEMO_RUN_MODE"),
		EnableDenoiser:   envBool("VOXCPM_ENABLE_DENOISER", true),
		Optimize:         envBool("VOXCPM_OPTIMIZE", true),
		APIHost:          os.Getenv("DEMO_API_HOST"),
		APIPort:          8000,
		WorkerPython:     os.Getenv("DEMO_WORKER_PYTHON"),
		WorkerScript:     os.Getenv("DEMO_WORKER_SCRIPT"),
	}
	if settings.DefaultDevice == "" {
		settings.DefaultDevice = "auto"
	}
	if settings.DefaultPrecision == "" {
		settings.DefaultPrecision = "auto"
	}
	if settings.SenseVoiceDevice == "" {
		settings.SenseVoiceDevice = "auto"
	}
	if settings.RunMode == "" {
		settings.RunMode = "native-cpu"
	}
	if settings.APIHost == "" {
		settings.APIHost = "0.0.0.0"
	}
	if settings.WorkerPython == "" {
		settings.WorkerPython = "python3"
	}
	if settings.WorkerScript == "" {
		settings.WorkerScript = filepath.Join(repoRoot, "apps", "demo-worker", "bridge.py")
	}
	if port := os.Getenv("DEMO_API_PORT"); port != "" {
		// Keep parsing simple and resilient.
		if value, err := strconv.Atoi(port); err == nil {
			settings.APIPort = value
		}
	}

	return settings
}
