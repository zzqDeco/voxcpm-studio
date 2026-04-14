from __future__ import annotations

import contextlib
import os
import random
import typing
import warnings

import numpy as np
import torch
import torch.distributed as dist
import torch.utils.data
from torch.nn.parallel import DistributedDataParallel

from ..model.utils import resolve_runtime_device


class Accelerator:
    """
    Simplified accelerator that mirrors the behaviour of the minicpm-audio
    training utilities. It initializes a distributed process group when
    ``torchrun`` is used and exposes helpers for AMP, gradient scaling and
    preparing models/dataloaders for DDP.
    """

    def __init__(
        self,
        amp: bool = False,
        seed: int = 42,
        device: str | None = None,
        precision_mode: str = "auto",
    ):
        requested_device = device or os.getenv("VOXCPM_DEVICE", "auto")
        self.local_rank = int(os.environ.get("LOCAL_RANK", "0"))

        runtime_device = resolve_runtime_device(requested_device, configured_device="cuda")
        if runtime_device == "cuda":
            runtime_device = f"cuda:{self.local_rank}"

        self._device = torch.device(runtime_device)
        self.device_type = self._device.type
        self.world_size = int(os.getenv("WORLD_SIZE", "1"))

        if self.world_size > 1:
            if self.device_type != "cuda":
                raise RuntimeError("Distributed training is only supported on CUDA devices.")
            if not dist.is_initialized():
                dist.init_process_group("nccl", init_method="env://")

        self.rank = dist.get_rank() if dist.is_initialized() else 0
        self.precision_mode = (precision_mode or "auto").lower()
        if self.precision_mode not in {"auto", "amp", "fp32"}:
            raise ValueError(
                f"Unsupported precision_mode '{precision_mode}'. "
                "Supported values are 'auto', 'amp', and 'fp32'."
            )
        self._supports_amp = self._detect_amp_support(self.device_type)
        self.amp_requested = self._resolve_amp_request(amp)
        self.amp = self.amp_requested and self._supports_amp
        if self.amp_requested and not self._supports_amp:
            warnings.warn(
                f"AMP was requested for device '{self.device_type}', but autocast is not available. "
                "Falling back to fp32.",
                RuntimeWarning,
            )
        self.autocast_dtype = self._default_autocast_dtype()

        # Set random seed to ensure model initialization consistency
        self._set_seed(seed)

        class DummyScaler:
            def step(self, optimizer):
                optimizer.step()

            def scale(self, loss):
                return loss

            def unscale_(self, optimizer):
                return optimizer

            def update(self):
                pass

        self.scaler = (
            torch.amp.GradScaler("cuda")
            if (self.amp and self.device_type == "cuda")
            else DummyScaler()
        )
        self.device_ctx = torch.cuda.device(self.local_rank) if self.device_type == "cuda" else None
        self._ddp_model = None  # For no_sync support

    def _resolve_amp_request(self, amp: bool) -> bool:
        if self.precision_mode == "fp32":
            return False
        if self.precision_mode == "amp":
            return True
        # Legacy default: AMP is enabled automatically only on CUDA.
        return bool(amp and self.device_type == "cuda")

    @staticmethod
    def _detect_amp_support(device_type: str) -> bool:
        if device_type == "cuda":
            return torch.cuda.is_available()
        if device_type == "mps":
            try:
                with torch.amp.autocast("mps", enabled=True, dtype=torch.float16):
                    pass
                return True
            except Exception:
                return False
        return False

    def _default_autocast_dtype(self):
        if self.device_type == "cuda":
            return torch.bfloat16
        if self.device_type == "mps":
            return torch.float16
        return torch.float32

    def _set_seed(self, seed: int):
        """Set random seed to ensure model initialization consistency across multiple GPUs"""
        torch.manual_seed(seed)
        np.random.seed(seed)
        random.seed(seed)
        if self.device_type == "cuda":
            torch.cuda.manual_seed_all(seed)

    def __enter__(self):
        if self.device_ctx is not None:
            self.device_ctx.__enter__()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if self.device_ctx is not None:
            self.device_ctx.__exit__(exc_type, exc_value, traceback)

    def barrier(self):
        """Synchronize all processes"""
        if dist.is_initialized():
            dist.barrier()

    def all_reduce(self, tensor: torch.Tensor, op=dist.ReduceOp.AVG):
        """All-reduce tensor across processes"""
        if dist.is_initialized():
            dist.all_reduce(tensor, op=op)
        return tensor

    # ------------------------------------------------------------------ #
    # Model helpers
    # ------------------------------------------------------------------ #
    def prepare_model(self, model: torch.nn.Module, **kwargs):
        if hasattr(model, "device"):  # make sure the matrix will be moved to the correct device
            model.device = self.device
        model = model.to(self.device)
        if self.world_size > 1:
            model = torch.nn.SyncBatchNorm.convert_sync_batchnorm(model)
            model = DistributedDataParallel(model, device_ids=[self.local_rank], **kwargs)
            self._ddp_model = model  # Save DDP model reference for no_sync support
        return model

    @contextlib.contextmanager
    def no_sync(self):
        """
        Context manager to skip gradient synchronization during gradient accumulation.
        Only used outside the last micro-batch.
        """
        if self._ddp_model is not None:
            with self._ddp_model.no_sync():
                yield
        else:
            yield

    @property
    def device(self):
        return self._device

    @property
    def supports_amp(self) -> bool:
        return self._supports_amp

    # ------------------------------------------------------------------ #
    # AMP helpers
    # ------------------------------------------------------------------ #
    def autocast(self, *args, **kwargs):
        if not self.amp:
            return contextlib.nullcontext()
        kwargs.setdefault("dtype", self.autocast_dtype)
        return torch.amp.autocast(self.device_type, enabled=True, *args, **kwargs)

    def backward(self, loss: torch.Tensor):
        self.scaler.scale(loss).backward()

    def step(self, optimizer: torch.optim.Optimizer):
        self.scaler.step(optimizer)

    def update(self):
        self.scaler.update()

    # ------------------------------------------------------------------ #
    # Data helpers
    # ------------------------------------------------------------------ #
    def prepare_dataloader(
        self,
        dataset: typing.Iterable,
        *,
        batch_size: int,
        num_workers: int = 0,
        shuffle: bool = True,
        collate_fn=None,
        drop_last: bool = False,
    ) -> torch.utils.data.DataLoader:
        if self.world_size > 1:
            sampler = torch.utils.data.distributed.DistributedSampler(
                dataset, num_replicas=self.world_size, rank=self.rank, shuffle=shuffle
            )
            shuffle = False
        else:
            sampler = None

        return torch.utils.data.DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=shuffle if sampler is None else False,
            sampler=sampler,
            num_workers=num_workers,
            collate_fn=collate_fn,
            drop_last=drop_last,
            pin_memory=self.device_type == "cuda",
        )

    @staticmethod
    def unwrap(model: torch.nn.Module) -> torch.nn.Module:
        return model.module if hasattr(model, "module") else model
