#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env.demo" ]]; then
  set -a
  source "${REPO_ROOT}/.env.demo"
  set +a
fi

if python3 - <<'PY'
import sys
import torch

available = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
raise SystemExit(0 if available else 1)
PY
then
  export VOXCPM_DEVICE="mps"
  export DEMO_RUN_MODE="native-mps"
  echo "Starting demo in native-mps mode."
else
  export VOXCPM_DEVICE="cpu"
  export DEMO_RUN_MODE="native-cpu"
  echo "MPS is not available. Falling back to CPU."
fi

export VOXCPM_TRAIN_PRECISION="fp32"
export SENSEVOICE_DEVICE="${SENSEVOICE_DEVICE:-cpu}"

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
