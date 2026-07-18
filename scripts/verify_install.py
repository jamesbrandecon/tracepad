#!/usr/bin/env python3
"""Verify a Tracepad virtual environment without opening a browser."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from platform_support import ROOT_DIR, resolve_venv, venv_executable, venv_python


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--venv", help="Virtual environment path; defaults to TRACEPAD_VENV or .venv")
    return parser.parse_args()


def verification_environment(venv: Path) -> dict[str, str]:
    environment = dict(os.environ)
    config_dir = venv / ".tracepad-jupyter-config"
    config_dir.mkdir(parents=True, exist_ok=True)
    environment["JUPYTER_CONFIG_DIR"] = str(config_dir)
    return environment


def capture(executable: str, arguments: list[str], environment: dict[str, str]) -> str:
    result = subprocess.run(
        [executable, *arguments],
        cwd=ROOT_DIR,
        env=environment,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return result.stdout


def main() -> int:
    args = parse_args()
    venv = resolve_venv(args.venv)
    python_path = venv_python(venv)
    if not python_path.exists():
        print("Tracepad virtual environment was not found.", file=sys.stderr)
        return 1
    python = str(python_path)
    jupyter_path = venv_executable(venv, "jupyter")
    if not jupyter_path.exists():
        print("Jupyter launcher was not found in the Tracepad virtual environment.", file=sys.stderr)
        return 1
    jupyter = str(jupyter_path)
    environment = verification_environment(venv)

    version = capture(python, ["-c", "import tracepad; print(tracepad.__version__)"], environment).strip()
    server = capture(jupyter, ["server", "extension", "list"], environment)
    lab = capture(jupyter, ["labextension", "list"], environment)
    if "tracepad" not in server.lower():
        raise RuntimeError("Tracepad's Jupyter server extension is not enabled.")
    if "@tracepad/jupyterlab" not in lab.lower():
        raise RuntimeError("Tracepad's JupyterLab extension is not installed.")

    print(f"Tracepad {version}: Python import OK")
    print("Tracepad Jupyter server extension: OK")
    print("Tracepad JupyterLab extension: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
