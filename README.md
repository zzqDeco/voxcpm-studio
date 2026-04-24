# VoxCPM Studio

[中文说明](README_CN.md)

## About

VoxCPM Studio is a standalone local workbench for `VoxCPM` models. It packages:

- Go API control plane for local runtime, inference bridge, training, bench, and history
- Python worker and training scripts for VoxCPM model execution
- React + Vite frontend for local model testing
- Native startup scripts for CUDA and MPS
- Docker Compose startup path for CUDA

This repository is maintained independently from `OpenBMB/VoxCPM`, while keeping
the upstream Apache-2.0 license and compatible runtime APIs.

## Features

- **Playground**: zero-shot voice design, controlled clone, ultimate clone, streaming inference
- **Compare**: side-by-side run comparison for audio, mel, ASR, CER/WER, and runtime metrics
- **Bench**: fixed local scenario batches across models, LoRA checkpoints, and devices
- **Training**: LoRA and Full FT entry points, with MPS-aware defaults and runtime status
- **History**: persistent local run records, metrics, waveforms, and logs

## Tech Stack

- Backend: Go 1.22 API control plane, Python 3.10+ worker, PyTorch, VoxCPM runtime
- Frontend: React 18, TypeScript, Vite 5
- Model runtime: `src/voxcpm`
- Local persistence: SQLite + artifact files under `demo-data/`

## Repository Layout

```text
voxcpm-studio/
├── apps/
│   ├── demo-api/      # Go API and legacy FastAPI reference
│   ├── demo-worker/   # Python worker bridge for model execution
│   └── demo-web/      # React frontend
├── conf/              # Packaged training config presets
├── src/voxcpm/        # VoxCPM runtime and training implementation
├── scripts/           # Startup, model download, and training entry scripts
├── examples/          # Reference assets used by demo and bench flows
├── doc/               # Technical documentation and research notes
├── plan/              # Active implementation plans only
├── README.md
├── README_CN.md
├── AGENTS.md
└── CLAUDE.md
```

## Quick Start

### 1. Create an environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e ".[demo]"
```

### 2. Install frontend dependencies

```bash
cd apps/demo-web
npm install
cd ../..
```

### 3. Configure local paths

```bash
cp .env.demo.example .env.demo
```

### 4. Download a model

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/download_model.sh
```

By default this downloads `openbmb/VoxCPM2` into `models/VoxCPM2`.

## Startup

Native MPS:

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_mps.sh
```

Native CUDA:

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_cuda.sh
```

Backend and frontend separately:

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_api_go_native.sh
./scripts/run_demo_web_native.sh
```

Legacy FastAPI backend remains available as a migration reference:

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_api_native.sh
```

Docker Compose for CUDA:

```bash
docker compose -f docker-compose.demo.yml up --build
```

## Default URLs

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

## Branch Workflow

- `master` is the trunk branch
- `dev` is the development buffer branch
- Topic branches are created from `dev`
- Routine changes merge into `dev` first, then `dev` is merged into `master`

## Documentation Workflow

- `plan/` stores only active implementation plans
- `doc/src/` stores per-file technical notes
- `doc/` stores project-level docs, research, and documentation rules

See:

- `doc/README.md`
- `plan/README.md`
- `AGENTS.md`
- `CLAUDE.md`
