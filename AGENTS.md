# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

VoxCPM Studio is a standalone local workbench for VoxCPM models.

- Backend: Go API control plane + Python worker / training scripts
- Frontend: React + TypeScript + Vite
- Runtime: `src/voxcpm`
- Training: local LoRA / Full FT entry via `scripts/train_voxcpm_finetune.py`

The repository focuses on local inference, evaluation, and training workflows.

## Build and Development

From repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[demo]"
PATH="$PWD/.venv/bin:$PATH" ./scripts/download_model.sh
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_api_native.sh
./scripts/run_demo_web_native.sh
```

From `apps/demo-web/`:

```bash
npm install
npm run dev
npm run build
```

Verification commands:

```bash
python3 -m compileall apps/demo-api src scripts
cd apps/demo-api && go test ./...
cd apps/demo-web && npm run build
```

## Architecture

### Backend

- `apps/demo-api` contains the Go API and legacy Python runtime reference for:
  - model scanning and loading
  - inference and streaming
  - ASR
  - bench runs
  - training orchestration
  - history and checkpoints
- `apps/demo-api/internal/demoapi` is the Go API control plane.
- `apps/demo-worker/bridge.py` calls the Python runtime for model execution.
- `apps/demo-api/demo_api/runtime.py` remains the Python model execution baseline used by the worker.
- Persistence is local SQLite plus file artifacts under `demo-data/`.

### Frontend

- `apps/demo-web` is a React workbench with 5 tabs:
  - Playground
  - Compare
  - Bench
  - Training
  - History
- It only talks to the backend through HTTP / WebSocket.

### Runtime and Training

- `src/voxcpm` remains the Python package name.
- `scripts/train_voxcpm_finetune.py` is the training entrypoint.
- MPS support is intentionally kept:
  - LoRA is the recommended MPS path
  - Full FT on MPS is experimental
  - FP32 is the default on MPS

## Engineering Workflow

### Branching

- Trunk branch: `master`
- Development branch: `dev`
- Do not push routine changes directly to `master`
- Topic branches are created from `dev`

Allowed topic branch prefixes:

- `feat/<desc>`
- `fix/<desc>`
- `docs/<desc>`
- `plan/<desc>`
- `refactor/<desc>`

### Pull Request Flow

1. Branch from `dev`
2. Implement and verify the change
3. Update the required docs
4. Open PR to `dev`
5. Merge `dev` to `master` only after integration is verified

### Commit Messages

Use conventional commits:

```text
<type>(<scope>): <subject>
```

Common scopes:

- `demo-api`
- `demo-web`
- `runtime`
- `training`
- `docs`
- `build`

## Documentation Sync Rules

This repository follows the same doc layering model as `starxo`.

- `plan/` stores only active implementation plans
- `doc/src/` stores per-file technical notes for current code shape
- `doc/` top level stores overview, research, and documentation workflow notes

Whenever behavior or structure changes:

1. Update the corresponding `doc/src/...plan.md`
2. Update project-level docs if workflow or architecture changed:
   - `README.md`
   - `README_CN.md`
   - `AGENTS.md`
   - `CLAUDE.md`
   - `doc/README.md`
   - `plan/README.md`

## Review Checklist

Before finalizing changes, verify:

- runtime correctness and regression risk
- API compatibility for existing frontend calls
- MPS / CUDA behavior remains explicit and documented
- startup scripts still work from repo root
- docs are updated for any behavior, workflow, or interface change
