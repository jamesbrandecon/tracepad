#!/usr/bin/env python3
"""Install Tracepad and its demo dependencies into a local virtual environment."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from platform_support import ROOT_DIR, resolve_venv, venv_python


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--venv", help="Virtual environment path; defaults to TRACEPAD_VENV or .venv")
    parser.add_argument(
        "--minimal",
        action="store_true",
        help="Install Tracepad without the pandas/matplotlib/statsmodels demo dependencies",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if sys.version_info < (3, 9):
        print("Tracepad requires Python 3.9 or newer.", file=sys.stderr)
        return 1

    venv = resolve_venv(args.venv)
    python = venv_python(venv)
    if not python.exists():
        venv.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)

    requirement = f"{ROOT_DIR}{'' if args.minimal else '[demo]'}"
    subprocess.run([str(python), "-m", "pip", "install", requirement], cwd=ROOT_DIR, check=True)

    print(f"\nTracepad is installed in {venv}")
    if sys.platform == "win32":
        print(r"Run .\scripts\demo.ps1 to open the guided notebook.")
    else:
        print("Run ./scripts/demo.sh to open the guided notebook.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
