from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import traceback
import gc
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch
import yaml
from fastapi import HTTPException, UploadFile

try:
    from funasr import AutoModel
except ImportError:  # pragma: no cover - optional runtime dependency
    AutoModel = None  # type: ignore[assignment]

from voxcpm import VoxCPM
from voxcpm.model.utils import resolve_runtime_device
from voxcpm.model.voxcpm import LoRAConfig as LoRAConfigV1
from voxcpm.model.voxcpm2 import LoRAConfig as LoRAConfigV2

from .config import Settings
from .schemas import BenchRunRequest, TrainingStartRequest
from .storage import DemoStorage
from .utils import (
    audio_duration,
    build_waveform_points,
    compute_quality_metrics,
    decode_base64_file,
    encode_pcm16_base64,
    generate_id,
    iso_now,
    save_audio,
    save_mel_spectrogram,
    write_bytes,
)


class BusyError(RuntimeError):
    """Raised when the runtime is already busy with another task."""


class DemoRuntime:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.storage = DemoStorage(self.settings.data_dir / "demo.sqlite3")
        self._task_lock = threading.Lock()
        self._busy_state: dict[str, Any] = {"kind": "idle", "task_id": None, "started_at": None}
        self._active_model: VoxCPM | None = None
        self._active_model_info: dict[str, Any] | None = None
        self._asr_model: AutoModel | None = None
        self._asr_device: str | None = None
        self._asr_lock = threading.Lock()
        self._training_process: subprocess.Popen[str] | None = None
        self._current_training_job_id: str | None = None

    # ------------------------------------------------------------------ #
    # Runtime and capability helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _available_devices() -> list[str]:
        devices: list[str] = []
        if torch.cuda.is_available():
            devices.append("cuda")
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            devices.append("mps")
        devices.append("cpu")
        return devices

    def _resolve_device(self, requested_device: str | None = None) -> str:
        return resolve_runtime_device(requested_device or self.settings.default_device, configured_device="cuda")

    def _supports_training(self, device: str) -> bool:
        return device.startswith("cuda") or device == "mps"

    def _supports_amp(self, device: str) -> bool:
        if device.startswith("cuda"):
            return torch.cuda.is_available()
        if device == "mps":
            try:
                with torch.amp.autocast("mps", enabled=True, dtype=torch.float16):
                    pass
                return True
            except Exception:
                return False
        return False

    def _recommended_precision_mode(self, device: str) -> str:
        if device.startswith("cuda") and self._supports_amp(device):
            return "amp"
        return "fp32"

    def _resolve_precision_mode(self, requested_mode: str | None, device: str) -> str:
        normalized = (requested_mode or "auto").lower()
        if normalized not in {"auto", "amp", "fp32"}:
            raise HTTPException(status_code=400, detail=f"Unsupported precision_mode '{requested_mode}'.")
        if normalized != "auto":
            return normalized

        configured = (self.settings.default_precision_mode or "auto").lower()
        if configured in {"amp", "fp32"}:
            return configured
        return self._recommended_precision_mode(device)

    def _device_capabilities(self) -> dict[str, dict[str, Any]]:
        capabilities: dict[str, dict[str, Any]] = {}
        for device in self._available_devices():
            capabilities[device] = {
                "supports_training": self._supports_training(device),
                "supports_amp_training": self._supports_amp(device),
                "recommended_precision_mode": self._recommended_precision_mode(device),
            }
        return capabilities

    def runtime_info(self) -> dict[str, Any]:
        default_device = self._resolve_device(self.settings.default_device)
        return {
            "device": self._active_model_info["device"] if self._active_model_info else default_device,
            "available_devices": self._available_devices(),
            "run_mode": self.settings.run_mode,
            "supports_training": self._supports_training(default_device),
            "supports_mps_training": "mps" in self._available_devices(),
            "supports_amp_training": self._supports_amp(default_device),
            "default_precision_mode": self._resolve_precision_mode("auto", default_device),
            "device_capabilities": self._device_capabilities(),
            "active_model": self._active_model_info,
            "busy_state": self._busy_state,
            "sensevoice_device": self._resolve_asr_device(default_device),
            "asr_available": AutoModel is not None,
        }

    # ------------------------------------------------------------------ #
    # Busy state helpers
    # ------------------------------------------------------------------ #
    @contextmanager
    def _busy_task(self, kind: str, task_id: str):
        self._acquire_busy(kind, task_id)
        try:
            yield
        finally:
            self._release_busy(task_id)

    def _acquire_busy(self, kind: str, task_id: str) -> None:
        with self._task_lock:
            if self._busy_state["kind"] != "idle":
                raise BusyError(
                    f"Runtime is busy with {self._busy_state['kind']} "
                    f"({self._busy_state['task_id']})."
                )
            self._busy_state = {"kind": kind, "task_id": task_id, "started_at": iso_now()}

    def _release_busy(self, task_id: str) -> None:
        with self._task_lock:
            if self._busy_state.get("task_id") == task_id:
                self._busy_state = {"kind": "idle", "task_id": None, "started_at": None}

    # ------------------------------------------------------------------ #
    # Model and checkpoint discovery
    # ------------------------------------------------------------------ #
    def _model_search_roots(self) -> list[tuple[Path, str]]:
        return [
            (self.settings.models_dir, "models"),
            (self.settings.data_dir / "training", "training"),
        ]

    @staticmethod
    def _iter_named_files(root: Path, filename: str):
        if not root.exists():
            return
        for current_root, _, files in os.walk(root, followlinks=True):
            if filename in files:
                yield Path(current_root) / filename

    def _infer_model_family(self, path: Path, arch: str) -> str:
        name = path.name.lower()
        if arch == "voxcpm2":
            return "VoxCPM2"
        if "1.5" in name:
            return "VoxCPM1.5"
        if "0.5" in name or "0_5" in name:
            return "VoxCPM-0.5B"
        return "VoxCPM"

    def _build_model_capabilities(self, arch: str) -> dict[str, bool]:
        return {
            "supports_reference_audio": arch == "voxcpm2",
            "supports_prompt_text": True,
            "supports_voice_design": arch == "voxcpm2",
            "supports_streaming": True,
            "supports_lora": True,
            "supports_full_ft": True,
        }

    def scan_models(self) -> list[dict[str, Any]]:
        discovered: dict[str, dict[str, Any]] = {}
        for root, origin in self._model_search_roots():
            for config_path in self._iter_named_files(root, "config.json"):
                model_dir = config_path.parent
                has_weights = (model_dir / "model.safetensors").exists() or (model_dir / "pytorch_model.bin").exists()
                if not has_weights:
                    continue
                try:
                    rel_path = model_dir.relative_to(root)
                    model_id = str(rel_path) if origin == "models" else f"training/{rel_path}"
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = json.load(f)
                    arch = config.get("architecture", "voxcpm").lower()
                    discovered[model_id] = {
                        "id": model_id,
                        "label": model_id,
                        "family": self._infer_model_family(model_dir, arch),
                        "architecture": arch,
                        "origin": origin,
                        "path": str(model_dir),
                        "capabilities": self._build_model_capabilities(arch),
                    }
                except Exception:
                    continue
        return sorted(discovered.values(), key=lambda item: item["label"].lower())

    def _find_model(self, model_id: str) -> dict[str, Any]:
        for item in self.scan_models():
            if item["id"] == model_id:
                return item
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")

    def scan_lora_checkpoints(self) -> list[dict[str, Any]]:
        checkpoints: dict[str, dict[str, Any]] = {}
        roots = [
            (self.settings.lora_dir, "lora"),
            (self.settings.data_dir / "training", "training"),
        ]
        for root, origin in roots:
            for pattern in ("lora_weights.safetensors", "lora_weights.ckpt"):
                for file_path in self._iter_named_files(root, pattern):
                    checkpoint_dir = file_path.parent
                    rel_path = checkpoint_dir.relative_to(root)
                    checkpoint_id = str(rel_path) if origin == "lora" else f"training/{rel_path}"
                    info = {
                        "id": checkpoint_id,
                        "label": checkpoint_id,
                        "path": str(checkpoint_dir),
                        "origin": origin,
                        "base_model": None,
                    }
                    config_file = checkpoint_dir / "lora_config.json"
                    if config_file.exists():
                        try:
                            with open(config_file, "r", encoding="utf-8") as f:
                                config = json.load(f)
                            info["base_model"] = config.get("base_model")
                        except Exception:
                            pass
                    checkpoints[checkpoint_id] = info
        return sorted(checkpoints.values(), key=lambda item: item["label"].lower())

    def _find_lora_checkpoint(self, checkpoint_id: str) -> dict[str, Any]:
        for item in self.scan_lora_checkpoints():
            if item["id"] == checkpoint_id:
                return item
        raise HTTPException(status_code=404, detail=f"LoRA checkpoint '{checkpoint_id}' not found.")

    def _default_lora_config(self, arch: str):
        if arch == "voxcpm2":
            return LoRAConfigV2(enable_lm=True, enable_dit=True, enable_proj=False)
        return LoRAConfigV1(enable_lm=True, enable_dit=True, enable_proj=False)

    def _read_lora_config(self, checkpoint_dir: Path, arch: str):
        config_path = checkpoint_dir / "lora_config.json"
        if not config_path.exists():
            return self._default_lora_config(arch)
        config_cls = LoRAConfigV2 if arch == "voxcpm2" else LoRAConfigV1
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            return config_cls(**config.get("lora_config", {}))
        except Exception:
            return self._default_lora_config(arch)

    def _clear_model(self) -> None:
        self._active_model = None
        self._active_model_info = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            try:
                torch.mps.empty_cache()
            except Exception:
                pass

    def load_model(self, model_id: str, device: str = "auto", lora_checkpoint_id: str | None = None) -> dict[str, Any]:
        descriptor = self._find_model(model_id)
        resolved_device = self._resolve_device(device)
        lora_config = self._default_lora_config(descriptor["architecture"])
        lora_config_source = "default"
        if lora_checkpoint_id:
            checkpoint = self._find_lora_checkpoint(lora_checkpoint_id)
            lora_config = self._read_lora_config(Path(checkpoint["path"]), descriptor["architecture"])
            lora_config_source = checkpoint["id"]

        if (
            self._active_model is not None
            and self._active_model_info is not None
            and self._active_model_info["id"] == descriptor["id"]
            and self._active_model_info["device"] == resolved_device
            and self._active_model_info.get("lora_config_source") == lora_config_source
        ):
            return self._active_model_info

        self._clear_model()
        self._active_model = VoxCPM.from_pretrained(
            hf_model_id=descriptor["path"],
            load_denoiser=self.settings.enable_denoiser,
            optimize=self.settings.optimize,
            device=resolved_device,
            lora_config=lora_config,
        )
        self._active_model_info = {
            **descriptor,
            "device": resolved_device,
            "active_lora": None,
            "lora_config_source": lora_config_source,
            "loaded_at": iso_now(),
        }
        return self._active_model_info

    def _activate_lora(self, checkpoint_id: str | None) -> str | None:
        if self._active_model is None or self._active_model_info is None:
            return None
        self._active_model.unload_lora()
        if not checkpoint_id:
            self._active_model.set_lora_enabled(False)
            self._active_model_info["active_lora"] = None
            return None

        checkpoint = self._find_lora_checkpoint(checkpoint_id)
        self._active_model.load_lora(checkpoint["path"])
        self._active_model.set_lora_enabled(True)
        self._active_model_info["active_lora"] = checkpoint["id"]
        return checkpoint["id"]

    # ------------------------------------------------------------------ #
    # ASR helpers
    # ------------------------------------------------------------------ #
    def _resolve_asr_device(self, target_device: str) -> str:
        configured = self.settings.sensevoice_device
        if configured != "auto":
            return configured
        return "cuda:0" if target_device.startswith("cuda") else "cpu"

    def _get_asr_model(self, target_device: str) -> AutoModel:
        if AutoModel is None:
            raise HTTPException(
                status_code=503,
                detail="funasr is not installed. Install the demo dependencies to enable ASR features.",
            )
        asr_device = self._resolve_asr_device(target_device)
        with self._asr_lock:
            if self._asr_model is None or self._asr_device != asr_device:
                self._asr_model = AutoModel(
                    model="iic/SenseVoiceSmall",
                    disable_update=True,
                    log_level="ERROR",
                    device=asr_device,
                )
                self._asr_device = asr_device
        return self._asr_model

    def transcribe_file(self, file_path: str | Path, *, target_device: str) -> str:
        model = self._get_asr_model(target_device)
        result = model.generate(input=str(file_path), language="auto", use_itn=True)
        return result[0]["text"].split("|>")[-1]

    # ------------------------------------------------------------------ #
    # Inference helpers
    # ------------------------------------------------------------------ #
    def _save_upload(self, upload: UploadFile | None, target_dir: Path, filename: str) -> str | None:
        if upload is None:
            return None
        suffix = Path(upload.filename or filename).suffix or ".wav"
        path = target_dir / f"{filename}{suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as f:
            f.write(upload.file.read())
        return str(path)

    def _save_base64_audio(self, encoded: str | None, target_dir: Path, filename: str) -> str | None:
        if not encoded:
            return None
        path = target_dir / f"{filename}.wav"
        write_bytes(path, decode_base64_file(encoded))
        return str(path)

    def _prepare_generation_args(
        self,
        *,
        descriptor: dict[str, Any],
        mode: str,
        text: str,
        control_instruction: str,
        reference_path: str | None,
        prompt_text: str | None,
        normalize: bool,
        denoise: bool,
        cfg_value: float,
        inference_timesteps: int,
        target_device: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if self._active_model is None:
            raise HTTPException(status_code=500, detail="Model is not loaded.")

        prompt_text_clean = (prompt_text or "").strip() or None
        control_clean = (control_instruction or "").strip()
        final_text = text.strip()
        notes: list[str] = []

        if mode == "design":
            if control_clean and descriptor["capabilities"]["supports_voice_design"]:
                final_text = f"({control_clean}){final_text}"
            elif control_clean:
                notes.append("Current model does not support voice design; control instruction was ignored.")
            kwargs = {
                "text": final_text,
                "cfg_value": cfg_value,
                "inference_timesteps": inference_timesteps,
                "normalize": normalize,
                "denoise": denoise,
            }
        elif mode == "controlled_clone":
            if not descriptor["capabilities"]["supports_reference_audio"]:
                raise HTTPException(status_code=400, detail="Current model does not support reference-audio cloning.")
            if not reference_path:
                raise HTTPException(status_code=400, detail="Reference audio is required for controlled_clone.")
            if control_clean and descriptor["capabilities"]["supports_voice_design"]:
                final_text = f"({control_clean}){final_text}"
            kwargs = {
                "text": final_text,
                "reference_wav_path": reference_path,
                "cfg_value": cfg_value,
                "inference_timesteps": inference_timesteps,
                "normalize": normalize,
                "denoise": denoise,
            }
        elif mode == "ultimate_clone":
            if not reference_path:
                raise HTTPException(status_code=400, detail="Reference audio is required for ultimate_clone.")
            if not prompt_text_clean:
                prompt_text_clean = self.transcribe_file(reference_path, target_device=target_device)
                notes.append("Prompt text was auto-filled with ASR.")
            kwargs = {
                "text": final_text,
                "prompt_wav_path": reference_path,
                "prompt_text": prompt_text_clean,
                "cfg_value": cfg_value,
                "inference_timesteps": inference_timesteps,
                "normalize": normalize,
                "denoise": denoise,
            }
            if descriptor["capabilities"]["supports_reference_audio"]:
                kwargs["reference_wav_path"] = reference_path
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported mode '{mode}'.")

        return kwargs, {
            "final_text": final_text,
            "control_instruction": control_clean,
            "prompt_text": prompt_text_clean,
            "notes": notes,
        }

    def _compute_metrics(
        self,
        *,
        audio: np.ndarray,
        sample_rate: int,
        text: str,
        elapsed_s: float,
        asr_text: str | None,
        stream_metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        duration_s = audio_duration(audio, sample_rate)
        metrics = {
            "wall_time_ms": elapsed_s * 1000.0,
            "audio_duration_s": duration_s,
            "sample_rate": sample_rate,
            "rtf": (elapsed_s / duration_s) if duration_s > 0 else None,
            "text_length": len(text),
        }
        metrics.update(compute_quality_metrics(text, asr_text))
        if stream_metrics:
            metrics.update(stream_metrics)
        return metrics

    def _finalize_run(
        self,
        *,
        run_id: str,
        model_id: str,
        device: str,
        mode: str,
        request_payload: dict[str, Any],
        audio: np.ndarray,
        sample_rate: int,
        asr_text: str | None,
        metrics: dict[str, Any],
        status: str,
    ) -> dict[str, Any]:
        run_dir = self.settings.data_dir / "runs" / run_id
        audio_path = run_dir / "output.wav"
        mel_path = run_dir / "mel.png"

        save_audio(audio_path, audio, sample_rate)
        save_mel_spectrogram(mel_path, audio, sample_rate)

        record = {
            "id": run_id,
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "mode": mode,
            "model_id": model_id,
            "device": device,
            "status": status,
            "request": request_payload,
            "result": {
                "audio_url": f"{self.settings.artifacts_mount}/runs/{run_id}/output.wav",
                "mel_url": f"{self.settings.artifacts_mount}/runs/{run_id}/mel.png",
                "waveform_points": build_waveform_points(audio),
                "asr_text": asr_text,
            },
            "metrics": metrics,
        }
        self.storage.save_run(record)
        return record

    def _perform_inference(
        self,
        *,
        run_id: str,
        model_id: str,
        device: str,
        mode: str,
        text: str,
        control_instruction: str,
        prompt_text: str | None,
        normalize: bool,
        denoise: bool,
        cfg_value: float,
        inference_timesteps: int,
        lora_checkpoint: str | None,
        reference_path: str | None,
        use_streaming: bool,
        on_chunk: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        descriptor = self._find_model(model_id)
        active = self.load_model(model_id, device=device, lora_checkpoint_id=lora_checkpoint)
        self._activate_lora(lora_checkpoint)

        request_kwargs, resolved = self._prepare_generation_args(
            descriptor=descriptor,
            mode=mode,
            text=text,
            control_instruction=control_instruction,
            reference_path=reference_path,
            prompt_text=prompt_text,
            normalize=normalize,
            denoise=denoise,
            cfg_value=cfg_value,
            inference_timesteps=inference_timesteps,
            target_device=active["device"],
        )

        started = time.perf_counter()
        stream_metrics: dict[str, Any] | None = None
        if use_streaming:
            chunks: list[np.ndarray] = []
            intervals: list[float] = []
            chunk_count = 0
            last_chunk_at: float | None = None
            first_chunk_latency_ms: float | None = None
            for chunk in self._active_model.generate_streaming(**request_kwargs):  # type: ignore[union-attr]
                now = time.perf_counter()
                chunk_count += 1
                if first_chunk_latency_ms is None:
                    first_chunk_latency_ms = (now - started) * 1000.0
                if last_chunk_at is not None:
                    intervals.append((now - last_chunk_at) * 1000.0)
                last_chunk_at = now
                chunk_np = np.asarray(chunk, dtype=np.float32)
                chunks.append(chunk_np)
                if on_chunk is not None:
                    on_chunk(
                        {
                            "event": "chunk",
                            "chunk_index": chunk_count,
                            "sample_rate": self._active_model.tts_model.sample_rate,  # type: ignore[union-attr]
                            "pcm16_base64": encode_pcm16_base64(chunk_np),
                        }
                    )
            audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
            stream_metrics = {
                "first_chunk_latency_ms": first_chunk_latency_ms,
                "chunk_count": chunk_count,
                "avg_chunk_interval_ms": sum(intervals) / len(intervals) if intervals else None,
                "final_latency_ms": (time.perf_counter() - started) * 1000.0,
            }
        else:
            audio = self._active_model.generate(**request_kwargs)  # type: ignore[union-attr]

        elapsed_s = time.perf_counter() - started
        sample_rate = self._active_model.tts_model.sample_rate  # type: ignore[union-attr]

        run_dir = self.settings.data_dir / "runs" / run_id
        asr_text: str | None = None
        temp_out = run_dir / "asr_input.wav"
        try:
            save_audio(temp_out, audio, sample_rate)
            asr_text = self.transcribe_file(temp_out, target_device=active["device"])
        except Exception:
            asr_text = None

        metrics = self._compute_metrics(
            audio=audio,
            sample_rate=sample_rate,
            text=resolved["final_text"],
            elapsed_s=elapsed_s,
            asr_text=asr_text,
            stream_metrics=stream_metrics,
        )

        request_payload = {
            "mode": mode,
            "text": text,
            "resolved_text": resolved["final_text"],
            "control_instruction": resolved["control_instruction"],
            "prompt_text": resolved["prompt_text"],
            "cfg_value": cfg_value,
            "inference_timesteps": inference_timesteps,
            "normalize": normalize,
            "denoise": denoise,
            "lora_checkpoint": lora_checkpoint,
            "device": active["device"],
            "notes": resolved["notes"],
        }
        return self._finalize_run(
            run_id=run_id,
            model_id=model_id,
            device=active["device"],
            mode=mode if not use_streaming else f"{mode}_streaming",
            request_payload=request_payload,
            audio=audio,
            sample_rate=sample_rate,
            asr_text=asr_text,
            metrics=metrics,
            status="completed",
        )

    def run_inference(
        self,
        *,
        model_id: str,
        device: str,
        mode: str,
        text: str,
        control_instruction: str,
        prompt_text: str | None,
        normalize: bool,
        denoise: bool,
        cfg_value: float,
        inference_timesteps: int,
        lora_checkpoint: str | None,
        reference_upload: UploadFile | None = None,
        use_streaming: bool = False,
    ) -> dict[str, Any]:
        run_id = generate_id("run")
        run_dir = self.settings.data_dir / "runs" / run_id
        reference_path = self._save_upload(reference_upload, run_dir, "reference")

        with self._busy_task("inference", run_id):
            return self._perform_inference(
                run_id=run_id,
                model_id=model_id,
                device=device,
                mode=mode,
                text=text,
                control_instruction=control_instruction,
                prompt_text=prompt_text,
                normalize=normalize,
                denoise=denoise,
                cfg_value=cfg_value,
                inference_timesteps=inference_timesteps,
                lora_checkpoint=lora_checkpoint,
                reference_path=reference_path,
                use_streaming=use_streaming,
            )

    def stream_inference_ws(self, payload: dict[str, Any], send_event: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        run_id = generate_id("run")
        run_dir = self.settings.data_dir / "runs" / run_id
        reference_path = self._save_base64_audio(payload.get("reference_audio_base64"), run_dir, "reference")

        with self._busy_task("streaming", run_id):
            record = self._perform_inference(
                run_id=run_id,
                model_id=payload["model_id"],
                device=payload.get("device", "auto"),
                mode=payload.get("mode", "design"),
                text=payload.get("text", ""),
                control_instruction=payload.get("control_instruction", ""),
                prompt_text=payload.get("prompt_text"),
                normalize=bool(payload.get("normalize", False)),
                denoise=bool(payload.get("denoise", False)),
                cfg_value=float(payload.get("cfg_value", 2.0)),
                inference_timesteps=int(payload.get("inference_timesteps", 10)),
                lora_checkpoint=payload.get("lora_checkpoint"),
                reference_path=reference_path,
                use_streaming=True,
                on_chunk=send_event,
            )
            send_event({"event": "completed", "run": record})
            return record

    # ------------------------------------------------------------------ #
    # History
    # ------------------------------------------------------------------ #
    def list_runs(self, *, limit: int = 100) -> list[dict[str, Any]]:
        return self.storage.list_runs(limit=limit)

    def get_run(self, run_id: str) -> dict[str, Any]:
        record = self.storage.get_run(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
        return record

    # ------------------------------------------------------------------ #
    # Training
    # ------------------------------------------------------------------ #
    def _validate_training_request(self, request: TrainingStartRequest) -> tuple[dict[str, Any], str, bool, str]:
        descriptor = self._find_model(request.model_id)
        resolved_device = self._resolve_device(request.device)
        if resolved_device == "cpu":
            raise HTTPException(status_code=400, detail="Training is not supported on CPU.")
        resolved_precision = self._resolve_precision_mode(request.precision_mode, resolved_device)
        if resolved_device == "mps" and resolved_precision == "amp" and not self._supports_amp("mps"):
            raise HTTPException(status_code=400, detail="AMP training is not available on MPS in this environment.")
        experimental = resolved_device == "mps" and request.training_mode == "full_ft"
        return descriptor, resolved_device, experimental, resolved_precision

    def start_training(self, request: TrainingStartRequest) -> dict[str, Any]:
        descriptor, resolved_device, experimental, resolved_precision = self._validate_training_request(request)
        job_id = generate_id("train")
        job_dir = self.settings.data_dir / "training" / job_id
        checkpoints_dir = job_dir / "checkpoints"
        logs_dir = job_dir / "logs"
        checkpoints_dir.mkdir(parents=True, exist_ok=True)
        logs_dir.mkdir(parents=True, exist_ok=True)

        config: dict[str, Any] = {
            "pretrained_path": descriptor["path"],
            "train_manifest": request.train_manifest,
            "val_manifest": request.val_manifest,
            "device": resolved_device,
            "precision_mode": resolved_precision,
            "sample_rate": 16000,
            "batch_size": request.batch_size,
            "grad_accum_steps": request.grad_accum_steps,
            "num_workers": request.num_workers,
            "num_iters": request.num_iters,
            "log_interval": request.log_interval,
            "valid_interval": request.valid_interval,
            "save_interval": request.save_interval,
            "learning_rate": request.learning_rate,
            "weight_decay": request.weight_decay,
            "warmup_steps": request.warmup_steps,
            "max_steps": request.max_steps or request.num_iters,
            "max_batch_tokens": request.max_batch_tokens,
            "max_grad_norm": request.max_grad_norm,
            "save_path": str(checkpoints_dir),
            "tensorboard": str(logs_dir),
            "lambdas": {"loss/diff": 1.0, "loss/stop": 1.0},
        }
        if request.training_mode == "lora":
            config["lora"] = {
                "enable_lm": True,
                "enable_dit": True,
                "enable_proj": False,
                "r": request.lora_rank,
                "alpha": request.lora_alpha,
                "dropout": request.lora_dropout,
                "target_modules_lm": ["q_proj", "v_proj", "k_proj", "o_proj"],
                "target_modules_dit": ["q_proj", "v_proj", "k_proj", "o_proj"],
            }

        config_path = job_dir / "train_config.yaml"
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)

        log_path = logs_dir / "train.log"
        command = [
            sys.executable,
            str(self.settings.repo_root / "scripts" / "train_voxcpm_finetune.py"),
            "--config_path",
            str(config_path),
        ]

        record = {
            "id": job_id,
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "training_mode": request.training_mode,
            "model_id": request.model_id,
            "device": resolved_device,
            "precision_mode": resolved_precision,
            "status": "starting",
            "experimental": experimental,
            "output_dir": str(job_dir),
            "log_path": str(log_path),
            "config_path": str(config_path),
            "command": command,
        }

        self._acquire_busy("training", job_id)
        env = os.environ.copy()
        src_root = str(self.settings.repo_root / "src")
        env["PYTHONPATH"] = src_root if not env.get("PYTHONPATH") else f"{src_root}{os.pathsep}{env['PYTHONPATH']}"
        try:
            process = subprocess.Popen(
                command,
                cwd=self.settings.repo_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )
        except Exception:
            self._release_busy(job_id)
            raise
        self._training_process = process
        self._current_training_job_id = job_id
        record["status"] = "running"
        self.storage.save_training_job(record)

        def _pump_logs():
            try:
                with log_path.open("a", encoding="utf-8") as log_file:
                    assert process.stdout is not None
                    for line in process.stdout:
                        log_file.write(line)
                code = process.wait()
                status = "completed" if code == 0 else "failed"
            except Exception:
                with log_path.open("a", encoding="utf-8") as log_file:
                    log_file.write(traceback.format_exc())
                status = "failed"
            finally:
                updated = self.storage.get_training_job(job_id) or record
                updated["updated_at"] = iso_now()
                updated["status"] = status
                self.storage.save_training_job(updated)
                self._training_process = None
                self._current_training_job_id = None
                self._release_busy(job_id)

        thread = threading.Thread(target=_pump_logs, daemon=True)
        thread.start()
        return record

    def stop_training(self, job_id: str | None = None) -> dict[str, Any]:
        target_id = job_id or self._current_training_job_id
        if not target_id or self._training_process is None:
            raise HTTPException(status_code=404, detail="No active training job.")
        if self._current_training_job_id != target_id:
            raise HTTPException(status_code=404, detail=f"Training job '{target_id}' is not active.")
        self._training_process.terminate()
        record = self.storage.get_training_job(target_id) or {"id": target_id}
        record["updated_at"] = iso_now()
        record["status"] = "stopping"
        self.storage.save_training_job(record)
        return record

    def training_status(self, job_id: str | None = None) -> dict[str, Any]:
        if job_id:
            record = self.storage.get_training_job(job_id)
        elif self._current_training_job_id:
            record = self.storage.get_training_job(self._current_training_job_id)
        else:
            record = self.storage.latest_training_job()
        if record is None:
            return {
                "id": None,
                "status": "idle",
                "device": self._resolve_device(self.settings.default_device),
                "busy": self._busy_state["kind"] == "training",
            }
        record["busy"] = self._busy_state["kind"] == "training" and self._busy_state["task_id"] == record["id"]
        return record

    def training_logs(self, job_id: str | None = None) -> dict[str, Any]:
        status = self.training_status(job_id)
        log_path = status.get("log_path")
        if not log_path:
            return {"job_id": status.get("id"), "content": ""}
        path = Path(log_path)
        if not path.exists():
            return {"job_id": status.get("id"), "content": ""}
        return {"job_id": status.get("id"), "content": path.read_text(encoding="utf-8", errors="ignore")[-50000:]}

    # ------------------------------------------------------------------ #
    # Bench
    # ------------------------------------------------------------------ #
    def start_bench(self, request: BenchRunRequest) -> dict[str, Any]:
        descriptor = self._find_model(request.model_id)
        resolved_device = self._resolve_device(request.device)
        job_id = generate_id("bench")
        record = {
            "id": job_id,
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "model_id": request.model_id,
            "device": resolved_device,
            "status": "running",
            "runs": [],
            "skipped": [],
        }
        self.storage.save_bench_job(record)
        self._acquire_busy("bench", job_id)

        def _run():
            try:
                scenarios = request.scenarios or [
                    "design",
                    "controlled_clone",
                    "ultimate_clone",
                    "streaming",
                    "lora_compare",
                ]
                example_audio = self.settings.repo_root / "examples" / "reference_speaker.wav"
                for scenario in scenarios:
                    try:
                        if scenario == "design":
                            run = self._perform_inference(
                                run_id=generate_id("run"),
                                model_id=request.model_id,
                                device=resolved_device,
                                mode="design",
                                text="你好，这是 VoxCPM Studio 的音色设计基准样例。",
                                control_instruction="年轻女性，温柔甜美" if descriptor["capabilities"]["supports_voice_design"] else "",
                                prompt_text=None,
                                normalize=False,
                                denoise=False,
                                cfg_value=2.0,
                                inference_timesteps=10,
                                lora_checkpoint=None,
                                reference_path=None,
                                use_streaming=False,
                            )
                            record["runs"].append({"scenario": scenario, "run_id": run["id"]})
                        elif scenario == "controlled_clone":
                            if not descriptor["capabilities"]["supports_reference_audio"] or not example_audio.exists():
                                record["skipped"].append({"scenario": scenario, "reason": "unsupported_or_missing_reference"})
                                continue
                            run = self._perform_inference(
                                run_id=generate_id("run"),
                                model_id=request.model_id,
                                device=resolved_device,
                                mode="controlled_clone",
                                text="这是可控克隆基准测试样例。",
                                control_instruction="语速稍快，语气自然",
                                prompt_text=None,
                                normalize=False,
                                denoise=False,
                                cfg_value=2.0,
                                inference_timesteps=10,
                                lora_checkpoint=None,
                                reference_path=str(example_audio),
                                use_streaming=False,
                            )
                            record["runs"].append({"scenario": scenario, "run_id": run["id"]})
                        elif scenario == "ultimate_clone":
                            if not descriptor["capabilities"]["supports_prompt_text"] or not example_audio.exists():
                                record["skipped"].append({"scenario": scenario, "reason": "unsupported_or_missing_reference"})
                                continue
                            run = self._perform_inference(
                                run_id=generate_id("run"),
                                model_id=request.model_id,
                                device=resolved_device,
                                mode="ultimate_clone",
                                text="这是极致克隆基准测试样例。",
                                control_instruction="",
                                prompt_text="",
                                normalize=False,
                                denoise=False,
                                cfg_value=2.0,
                                inference_timesteps=10,
                                lora_checkpoint=None,
                                reference_path=str(example_audio),
                                use_streaming=False,
                            )
                            record["runs"].append({"scenario": scenario, "run_id": run["id"]})
                        elif scenario == "streaming":
                            run = self._perform_inference(
                                run_id=generate_id("run"),
                                model_id=request.model_id,
                                device=resolved_device,
                                mode="design",
                                text="这是流式生成基准测试样例。",
                                control_instruction="",
                                prompt_text=None,
                                normalize=False,
                                denoise=False,
                                cfg_value=2.0,
                                inference_timesteps=10,
                                lora_checkpoint=None,
                                reference_path=None,
                                use_streaming=True,
                            )
                            record["runs"].append({"scenario": scenario, "run_id": run["id"]})
                        elif scenario == "lora_compare":
                            checkpoints = self.scan_lora_checkpoints()
                            if not checkpoints:
                                record["skipped"].append({"scenario": scenario, "reason": "no_lora_checkpoint"})
                                continue
                            target_checkpoint = request.lora_checkpoint or checkpoints[0]["id"]
                            run = self._perform_inference(
                                run_id=generate_id("run"),
                                model_id=request.model_id,
                                device=resolved_device,
                                mode="design",
                                text="这是 LoRA 对比基准测试样例。",
                                control_instruction="",
                                prompt_text=None,
                                normalize=False,
                                denoise=False,
                                cfg_value=2.0,
                                inference_timesteps=10,
                                lora_checkpoint=target_checkpoint,
                                reference_path=None,
                                use_streaming=False,
                            )
                            record["runs"].append(
                                {
                                    "scenario": scenario,
                                    "run_id": run["id"],
                                    "lora_checkpoint": target_checkpoint,
                                }
                            )
                    except Exception as exc:
                        record["skipped"].append({"scenario": scenario, "reason": str(exc)})
                record["status"] = "completed"
            except Exception as exc:
                record["status"] = "failed"
                record["error"] = str(exc)
            finally:
                record["updated_at"] = iso_now()
                self.storage.save_bench_job(record)
                self._release_busy(job_id)

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()
        return record

    def get_bench_job(self, job_id: str) -> dict[str, Any]:
        record = self.storage.get_bench_job(job_id)
        if record is None:
            raise HTTPException(status_code=404, detail=f"Bench job '{job_id}' not found.")
        return record
