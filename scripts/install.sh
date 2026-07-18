#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${TRACEPAD_VENV:-${ROOT_DIR}/.venv}"

if [[ -n "${PYTHON:-}" ]]; then
  CANDIDATES=("${PYTHON}")
else
  CANDIDATES=(python3.12 python3.11 python3.10 python3.9 python3)
fi

PYTHON_BIN=""
for candidate in "${CANDIDATES[@]}"; do
  if command -v "${candidate}" >/dev/null 2>&1 && "${candidate}" -c 'import sys; raise SystemExit(sys.version_info < (3, 9))'; then
    PYTHON_BIN="${candidate}"
    break
  fi
done

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "Tracepad requires Python 3.9 or newer. Set PYTHON to a supported interpreter." >&2
  exit 1
fi

exec "${PYTHON_BIN}" "${ROOT_DIR}/scripts/install.py" --venv "${VENV_DIR}" "$@"
