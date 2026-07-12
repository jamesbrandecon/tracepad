"""Layered, non-secret configuration for Tracepad model profiles."""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any, Mapping

import yaml


SUPPORTED_DRIVERS = {"ollama-chat", "openai-responses", "openai-chat"}

DEFAULT_CONFIGURATION: dict[str, Any] = {
    "version": 1,
    "default_profile": "",
    "providers": {
        "ollama": {
            "label": "Ollama",
            "driver": "ollama-chat",
            "base_url": "http://127.0.0.1:11434",
            "base_url_env": "OLLAMA_HOST",
            "discover_models": True,
            "requires_api_key": False,
        },
        "openai": {
            "label": "OpenAI",
            "driver": "openai-responses",
            "base_url": "https://api.openai.com/v1",
            "api_key_env": "OPENAI_API_KEY",
            "requires_api_key": True,
        },
        "openrouter": {
            "label": "OpenRouter",
            "driver": "openai-chat",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key_env": "OPENROUTER_API_KEY",
            "requires_api_key": True,
            "headers": {
                "HTTP-Referer": "https://github.com/tracepad/tracepad",
                "X-Title": "Tracepad",
            },
        },
    },
    "profiles": {
        "ollama": {
            "label": "Ollama local",
            "provider": "ollama",
            "model": "",
            "model_env": "TRACEPAD_OLLAMA_MODEL",
            "parameters": {"temperature": 0.1},
        },
        "openai": {
            "label": "OpenAI",
            "provider": "openai",
            "model": "gpt-5.4-mini",
            "model_env": "TRACEPAD_OPENAI_MODEL",
            "parameters": {"max_output_tokens": 1800},
        },
        "openrouter": {
            "label": "OpenRouter",
            "provider": "openrouter",
            "model": "",
            "model_env": "TRACEPAD_OPENROUTER_MODEL",
            "parameters": {
                "temperature": 0.1,
                "max_tokens": 1800,
                "response_format": {"type": "json_object"},
            },
        },
    },
}


class ConfigurationError(RuntimeError):
    """Raised when a Tracepad YAML file is malformed or inconsistent."""


def load_configuration(
    *,
    cwd: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Load defaults, user config, project config, then an explicit config."""

    environment = os.environ if environ is None else environ
    root = Path.cwd() if cwd is None else Path(cwd)
    xdg_root = Path(environment.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    paths = [xdg_root / "tracepad" / "config.yaml", root / "tracepad.yaml"]
    explicit = environment.get("TRACEPAD_CONFIG", "").strip()
    if explicit:
        paths.append(Path(explicit).expanduser())

    configuration = copy.deepcopy(DEFAULT_CONFIGURATION)
    loaded: list[str] = []
    seen: set[Path] = set()
    for path in paths:
        normalized = path.resolve()
        if normalized in seen:
            continue
        seen.add(normalized)
        if not path.exists():
            if explicit and path == paths[-1]:
                raise ConfigurationError(f"TRACEPAD_CONFIG does not exist: {path}")
            continue
        configuration = _deep_merge(configuration, _read_yaml(path))
        loaded.append(str(normalized))

    return _validate(configuration), loaded


def _read_yaml(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise ConfigurationError(f"Could not read Tracepad config {path}: {error}") from error
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigurationError(f"Tracepad config {path} must contain a YAML mapping.")
    return value


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def _validate(configuration: dict[str, Any]) -> dict[str, Any]:
    if configuration.get("version") != 1:
        raise ConfigurationError("Tracepad config version must be 1.")
    providers = configuration.get("providers")
    profiles = configuration.get("profiles")
    if not isinstance(providers, dict) or not isinstance(profiles, dict):
        raise ConfigurationError("Tracepad config requires providers and profiles mappings.")

    normalized_providers: dict[str, dict[str, Any]] = {}
    for provider_id, raw_provider in providers.items():
        if not isinstance(provider_id, str) or not isinstance(raw_provider, dict):
            raise ConfigurationError("Each provider must be a named mapping.")
        if raw_provider.get("enabled", True) is False:
            continue
        driver = str(raw_provider.get("driver", "")).strip()
        if driver not in SUPPORTED_DRIVERS:
            raise ConfigurationError(
                f"Provider {provider_id!r} uses unsupported driver {driver!r}. "
                f"Choose one of {', '.join(sorted(SUPPORTED_DRIVERS))}."
            )
        provider = copy.deepcopy(raw_provider)
        provider.update(
            id=provider_id,
            label=str(provider.get("label") or provider_id),
            driver=driver,
            base_url=str(provider.get("base_url", "")).strip().rstrip("/"),
            api_key_env=str(provider.get("api_key_env", "")).strip(),
            base_url_env=str(provider.get("base_url_env", "")).strip(),
            requires_api_key=bool(provider.get("requires_api_key", bool(provider.get("api_key_env")))),
            discover_models=bool(provider.get("discover_models", False)),
        )
        headers = provider.get("headers", {})
        if not isinstance(headers, dict):
            raise ConfigurationError(f"Provider {provider_id!r} headers must be a mapping.")
        provider["headers"] = {str(key): str(value) for key, value in headers.items()}
        normalized_providers[provider_id] = provider

    normalized_profiles: dict[str, dict[str, Any]] = {}
    for profile_id, raw_profile in profiles.items():
        if not isinstance(profile_id, str) or not isinstance(raw_profile, dict):
            raise ConfigurationError("Each model profile must be a named mapping.")
        if raw_profile.get("enabled", True) is False:
            continue
        provider_id = str(raw_profile.get("provider", "")).strip()
        if provider_id not in normalized_providers:
            raise ConfigurationError(
                f"Profile {profile_id!r} references unknown provider {provider_id!r}."
            )
        parameters = raw_profile.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ConfigurationError(f"Profile {profile_id!r} parameters must be a mapping.")
        profile = copy.deepcopy(raw_profile)
        profile.update(
            id=profile_id,
            label=str(profile.get("label") or profile_id),
            provider=provider_id,
            model=str(profile.get("model", "")).strip(),
            model_env=str(profile.get("model_env", "")).strip(),
            parameters=parameters,
        )
        normalized_profiles[profile_id] = profile

    default_profile = str(configuration.get("default_profile", "")).strip()
    if default_profile and default_profile not in normalized_profiles:
        raise ConfigurationError(f"Unknown default_profile {default_profile!r}.")
    if not normalized_profiles:
        raise ConfigurationError("Tracepad config must enable at least one model profile.")

    return {
        "version": 1,
        "default_profile": default_profile,
        "providers": normalized_providers,
        "profiles": normalized_profiles,
    }
