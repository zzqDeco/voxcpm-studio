#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env.demo" ]]; then
  set -a
  source "${REPO_ROOT}/.env.demo"
  set +a
fi

export DEMO_WEB_PORT="${DEMO_WEB_PORT:-5173}"
export DEMO_API_PORT="${DEMO_API_PORT:-8000}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:${DEMO_API_PORT}}"

cd "${REPO_ROOT}/apps/demo-web"

if [[ ! -d node_modules ]]; then
  npm install
fi

exec npm run dev -- --host 0.0.0.0 --port "${DEMO_WEB_PORT}"
