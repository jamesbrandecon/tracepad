#!/usr/bin/env python3
"""Launch the Tracepad demo with the repository virtual environment."""

from __future__ import annotations

import argparse
import subprocess
import sys

from platform_support import ROOT_DIR, resolve_venv, venv_executable, venv_python


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--venv", help="Virtual environment path; defaults to TRACEPAD_VENV or .venv")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print the launch command")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    venv = resolve_venv(args.venv)
    python = venv_python(venv)
    if not python.exists():
        print("Tracepad is not installed. Run the platform install script first.", file=sys.stderr)
        return 1

    notebook = ROOT_DIR / "tracepad_demo.ipynb"
    jupyter = venv_executable(venv, "jupyter")
    if not jupyter.exists():
        print("Jupyter is missing from the Tracepad virtual environment. Re-run the installer.", file=sys.stderr)
        return 1
    command = [str(jupyter), "lab", str(notebook)]
    if args.dry_run:
        print(" ".join(command))
        return 0
    return subprocess.run(command, cwd=ROOT_DIR, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
