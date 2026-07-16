#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${TRACEPAD_VENV:-${ROOT_DIR}/.venv}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Run ./scripts/install.sh before building a wheel." >&2
  exit 1
fi

exec "${VENV_DIR}/bin/python" "${ROOT_DIR}/scripts/build_wheel.py" --venv "${VENV_DIR}" "$@"
