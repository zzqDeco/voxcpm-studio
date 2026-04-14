#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env.demo" ]]; then
  set -a
  source "${REPO_ROOT}/.env.demo"
  set +a
fi

python3 - <<'PY'
import sys
import torch

if not torch.cuda.is_available():
    print("CUDA is not available in the current environment.", file=sys.stderr)
    raise SystemExit(1)
PY

export VOXCPM_DEVICE="cuda"
export VOXCPM_TRAIN_PRECISION="amp"
export SENSEVOICE_DEVICE="${SENSEVOICE_DEVICE:-cuda:0}"
export DEMO_RUN_MODE="native-cuda"

"${REPO_ROOT}/scripts/run_demo_api_native.sh" &
API_PID=$!

cleanup() {
  if kill -0 "${API_PID}" >/dev/null 2>&1; then
    kill "${API_PID}"
    wait "${API_PID}" || true
  fi
}

trap cleanup EXIT INT TERM

"${REPO_ROOT}/scripts/run_demo_web_native.sh"
