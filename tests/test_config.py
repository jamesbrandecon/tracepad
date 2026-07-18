from pathlib import Path

import pytest

from tracepad.config import ConfigurationError, load_configuration, user_config_root


def test_builtin_profiles_do_not_choose_models(tmp_path):
    configuration, loaded = load_configuration(
        cwd=tmp_path,
        environ={"XDG_CONFIG_HOME": str(tmp_path / "none")},
    )

    assert loaded == []
    assert configuration["default_profile"] == ""
    assert all(not profile["model"] for profile in configuration["profiles"].values())


def test_windows_user_configuration_uses_appdata(tmp_path):
    assert user_config_root(
        {"APPDATA": str(tmp_path / "Roaming")},
        platform_name="win32",
    ) == tmp_path / "Roaming"


def test_explicit_config_overrides_project_and_user_files(monkeypatch, tmp_path):
    user_root = tmp_path / "user"
    user_file = user_root / "tracepad" / "config.yaml"
    user_file.parent.mkdir(parents=True)
    user_file.write_text("version: 1\ndefault_profile: openai\n", encoding="utf-8")
    (tmp_path / "tracepad.yaml").write_text(
        "version: 1\nprofiles:\n  openai:\n    provider: openai\n    model: project-model\n",
        encoding="utf-8",
    )
    explicit = tmp_path / "models.yaml"
    explicit.write_text(
        "version: 1\nprofiles:\n  openai:\n    provider: openai\n    model: explicit-model\n",
        encoding="utf-8",
    )
    environment = {
        "XDG_CONFIG_HOME": str(user_root),
        "TRACEPAD_CONFIG": str(explicit),
    }

    configuration, loaded = load_configuration(cwd=tmp_path, environ=environment)

    assert configuration["profiles"]["openai"]["model"] == "explicit-model"
    assert loaded == [
        str(user_file.resolve()),
        str((tmp_path / "tracepad.yaml").resolve()),
        str(explicit.resolve()),
    ]


def test_config_rejects_unknown_driver(tmp_path):
    config_file = tmp_path / "tracepad.yaml"
    config_file.write_text(
        "version: 1\nproviders:\n  custom:\n    driver: mystery-api\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigurationError, match="unsupported driver"):
        load_configuration(cwd=tmp_path, environ={"XDG_CONFIG_HOME": str(tmp_path / "none")})


def test_missing_explicit_config_fails_closed(tmp_path):
    missing = tmp_path / "missing.yaml"
    with pytest.raises(ConfigurationError, match="does not exist"):
        load_configuration(
            cwd=Path(tmp_path),
            environ={"XDG_CONFIG_HOME": str(tmp_path / "none"), "TRACEPAD_CONFIG": str(missing)},
        )
