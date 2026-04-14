#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEMO_API_DIR = REPO_ROOT / "apps" / "demo-api"
SRC_DIR = REPO_ROOT / "src"
if str(DEMO_API_DIR) not in sys.path:
    sys.path.insert(0, str(DEMO_API_DIR))
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from demo_api.config import Settings
from demo_api.runtime import DemoRuntime


class FileUpload:
    def __init__(self, path: str, filename: str):
        self.file = open(path, "rb")
        self.filename = filename

    def close(self):
        if not self.file.closed:
            self.file.close()


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "on", "y"}


def _as_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def _as_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _decode_to_temp_file(payload: dict[str, Any], key: str) -> str | None:
    encoded = payload.get(key)
    if not encoded or not isinstance(encoded, str):
        return None
    data = encoded
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data)
    except Exception:
        return None
    with NamedTemporaryFile(delete=False, suffix=".wav") as temp:
        temp.write(raw)
        return temp.name


def _parse_input() -> dict[str, Any]:
	raw = sys.stdin.read()
	if not raw:
		return {}
	try:
		return json.loads(raw)
	except Exception:
		return {}


def _emit_payload(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _emit_error(message: str) -> None:
    _emit_payload({"error": message})


def cmd_load(payload: dict[str, Any]) -> int:
    runtime = DemoRuntime(Settings.from_env())
    model_id = payload.get("model_id")
    if not model_id:
        _emit_error("model_id is required")
        return 2
    result = runtime.load_model(
        model_id=model_id,
        device=payload.get("device", "auto"),
        lora_checkpoint_id=payload.get("lora_checkpoint") if payload.get("lora_checkpoint") else None,
    )
    _emit_payload(result)
    return 0


def cmd_infer(payload: dict[str, Any], *, streaming: bool) -> int:
    runtime = DemoRuntime(Settings.from_env())
    model_id = payload.get("model_id")
    if not model_id:
        _emit_error("model_id is required")
        return 2

    reference_upload = None
    reference_path = payload.get("reference_audio_path")
    if reference_path:
        upload = FileUpload(reference_path, "reference_audio")
        reference_upload = upload

    try:
        if streaming:
            result = runtime.run_inference(
                model_id=model_id,
                device=payload.get("device", "auto"),
                mode=payload.get("mode", "design"),
                text=payload.get("text", ""),
                control_instruction=payload.get("control_instruction", ""),
                prompt_text=payload.get("prompt_text"),
                normalize=_as_bool(payload.get("normalize", False)),
                denoise=_as_bool(payload.get("denoise", False)),
                cfg_value=_as_float(payload.get("cfg_value", 2.0), 2.0),
                inference_timesteps=_as_int(payload.get("inference_timesteps", 10), 10),
                lora_checkpoint=payload.get("lora_checkpoint") or None,
                reference_upload=reference_upload,
                use_streaming=True,
            )
        else:
            result = runtime.run_inference(
                model_id=model_id,
                device=payload.get("device", "auto"),
                mode=payload.get("mode", "design"),
                text=payload.get("text", ""),
                control_instruction=payload.get("control_instruction", ""),
                prompt_text=payload.get("prompt_text"),
                normalize=_as_bool(payload.get("normalize", False)),
                denoise=_as_bool(payload.get("denoise", False)),
                cfg_value=_as_float(payload.get("cfg_value", 2.0), 2.0),
                inference_timesteps=_as_int(payload.get("inference_timesteps", 10), 10),
                lora_checkpoint=payload.get("lora_checkpoint") or None,
                reference_upload=reference_upload,
                use_streaming=False,
            )
        _emit_payload(result)
        return 0
    finally:
        if reference_upload is not None:
            reference_upload.close()


def cmd_stream_infer(payload: dict[str, Any]) -> int:
    runtime = DemoRuntime(Settings.from_env())
    model_id = payload.get("model_id")
    if not model_id:
        _emit_error("model_id is required")
        return 2

    reference_temp = _decode_to_temp_file(payload, "reference_audio_base64")

    stream_payload = {
        "model_id": model_id,
        "device": payload.get("device", "auto"),
        "mode": payload.get("mode", "design"),
        "text": payload.get("text", ""),
        "control_instruction": payload.get("control_instruction", ""),
        "prompt_text": payload.get("prompt_text"),
        "normalize": _as_bool(payload.get("normalize", False)),
        "denoise": _as_bool(payload.get("denoise", False)),
        "cfg_value": _as_float(payload.get("cfg_value", 2.0), 2.0),
        "inference_timesteps": _as_int(payload.get("inference_timesteps", 10), 10),
        "lora_checkpoint": payload.get("lora_checkpoint"),
        "reference_audio_base64": None,
    }
    if reference_temp:
        with open(reference_temp, "rb") as f:
            stream_payload["reference_audio_base64"] = base64.b64encode(f.read()).decode("ascii")

    def _send_chunk(event: dict[str, Any]) -> None:
        _emit_payload(event)

    try:
        run = runtime.stream_inference_ws(
            payload=stream_payload,
            send_event=_send_chunk,
        )
        if run:
            _emit_payload({"event": "completed", "run": run})
        return 0
    except Exception as exc:
        _emit_payload({"event": "error", "detail": str(exc)})
        return 1
    finally:
        if reference_temp:
            try:
                Path(reference_temp).unlink(missing_ok=True)
            except Exception:
                pass


def cmd_transcribe(payload: dict[str, Any]) -> int:
    runtime = DemoRuntime(Settings.from_env())
    file_path = payload.get("file_path")
    if not file_path:
        _emit_error("file_path is required")
        return 2
    device = payload.get("device", "auto")
    text = runtime.transcribe_file(file_path, target_device=runtime._resolve_device(device))
    _emit_payload({"text": text})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="demo demo-worker bridge")
    parser.add_argument("--command", required=True)
    args = parser.parse_args()

    payload = _parse_input()
    command = args.command

    if command == "load_model":
        return cmd_load(payload)
    if command == "infer":
        return cmd_infer(payload, streaming=False)
    if command == "infer_stream":
        return cmd_stream_infer(payload)
    if command == "stream_infer":
        return cmd_stream_infer(payload)
    if command == "transcribe":
        return cmd_transcribe(payload)

    _emit_error(f"unsupported command '{command}'")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
