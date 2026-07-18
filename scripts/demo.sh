#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${TRACEPAD_VENV:-${ROOT_DIR}/.venv}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Tracepad is not installed. Run ./scripts/install.sh first." >&2
  exit 1
fi

exec "${VENV_DIR}/bin/python" "${ROOT_DIR}/scripts/demo.py" --venv "${VENV_DIR}" "$@"
