#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${TRACEPAD_VENV:-${ROOT_DIR}/.venv}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Run ./scripts/install.sh before building a wheel." >&2
  exit 1
fi

cd "${ROOT_DIR}"
"${VENV_DIR}/bin/python" -m pip wheel . --no-deps --no-build-isolation --wheel-dir dist
