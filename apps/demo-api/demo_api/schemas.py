from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LoadModelRequest(BaseModel):
    model_id: str
    device: str = "auto"


class BenchRunRequest(BaseModel):
    model_id: str
    device: str = "auto"
    scenarios: list[str] | None = None
    lora_checkpoint: str | None = None


class TrainingStartRequest(BaseModel):
    model_id: str
    training_mode: Literal["lora", "full_ft"] = "lora"
    device: str = "auto"
    precision_mode: Literal["auto", "fp32", "amp"] = "auto"
    train_manifest: str
    val_manifest: str = ""
    learning_rate: float = 1e-4
    batch_size: int = 1
    num_iters: int = 1000
    grad_accum_steps: int = 1
    save_interval: int = 500
    log_interval: int = 10
    valid_interval: int = 500
    num_workers: int = 2
    weight_decay: float = 0.01
    warmup_steps: int = 100
    max_steps: int | None = None
    max_batch_tokens: int = 0
    max_grad_norm: float = 1.0
    cfg_scale: float = 2.0
    lora_rank: int = 32
    lora_alpha: int = 16
    lora_dropout: float = 0.0

