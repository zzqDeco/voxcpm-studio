#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env.demo" ]]; then
  set -a
  source "${REPO_ROOT}/.env.demo"
  set +a
fi

export VOXCPM_MODELS_DIR="${VOXCPM_MODELS_DIR:-${REPO_ROOT}/models}"
export VOXCPM_LORA_DIR="${VOXCPM_LORA_DIR:-${REPO_ROOT}/lora}"
export VOXCPM_DATA_DIR="${VOXCPM_DATA_DIR:-${REPO_ROOT}/demo-data}"
export VOXCPM_DEVICE="${VOXCPM_DEVICE:-auto}"
export VOXCPM_TRAIN_PRECISION="${VOXCPM_TRAIN_PRECISION:-auto}"
export SENSEVOICE_DEVICE="${SENSEVOICE_DEVICE:-auto}"
export DEMO_RUN_MODE="${DEMO_RUN_MODE:-native-cpu}"
export DEMO_API_HOST="${DEMO_API_HOST:-0.0.0.0}"
export DEMO_API_PORT="${DEMO_API_PORT:-8000}"

exec python3 -m uvicorn main:app \
  --host "${DEMO_API_HOST}" \
  --port "${DEMO_API_PORT}" \
  --app-dir "${REPO_ROOT}/apps/demo-api"
