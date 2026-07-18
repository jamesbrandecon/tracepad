import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from platform_support import process_command, resolve_venv, venv_executable, venv_python
from install import kernel_install_arguments
from verify_install import capture_json, verification_environment


def test_virtual_environment_paths_are_native(monkeypatch, tmp_path):
    monkeypatch.setenv("TRACEPAD_VENV", str(tmp_path / "configured"))
    assert resolve_venv() == tmp_path / "configured"
    assert venv_python(tmp_path / "env", platform_name="posix") == tmp_path / "env" / "bin" / "python"
    assert venv_python(tmp_path / "env", platform_name="nt") == tmp_path / "env" / "Scripts" / "python.exe"
    assert venv_executable(tmp_path / "env", "jupyter.exe", platform_name="nt") == tmp_path / "env" / "Scripts" / "jupyter.exe"


def test_windows_batch_commands_use_the_command_processor():
    command = process_command(
        Path("C:/Tools/pnpm.cmd"),
        ["--dir", "vscode-extension", "run", "package"],
        platform_name="nt",
        command_processor="C:/Windows/System32/cmd.exe",
    )
    assert command[:4] == ["C:/Windows/System32/cmd.exe", "/d", "/s", "/c"]
    assert "pnpm.cmd" in command[4]
    assert "vscode-extension" in command[4]


def test_native_executables_do_not_use_a_shell_wrapper():
    assert process_command("python", ["-m", "jupyter"], platform_name="posix") == [
        "python",
        "-m",
        "jupyter",
    ]


def test_install_verification_uses_an_isolated_jupyter_config(tmp_path):
    environment = verification_environment(tmp_path / "env")
    assert environment["JUPYTER_CONFIG_DIR"] == str(tmp_path / "env" / ".tracepad-jupyter-config")
    assert Path(environment["JUPYTER_CONFIG_DIR"]).is_dir()


def test_installer_registers_a_recognizable_local_kernel(tmp_path):
    venv = tmp_path / ".venv"
    assert kernel_install_arguments(venv) == [
        "-m",
        "ipykernel",
        "install",
        "--sys-prefix",
        "--name",
        "tracepad",
        "--display-name",
        "Tracepad (.venv)",
    ]


def test_json_verification_ignores_stderr_warnings(tmp_path):
    value = capture_json(
        sys.executable,
        [
            "-c",
            "import sys; print('warning', file=sys.stderr); print('{\"ready\": true}')",
        ],
        verification_environment(tmp_path / "env"),
    )
    assert value == {"ready": True}
