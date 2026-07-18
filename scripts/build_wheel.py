#!/usr/bin/env python3
"""Build a Tracepad wheel using the repository virtual environment."""

from __future__ import annotations

import argparse
import subprocess
import sys

from platform_support import ROOT_DIR, resolve_venv, venv_python


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--venv", help="Virtual environment path; defaults to TRACEPAD_VENV or .venv")
    args = parser.parse_args()
    python = venv_python(resolve_venv(args.venv))
    if not python.exists():
        print("Run the platform install script before building a wheel.", file=sys.stderr)
        return 1
    return subprocess.run(
        [str(python), "-m", "pip", "wheel", ".", "--no-deps", "--no-build-isolation", "--wheel-dir", "dist"],
        cwd=ROOT_DIR,
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
