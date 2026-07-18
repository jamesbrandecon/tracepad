"""Authenticated AI-provider and generation endpoints for Tracepad."""

from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.web import authenticated

from .config import ConfigurationError, load_configuration


DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OPENAI_URL = "https://api.openai.com/v1"
DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1"

# Values entered in Tracepad are intentionally process-local. Keys are never
# returned to the browser, written to notebooks, or persisted to disk.
_SESSION_CONFIG: dict[str, str] = {}

_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?"
            r"-----END(?: [A-Z]+)? PRIVATE KEY-----",
            re.IGNORECASE,
        ),
        "[REDACTED]",
    ),
    (re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b"), "[REDACTED]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"), "[REDACTED]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "[REDACTED]"),
    (
        re.compile(r"(https?://[^:\s/]+:)[^@\s/]+@", re.IGNORECASE),
        r"\1[REDACTED]@",
    ),
    (
        re.compile(
            r"(\b(?:authorization|api[_-]?key|access[_-]?token|auth[_-]?token|"
            r"password|passwd|secret)\b\s*(?:=|:)\s*)(['\"])([^'\"\n]+)\2",
            re.IGNORECASE,
        ),
        r"\1\2[REDACTED]\2",
    ),
    (
        re.compile(
            r"(\b(?:authorization|api[_-]?key|access[_-]?token|auth[_-]?token|"
            r"password|passwd|secret)\b\s*(?:=|:)\s*)(?!['\"])([^\s,;]+)",
            re.IGNORECASE,
        ),
        r"\1[REDACTED]",
    ),
)


def _clean_language(value: object) -> str:
    language = str(value or "python").lower()
    return language if language in {"python", "r", "julia", "sql"} else "python"


def _clean_base_url(value: object, default: str) -> str:
    url = str(value or default).strip().rstrip("/")
    if "://" not in url:
        url = f"http://{url}"
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("Provider URL must be an http or https URL.")
    return url


def _redact_sensitive_text(value: str) -> str:
    """Best-effort removal of common credentials before provider requests."""

    redacted = value
    for pattern, replacement in _SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def _redact_generation_context(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_sensitive_text(value)
    if isinstance(value, list):
        return [_redact_generation_context(item) for item in value]
    if isinstance(value, tuple):
        return [_redact_generation_context(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _redact_generation_context(item)
            for key, item in value.items()
        }
    return value


def _json_request(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 45,
) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Provider returned HTTP {error.code}: {details}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach provider: {error.reason}") from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise RuntimeError("Provider returned an invalid JSON response.") from error
    if not isinstance(result, dict):
        raise RuntimeError("Provider returned an unexpected response.")
    return result


def _ollama_models(base_url: str) -> tuple[list[str], str | None]:
    try:
        payload = _json_request(f"{base_url}/api/tags", timeout=2)
        models = [
            str(item.get("name", "")).strip()
            for item in payload.get("models", [])
            if isinstance(item, dict) and str(item.get("name", "")).strip()
        ]
        return models, None
    except RuntimeError as error:
        return [], str(error)


def _resolved_registry() -> dict[str, Any]:
    configuration, config_files = load_configuration()
    providers: dict[str, dict[str, Any]] = {}
    for provider_id, specification in configuration["providers"].items():
        base_url = _SESSION_CONFIG.get(f"provider:{provider_id}:base_url", "")
        if not base_url and specification.get("base_url_env"):
            base_url = os.environ.get(str(specification["base_url_env"]), "")
        base_url = _clean_base_url(base_url, str(specification.get("base_url", "")))

        api_key = _SESSION_CONFIG.get(f"provider:{provider_id}:api_key", "")
        if not api_key and specification.get("api_key_env"):
            api_key = os.environ.get(str(specification["api_key_env"]), "").strip()

        models: list[str] = []
        discovery_error: str | None = None
        if specification.get("discover_models"):
            models, discovery_error = _ollama_models(base_url)

        requires_key = bool(specification.get("requires_api_key"))
        available = discovery_error is None and (bool(api_key) or not requires_key)
        error = discovery_error
        if requires_key and not api_key:
            error = f"API key not configured in {specification.get('api_key_env') or 'the server environment'}."
        providers[provider_id] = {
            **specification,
            "base_url": base_url,
            "api_key": api_key,
            "models": models,
            "available": available,
            "error": error,
        }

    profiles: dict[str, dict[str, Any]] = {}
    for profile_id, specification in configuration["profiles"].items():
        provider = providers[specification["provider"]]
        model = _SESSION_CONFIG.get(f"profile:{profile_id}:model", "")
        if not model and specification.get("model_env"):
            model = os.environ.get(str(specification["model_env"]), "").strip()
        if not model:
            model = str(specification.get("model", "")).strip()
        if not model and provider["models"]:
            model = provider["models"][0]
        configured = bool(model and provider["available"])
        error = provider["error"] or (None if model else "A model name is required.")
        profiles[profile_id] = {
            **specification,
            "model": model,
            "configured": configured,
            "available": provider["available"],
            "error": error,
        }

    requested = _SESSION_CONFIG.get("profile", "").strip()
    if not requested:
        requested = os.environ.get("TRACEPAD_PROFILE", "").strip()
    if not requested:
        requested = os.environ.get("TRACEPAD_PROVIDER", "").strip()
    if requested and requested not in profiles:
        requested = next(
            (profile_id for profile_id, profile in profiles.items() if profile["provider"] == requested),
            requested,
        )
    if not requested:
        requested = configuration.get("default_profile", "")
    if requested and requested not in profiles:
        raise ConfigurationError(f"Unknown Tracepad profile {requested!r}.")
    active_profile = requested
    return {
        "providers": providers,
        "profiles": profiles,
        "active_profile": active_profile,
        "config_files": config_files,
    }


def _provider_status() -> dict[str, Any]:
    registry = _resolved_registry()
    active_profile_id = registry["active_profile"]
    active_profile = registry["profiles"].get(active_profile_id)
    providers = []
    for provider_id, provider in registry["providers"].items():
        provider_profiles = [
            profile for profile in registry["profiles"].values() if profile["provider"] == provider_id
        ]
        provider_models = list(dict.fromkeys([
            *provider["models"],
            *(profile["model"] for profile in provider_profiles if profile["model"]),
        ]))
        providers.append({
            "id": provider_id,
            "label": provider["label"],
            "driver": provider["driver"],
            "configured": any(profile["configured"] for profile in provider_profiles),
            "available": provider["available"],
            "model": provider_profiles[0]["model"] if provider_profiles else "",
            "models": provider_models,
            "base_url": provider["base_url"],
            "requires_api_key": provider["requires_api_key"],
            "error": provider["error"],
        })
    profiles = [{
        "id": profile_id,
        "label": profile["label"],
        "provider": profile["provider"],
        "model": profile["model"],
        "configured": profile["configured"],
        "available": profile["available"],
        "error": profile["error"],
    } for profile_id, profile in registry["profiles"].items()]
    ready = bool(active_profile and active_profile["configured"])
    return {
        "ok": True,
        "ready": ready,
        "active_profile": active_profile_id or None,
        "active_provider": active_profile["provider"] if active_profile else None,
        "active_model": active_profile["model"] if ready else None,
        "providers": providers,
        "profiles": profiles,
        "config_files": registry["config_files"],
    }


def _configure_provider(body: dict[str, Any]) -> dict[str, Any]:
    registry = _resolved_registry()
    profile_id = str(body.get("profile", "")).strip()
    legacy_provider = str(body.get("provider", "")).strip()
    if not profile_id and legacy_provider:
        profile_id = legacy_provider if legacy_provider in registry["profiles"] else next(
            (key for key, profile in registry["profiles"].items() if profile["provider"] == legacy_provider),
            "",
        )
    if profile_id not in registry["profiles"]:
        raise RuntimeError("Choose a configured Tracepad model profile.")

    profile = registry["profiles"][profile_id]
    provider_id = profile["provider"]
    model = str(body.get("model", "")).strip()
    if model:
        _SESSION_CONFIG[f"profile:{profile_id}:model"] = model
    if "base_url" in body and str(body.get("base_url", "")).strip():
        _SESSION_CONFIG[f"provider:{provider_id}:base_url"] = _clean_base_url(body["base_url"], "")
    api_key = str(body.get("api_key", "")).strip()
    if api_key:
        _SESSION_CONFIG[f"provider:{provider_id}:api_key"] = api_key
    _SESSION_CONFIG["profile"] = profile_id

    status = _provider_status()
    if not status["ready"]:
        selected = next(item for item in status["profiles"] if item["id"] == profile_id)
        raise RuntimeError(str(selected.get("error") or "A model name is required."))
    return status


def _system_instructions() -> str:
    return (
        "You generate concise, executable notebook code. Return JSON only with keys "
        "code and notes. The code value must be one string containing the entire program, "
        "never an array. Use the supplied kernel language and do not include markdown "
        "fences. Do not generate code that embeds, prints, or requests secrets; use "
        "environment variables or established credential providers. Use existing notebook "
        "variables and Tracepad references "
        "when supplied. Make the final expression the table, plot, or model the user is "
        "most likely to inspect. For model objects, preserve the fitted object as the final "
        "expression so Tracepad can discover summary, coefficients, fitted values, predict, "
        "and plot capabilities. Tracepad handles display, result registration, and lineage "
        "tracking after execution."
    )


def _generation_input(prompt: str, language: str, context: Dict[str, Any]) -> str:
    return "\n".join([
        f"Kernel language: {language}",
        f"User request: {_redact_sensitive_text(prompt)}",
        f"Notebook context: {json.dumps(_redact_generation_context(context), ensure_ascii=True)}",
    ])


def _parse_generation(raw: str, provider: str) -> dict[str, str]:
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()).strip()
    try:
        result = json.loads(clean)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{provider} returned code outside the expected JSON contract.") from error
    if not isinstance(result, dict):
        raise RuntimeError(f"{provider} returned an unexpected response.")
    code = str(result.get("code", "")).strip()
    if not code:
        raise RuntimeError(f"{provider} returned empty code.")
    return {"code": code, "notes": str(result.get("notes", "Generated by AI."))}


def _apply_parameters(
    payload: dict[str, Any],
    parameters: dict[str, Any],
    protected: set[str],
) -> dict[str, Any]:
    for key, value in parameters.items():
        if key in protected:
            continue
        if value is None:
            payload.pop(key, None)
        else:
            payload[key] = value
    return payload


def _provider_headers(provider: dict[str, Any]) -> dict[str, str]:
    headers = dict(provider.get("headers", {}))
    if provider.get("api_key"):
        headers["Authorization"] = f"Bearer {provider['api_key']}"
    return headers


def _openai_generation(
    prompt: str,
    language: str,
    context: Dict[str, Any],
    model: str,
    *,
    provider: dict[str, Any] | None = None,
    parameters: dict[str, Any] | None = None,
) -> dict[str, str]:
    runtime = provider or {
        "label": "OpenAI",
        "base_url": DEFAULT_OPENAI_URL,
        "api_key": os.environ.get("OPENAI_API_KEY", ""),
        "headers": {},
    }
    payload = _apply_parameters({
        "model": model,
        "store": False,
        "instructions": _system_instructions(),
        "input": _generation_input(prompt, language, context),
    }, parameters or {}, {"model", "store", "instructions", "input"})
    response = _json_request(
        f"{runtime['base_url']}/{runtime.get('endpoint', 'responses').lstrip('/')}",
        method="POST",
        payload=payload,
        headers=_provider_headers(runtime),
    )
    pieces: list[str] = []
    for item in response.get("output", []):
        if not isinstance(item, dict):
            continue
        for part in item.get("content", []):
            if isinstance(part, dict):
                text = part.get("text") or part.get("output_text")
                if isinstance(text, str):
                    pieces.append(text)
    return _parse_generation("\n".join(pieces), str(runtime["label"]))


def _chat_generation(
    prompt: str,
    language: str,
    context: Dict[str, Any],
    model: str,
    *,
    provider: dict[str, Any],
    parameters: dict[str, Any],
) -> dict[str, str]:
    payload = _apply_parameters({
        "model": model,
        "store": False,
        "messages": [
            {"role": "system", "content": _system_instructions()},
            {"role": "user", "content": _generation_input(prompt, language, context)},
        ],
    }, parameters, {"model", "store", "messages"})
    response = _json_request(
        f"{provider['base_url']}/{provider.get('endpoint', 'chat/completions').lstrip('/')}",
        method="POST",
        payload=payload,
        headers=_provider_headers(provider),
    )
    choices = response.get("choices", [])
    content = choices[0].get("message", {}).get("content", "") if choices and isinstance(choices[0], dict) else ""
    return _parse_generation(str(content), str(provider["label"]))


def _openrouter_generation(
    prompt: str,
    language: str,
    context: Dict[str, Any],
    model: str,
    *,
    provider: dict[str, Any] | None = None,
    parameters: dict[str, Any] | None = None,
) -> dict[str, str]:
    runtime = provider or {
        "label": "OpenRouter",
        "base_url": DEFAULT_OPENROUTER_URL,
        "api_key": os.environ.get("OPENROUTER_API_KEY", ""),
        "headers": {"HTTP-Referer": "https://github.com/tracepad/tracepad", "X-Title": "Tracepad"},
    }
    return _chat_generation(
        prompt,
        language,
        context,
        model,
        provider=runtime,
        parameters=parameters or {},
    )


def _ollama_generation(
    prompt: str,
    language: str,
    context: Dict[str, Any],
    model: str,
    base_url: str,
    *,
    parameters: dict[str, Any] | None = None,
) -> dict[str, str]:
    response = _json_request(
        f"{base_url}/api/chat",
        method="POST",
        payload={
            "model": model,
            "stream": False,
            "format": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": ["code"],
                "additionalProperties": False,
            },
            "messages": [
                {"role": "system", "content": _system_instructions()},
                {"role": "user", "content": _generation_input(prompt, language, context)},
            ],
            "options": parameters or {},
        },
    )
    content = response.get("message", {}).get("content", "") if isinstance(response.get("message"), dict) else ""
    return _parse_generation(str(content), "Ollama")


def _generate(prompt: str, language: str, context: Dict[str, Any]) -> dict[str, str]:
    registry = _resolved_registry()
    profile_id = registry["active_profile"]
    profile = registry["profiles"].get(profile_id)
    if not profile or not profile["configured"]:
        raise RuntimeError("Configure a Tracepad model profile before generating code.")
    provider = registry["providers"][profile["provider"]]
    model = str(profile["model"])
    parameters = dict(profile.get("parameters", {}))

    if provider["driver"] == "openai-responses":
        result = _openai_generation(
            prompt, language, context, model, provider=provider, parameters=parameters
        )
    elif provider["driver"] == "openai-chat":
        result = _chat_generation(
            prompt, language, context, model, provider=provider, parameters=parameters
        )
    else:
        result = _ollama_generation(
            prompt, language, context, model, provider["base_url"], parameters=parameters
        )
    return {**result, "provider": f"{profile['label']} ({model})"}


class ProvidersHandler(APIHandler):
    """Discover and configure AI providers without exposing stored credentials."""

    @authenticated
    async def get(self) -> None:
        try:
            self.finish(await asyncio.to_thread(_provider_status))
        except RuntimeError as error:
            self.set_status(500)
            self.finish({"ok": False, "error": str(error)})

    @authenticated
    async def post(self) -> None:
        body = self.get_json_body() or {}
        try:
            status = await asyncio.to_thread(_configure_provider, body)
            self.finish(status)
        except RuntimeError as error:
            self.set_status(400)
            self.finish({"ok": False, "error": str(error)})


class GenerateHandler(APIHandler):
    """Generate notebook code through the active server-side AI provider."""

    @authenticated
    async def post(self) -> None:
        body = self.get_json_body() or {}
        prompt = str(body.get("prompt", "")).strip()
        language = _clean_language(body.get("language"))
        context = body.get("context") if isinstance(body.get("context"), dict) else {}
        if not prompt:
            self.set_status(400)
            self.finish({"ok": False, "error": "A prompt is required."})
            return

        try:
            result = await asyncio.to_thread(_generate, prompt, language, context)
            self.finish({"ok": True, "language": language, **result})
        except RuntimeError as error:
            self.set_status(503)
            self.finish({"ok": False, "error": str(error)})


def _jupyter_server_extension_points():
    return [{"module": "tracepad.server"}]


def _load_jupyter_server_extension(serverapp) -> None:
    web_app = serverapp.web_app
    base_url = web_app.settings["base_url"]
    generate_route = url_path_join(base_url, "tracepad", "generate")
    providers_route = url_path_join(base_url, "tracepad", "providers")
    web_app.add_handlers(
        ".*$",
        [
            (generate_route, GenerateHandler),
            (providers_route, ProvidersHandler),
        ],
    )
    serverapp.log.info("Tracepad generation endpoint enabled at %s", generate_route)
