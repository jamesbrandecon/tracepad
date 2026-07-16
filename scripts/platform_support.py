"""Cross-platform process and virtual-environment helpers for Tracepad scripts."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Sequence


ROOT_DIR = Path(__file__).resolve().parents[1]


def resolve_venv(value: str | os.PathLike[str] | None = None) -> Path:
    configured = value or os.environ.get("TRACEPAD_VENV") or ROOT_DIR / ".venv"
    path = Path(configured).expanduser()
    return path if path.is_absolute() else (ROOT_DIR / path).resolve()


def venv_executable(
    venv: Path,
    name: str,
    *,
    platform_name: str | None = None,
) -> Path:
    platform_name = platform_name or os.name
    if platform_name == "nt":
        suffix = "" if Path(name).suffix else ".exe"
        return venv / "Scripts" / f"{name}{suffix}"
    return venv / "bin" / name


def venv_python(venv: Path, *, platform_name: str | None = None) -> Path:
    return venv_executable(venv, "python", platform_name=platform_name)


def find_command(name: str) -> str | None:
    return shutil.which(name)


def process_command(
    executable: str | os.PathLike[str],
    arguments: Sequence[str],
    *,
    platform_name: str | None = None,
    command_processor: str | None = None,
) -> list[str]:
    """Return a subprocess-safe command, including Windows batch wrappers."""
    platform_name = platform_name or os.name
    executable_text = str(executable)
    values = [executable_text, *map(str, arguments)]
    if platform_name == "nt" and Path(executable_text).suffix.lower() in {".bat", ".cmd"}:
        processor = command_processor or os.environ.get("COMSPEC", "cmd.exe")
        return [processor, "/d", "/s", "/c", subprocess.list2cmdline(values)]
    return values


def run_checked(
    executable: str | os.PathLike[str],
    arguments: Sequence[str],
    *,
    cwd: Path = ROOT_DIR,
) -> None:
    subprocess.run(process_command(executable, arguments), cwd=cwd, check=True)
