from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"

if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class Settings:
    repo_root: Path
    models_dir: Path
    lora_dir: Path
    data_dir: Path
    artifacts_mount: str
    default_device: str
    default_precision_mode: str
    sensevoice_device: str
    run_mode: str
    enable_denoiser: bool
    optimize: bool
    api_host: str
    api_port: int

    @classmethod
    def from_env(cls) -> "Settings":
        repo_root = REPO_ROOT
        models_dir = Path(os.getenv("VOXCPM_MODELS_DIR", repo_root / "models")).expanduser().resolve()
        lora_dir = Path(os.getenv("VOXCPM_LORA_DIR", repo_root / "lora")).expanduser().resolve()
        data_dir = Path(os.getenv("VOXCPM_DATA_DIR", repo_root / "demo-data")).expanduser().resolve()
        settings = cls(
            repo_root=repo_root,
            models_dir=models_dir,
            lora_dir=lora_dir,
            data_dir=data_dir,
            artifacts_mount="/artifacts",
            default_device=os.getenv("VOXCPM_DEVICE", "auto"),
            default_precision_mode=os.getenv("VOXCPM_TRAIN_PRECISION", "auto"),
            sensevoice_device=os.getenv("SENSEVOICE_DEVICE", "auto"),
            run_mode=os.getenv("DEMO_RUN_MODE", "native-cpu"),
            enable_denoiser=_env_bool("VOXCPM_ENABLE_DENOISER", True),
            optimize=_env_bool("VOXCPM_OPTIMIZE", True),
            api_host=os.getenv("DEMO_API_HOST", "0.0.0.0"),
            api_port=int(os.getenv("DEMO_API_PORT", "8000")),
        )
        settings.ensure_dirs()
        return settings

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "runs").mkdir(parents=True, exist_ok=True)
        (self.data_dir / "bench").mkdir(parents=True, exist_ok=True)
        (self.data_dir / "training").mkdir(parents=True, exist_ok=True)
        self.lora_dir.mkdir(parents=True, exist_ok=True)

