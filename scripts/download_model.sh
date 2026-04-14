#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env.demo" ]]; then
  set -a
  source "${REPO_ROOT}/.env.demo"
  set +a
fi

if ! command -v hf >/dev/null 2>&1; then
  echo "hf CLI is required. Install it with: pip install huggingface-hub[hf_transfer] or use the repo virtualenv." >&2
  exit 1
fi

MODEL_ID="${1:-openbmb/VoxCPM2}"
MODEL_NAME="${MODEL_ID##*/}"
MODELS_DIR="${VOXCPM_MODELS_DIR:-${REPO_ROOT}/models}"
TARGET_DIR="${MODELS_DIR}/${MODEL_NAME}"
MAX_WORKERS="${HF_DOWNLOAD_MAX_WORKERS:-4}"

mkdir -p "${MODELS_DIR}"

echo "Downloading ${MODEL_ID} -> ${TARGET_DIR}"
exec hf download "${MODEL_ID}" --local-dir "${TARGET_DIR}" --max-workers "${MAX_WORKERS}"
