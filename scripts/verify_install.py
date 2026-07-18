#!/usr/bin/env python3
"""Verify a Tracepad virtual environment without opening a browser."""

from __future__ import annotations

import argparse
import json
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


def kernelspec_path(venv: Path) -> Path:
    return venv / "share" / "jupyter" / "kernels" / "tracepad" / "kernel.json"


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
    kernel_file = kernelspec_path(venv)
    if "tracepad" not in server.lower():
        raise RuntimeError("Tracepad's Jupyter server extension is not enabled.")
    if "@tracepad/jupyterlab" not in lab.lower():
        raise RuntimeError("Tracepad's JupyterLab extension is not installed.")
    if not kernel_file.is_file():
        raise RuntimeError("Tracepad's local Python kernelspec is not installed.")
    kernel = json.loads(kernel_file.read_text(encoding="utf-8"))
    arguments = kernel.get("argv", [])
    kernel_python = Path(arguments[0]) if arguments else None
    if kernel.get("language") != "python" or not kernel_python or not kernel_python.exists():
        raise RuntimeError("Tracepad's local Python kernelspec does not point to a working interpreter.")

    print(f"Tracepad {version}: Python import OK")
    print("Tracepad Jupyter server extension: OK")
    print("Tracepad JupyterLab extension: OK")
    print("Tracepad Python kernel: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
