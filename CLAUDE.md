# CLAUDE.md

This file provides development guidance for code assistants working in this repository.

## Project Overview

VoxCPM Studio is a standalone local workbench for VoxCPM models. It combines:

- a FastAPI backend for inference, training, bench, and history
- a React frontend for local model testing and comparison
- the VoxCPM runtime package under `src/voxcpm`

The repository is independent from `OpenBMB/VoxCPM` in layout and Git history, but keeps the upstream license and runtime compatibility.

## Build & Development Commands

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[demo]"
PATH="$PWD/.venv/bin:$PATH" ./scripts/download_model.sh
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_api_native.sh
./scripts/run_demo_web_native.sh
```

Frontend only:

```bash
cd apps/demo-web
npm install
npm run dev
npm run build
```

Verification:

```bash
python3 -m compileall apps/demo-api src scripts
cd apps/demo-web && npm run build
```

## Architecture

### Backend

- `apps/demo-api/main.py` boots the FastAPI app
- `demo_api/app.py` defines HTTP and WebSocket routes
- `demo_api/runtime.py` owns:
  - runtime capabilities
  - model / LoRA discovery
  - inference and streaming execution
  - ASR helper wiring
  - training subprocess orchestration
  - bench jobs and history
- `demo_api/storage.py` stores metadata in SQLite
- `demo_api/utils.py` handles metrics, waveform, mel generation, and artifact helpers

### Frontend

- `apps/demo-web/src/App.tsx` contains the current studio shell
- tabs:
  - Playground
  - Compare
  - Bench
  - Training
  - History
- frontend assumes the backend API shape stays stable

### Runtime Package

- `src/voxcpm` contains the runnable VoxCPM package and training helpers
- `scripts/train_voxcpm_finetune.py` is intentionally kept in-repo as the canonical training entry

## Important Constraints

- Keep Python package import path as `voxcpm`
- Keep API compatibility for the current React frontend
- Do not commit model weights, LoRA weights, or demo artifacts
- Preserve MPS training support:
  - LoRA = recommended path
  - Full FT = experimental on MPS
  - FP32 = default on MPS

## Branch & Doc Workflow

- `master` is the trunk branch
- `dev` is the development buffer branch
- topic branches are created from `dev`
- merge topic branches into `dev` first, then merge `dev` into `master`

Allowed topic branch prefixes:

- `feat/`
- `fix/`
- `docs/`
- `plan/`

Documentation model:

- `plan/` = active implementation plans only
- `doc/src/` = per-file technical notes
- `doc/` = project-level docs, research, and process notes

Any structural or behavioral change should update the corresponding `doc/src/...plan.md` file and the relevant project-level docs.
