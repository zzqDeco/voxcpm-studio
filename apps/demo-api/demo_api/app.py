from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .runtime import BusyError, DemoRuntime
from .schemas import BenchRunRequest, LoadModelRequest, TrainingStartRequest


def create_app() -> FastAPI:
    settings = Settings.from_env()
    runtime = DemoRuntime(settings)

    app = FastAPI(title="VoxCPM Studio API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount(settings.artifacts_mount, StaticFiles(directory=settings.data_dir), name="artifacts")

    @app.exception_handler(BusyError)
    async def handle_busy_error(_, exc: BusyError):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/runtime")
    async def get_runtime():
        return runtime.runtime_info()

    @app.get("/api/models")
    async def get_models():
        return {
            "models": runtime.scan_models(),
            "lora_checkpoints": runtime.scan_lora_checkpoints(),
        }

    @app.post("/api/models/load")
    async def load_model(request: LoadModelRequest):
        return await run_in_threadpool(runtime.load_model, request.model_id, request.device)

    @app.post("/api/infer/run")
    async def infer_run(
        model_id: Annotated[str, Form(...)],
        text: Annotated[str, Form(...)],
        device: Annotated[str, Form()] = "auto",
        mode: Annotated[str, Form()] = "design",
        control_instruction: Annotated[str, Form()] = "",
        prompt_text: Annotated[str, Form()] = "",
        normalize: Annotated[bool, Form()] = False,
        denoise: Annotated[bool, Form()] = False,
        cfg_value: Annotated[float, Form()] = 2.0,
        inference_timesteps: Annotated[int, Form()] = 10,
        lora_checkpoint: Annotated[str, Form()] = "",
        reference_audio: UploadFile | None = File(default=None),
    ):
        return await run_in_threadpool(
            runtime.run_inference,
            model_id=model_id,
            device=device,
            mode=mode,
            text=text,
            control_instruction=control_instruction,
            prompt_text=prompt_text or None,
            normalize=normalize,
            denoise=denoise,
            cfg_value=cfg_value,
            inference_timesteps=inference_timesteps,
            lora_checkpoint=lora_checkpoint or None,
            reference_upload=reference_audio,
            use_streaming=False,
        )

    @app.post("/api/infer/stream")
    async def infer_stream(
        model_id: Annotated[str, Form(...)],
        text: Annotated[str, Form(...)],
        device: Annotated[str, Form()] = "auto",
        mode: Annotated[str, Form()] = "design",
        control_instruction: Annotated[str, Form()] = "",
        prompt_text: Annotated[str, Form()] = "",
        normalize: Annotated[bool, Form()] = False,
        denoise: Annotated[bool, Form()] = False,
        cfg_value: Annotated[float, Form()] = 2.0,
        inference_timesteps: Annotated[int, Form()] = 10,
        lora_checkpoint: Annotated[str, Form()] = "",
        reference_audio: UploadFile | None = File(default=None),
    ):
        return await run_in_threadpool(
            runtime.run_inference,
            model_id=model_id,
            device=device,
            mode=mode,
            text=text,
            control_instruction=control_instruction,
            prompt_text=prompt_text or None,
            normalize=normalize,
            denoise=denoise,
            cfg_value=cfg_value,
            inference_timesteps=inference_timesteps,
            lora_checkpoint=lora_checkpoint or None,
            reference_upload=reference_audio,
            use_streaming=True,
        )

    @app.websocket("/api/ws/infer-stream")
    async def infer_stream_ws(websocket: WebSocket):
        await websocket.accept()
        try:
            payload = await websocket.receive_json()
            event_queue: asyncio.Queue[dict] = asyncio.Queue()
            loop = asyncio.get_running_loop()

            def _send_from_thread(event: dict):
                asyncio.run_coroutine_threadsafe(event_queue.put(event), loop)

            worker = asyncio.create_task(
                run_in_threadpool(runtime.stream_inference_ws, payload, _send_from_thread)
            )
            while True:
                event = await event_queue.get()
                await websocket.send_json(event)
                if event.get("event") in {"completed", "error"}:
                    break
            await worker
        except WebSocketDisconnect:
            return
        except BusyError as exc:
            await websocket.send_json({"event": "error", "detail": str(exc)})
        except Exception as exc:
            await websocket.send_json({"event": "error", "detail": str(exc)})
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    @app.post("/api/asr/transcribe")
    async def transcribe(
        file: UploadFile = File(...),
        device: Annotated[str, Form()] = "auto",
    ):
        suffix = Path(file.filename or "input.wav").suffix or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await file.read())
            temp_path = Path(temp_file.name)
        try:
            resolved_device = runtime._resolve_device(device)
            text = await run_in_threadpool(runtime.transcribe_file, temp_path, target_device=resolved_device)
            return {"text": text}
        finally:
            temp_path.unlink(missing_ok=True)

    @app.get("/api/runs")
    async def list_runs(limit: int = 100):
        return {"runs": runtime.list_runs(limit=limit)}

    @app.get("/api/runs/{run_id}")
    async def get_run(run_id: str):
        return runtime.get_run(run_id)

    @app.post("/api/bench/run")
    async def run_bench(request: BenchRunRequest):
        return runtime.start_bench(request)

    @app.get("/api/bench/{job_id}")
    async def get_bench(job_id: str):
        return runtime.get_bench_job(job_id)

    @app.post("/api/train/start")
    async def start_training(request: TrainingStartRequest):
        return runtime.start_training(request)

    @app.post("/api/train/stop")
    async def stop_training(job_id: str | None = None):
        return runtime.stop_training(job_id)

    @app.get("/api/train/status")
    async def training_status(job_id: str | None = None):
        return runtime.training_status(job_id)

    @app.get("/api/train/logs")
    async def training_logs(job_id: str | None = None):
        return runtime.training_logs(job_id)

    @app.get("/api/checkpoints")
    async def checkpoints():
        return {"checkpoints": runtime.scan_lora_checkpoints()}

    return app
