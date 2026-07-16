#!/usr/bin/env python3
"""Build and optionally install the private Tracepad VS Code extension."""

from __future__ import annotations

import argparse
import subprocess
import sys

from platform_support import ROOT_DIR, find_command, process_command, run_checked


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-only", action="store_true", help="Build the VSIX without installing it")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pnpm = find_command("pnpm")
    corepack = find_command("corepack")
    if pnpm:
        package_manager = (pnpm, [])
    elif corepack:
        package_manager = (corepack, ["pnpm"])
    else:
        print("Tracepad for VS Code requires pnpm or Node.js Corepack.", file=sys.stderr)
        return 1

    executable, prefix = package_manager
    run_checked(executable, [*prefix, "install", "--frozen-lockfile"])
    run_checked(executable, [*prefix, "--dir", "vscode-extension", "run", "package"])
    vsix = ROOT_DIR / "vscode-extension" / "dist" / "tracepad-vscode.vsix"

    if args.build_only:
        print(f"Tracepad VSIX built at {vsix}")
        return 0

    code = find_command("code")
    if not code:
        print("VS Code's 'code' command is not on PATH. Build completed, but installation was skipped.", file=sys.stderr)
        print(f"Install {vsix} from VS Code's 'Install from VSIX' command.", file=sys.stderr)
        return 1
    run_checked(code, ["--install-extension", "ms-toolsai.jupyter"])
    run_checked(code, ["--install-extension", str(vsix), "--force"])
    installed = subprocess.run(
        process_command(code, ["--list-extensions", "--show-versions"]),
        cwd=ROOT_DIR,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.lower()
    for extension in ("ms-toolsai.jupyter", "tracepad.tracepad-vscode"):
        if extension not in installed:
            print(f"VS Code did not report {extension} after installation.", file=sys.stderr)
            return 1
    print("Tracepad for VS Code is installed. Reload VS Code before opening a notebook.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
