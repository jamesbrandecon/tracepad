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


PROVIDERS = {"ollama", "openai", "openrouter"}
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OPENAI_URL = "https://api.openai.com/v1"
DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1"

# Keys entered in Tracepad are intentionally process-local. They are never
# returned to the browser, written to notebooks, or persisted to disk.
_SESSION_CONFIG: dict[str, str] = {}


def _clean_language(value: object) -> str:
    language = str(value or "python").lower()
    return language if language in {"python", "r", "julia", "sql"} else "python"


def _configured(name: str, environment_name: str, default: str = "") -> str:
    return _SESSION_CONFIG.get(name, os.environ.get(environment_name, default)).strip()


def _clean_base_url(value: object, default: str) -> str:
    url = str(value or default).strip().rstrip("/")
    if "://" not in url:
        url = f"http://{url}"
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("Provider URL must be an http or https URL.")
    return url


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


def _provider_status() -> dict[str, Any]:
    ollama_url = _clean_base_url(
        _configured("ollama_url", "OLLAMA_HOST", DEFAULT_OLLAMA_URL),
        DEFAULT_OLLAMA_URL,
    )
    ollama_models, ollama_error = _ollama_models(ollama_url)
    ollama_model = _configured("ollama_model", "TRACEPAD_OLLAMA_MODEL")
    if not ollama_model and ollama_models:
        ollama_model = ollama_models[0]

    openai_key = _configured("openai_key", "OPENAI_API_KEY")
    openai_model = _configured("openai_model", "TRACEPAD_OPENAI_MODEL", "gpt-5.4-mini")
    openrouter_key = _configured("openrouter_key", "OPENROUTER_API_KEY")
    openrouter_model = _configured("openrouter_model", "TRACEPAD_OPENROUTER_MODEL")

    providers = [
        {
            "id": "ollama",
            "label": "Ollama",
            "configured": bool(ollama_model and not ollama_error),
            "available": ollama_error is None,
            "model": ollama_model,
            "models": ollama_models,
            "base_url": ollama_url,
            "error": ollama_error,
        },
        {
            "id": "openai",
            "label": "OpenAI",
            "configured": bool(openai_key and openai_model),
            "available": bool(openai_key),
            "model": openai_model,
            "models": [],
            "base_url": DEFAULT_OPENAI_URL,
            "error": None if openai_key else "API key not configured.",
        },
        {
            "id": "openrouter",
            "label": "OpenRouter",
            "configured": bool(openrouter_key and openrouter_model),
            "available": bool(openrouter_key),
            "model": openrouter_model,
            "models": [],
            "base_url": DEFAULT_OPENROUTER_URL,
            "error": None if openrouter_key else "API key not configured.",
        },
    ]

    requested = _configured("provider", "TRACEPAD_PROVIDER").lower()
    by_id = {provider["id"]: provider for provider in providers}
    if requested in PROVIDERS:
        active = requested
    else:
        active = next((provider["id"] for provider in providers if provider["configured"]), "")
    active_entry = by_id.get(active)
    ready = bool(active_entry and active_entry["configured"])
    return {
        "ok": True,
        "ready": ready,
        "active_provider": active or None,
        "active_model": active_entry["model"] if ready and active_entry else None,
        "providers": providers,
    }


def _configure_provider(body: dict[str, Any]) -> dict[str, Any]:
    provider = str(body.get("provider", "")).strip().lower()
    if provider not in PROVIDERS:
        raise RuntimeError("Choose Ollama, OpenAI, or OpenRouter.")

    model = str(body.get("model", "")).strip()
    if model:
        _SESSION_CONFIG[f"{provider}_model"] = model
    if provider == "ollama" and "base_url" in body:
        _SESSION_CONFIG["ollama_url"] = _clean_base_url(body.get("base_url"), DEFAULT_OLLAMA_URL)
    api_key = str(body.get("api_key", "")).strip()
    if api_key and provider in {"openai", "openrouter"}:
        _SESSION_CONFIG[f"{provider}_key"] = api_key
    _SESSION_CONFIG["provider"] = provider

    status = _provider_status()
    if not status["ready"]:
        selected = next(item for item in status["providers"] if item["id"] == provider)
        message = selected.get("error") or "A model name is required."
        raise RuntimeError(str(message))
    return status


def _system_instructions() -> str:
    return (
        "You generate concise, executable notebook code. Return JSON only with keys "
        "code and notes. Use the supplied kernel language and do not include markdown "
        "fences or credentials. Use existing notebook variables and Tracepad references "
        "when supplied. Make the final expression the table, plot, or model the user is "
        "most likely to inspect. For model objects, preserve the fitted object as the final "
        "expression so Tracepad can discover summary, coefficients, fitted values, predict, "
        "and plot capabilities."
    )


def _generation_input(prompt: str, language: str, context: Dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Kernel language: {language}",
            f"User request: {prompt}",
            f"Notebook context: {json.dumps(context, ensure_ascii=True)}",
        ]
    )


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


def _openai_generation(prompt: str, language: str, context: Dict[str, Any], model: str) -> dict[str, str]:
    api_key = _configured("openai_key", "OPENAI_API_KEY")
    payload = _json_request(
        f"{DEFAULT_OPENAI_URL}/responses",
        method="POST",
        payload={
            "model": model,
            "instructions": _system_instructions(),
            "input": _generation_input(prompt, language, context),
            "max_output_tokens": 1800,
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    pieces: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for part in item.get("content", []):
            if isinstance(part, dict):
                text = part.get("text") or part.get("output_text")
                if isinstance(text, str):
                    pieces.append(text)
    return _parse_generation("\n".join(pieces), "OpenAI")


def _openrouter_generation(prompt: str, language: str, context: Dict[str, Any], model: str) -> dict[str, str]:
    api_key = _configured("openrouter_key", "OPENROUTER_API_KEY")
    payload = _json_request(
        f"{DEFAULT_OPENROUTER_URL}/chat/completions",
        method="POST",
        payload={
            "model": model,
            "messages": [
                {"role": "system", "content": _system_instructions()},
                {"role": "user", "content": _generation_input(prompt, language, context)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
            "max_tokens": 1800,
        },
        headers={
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://github.com/tracepad/tracepad",
            "X-Title": "Tracepad",
        },
    )
    choices = payload.get("choices", [])
    content = choices[0].get("message", {}).get("content", "") if choices and isinstance(choices[0], dict) else ""
    return _parse_generation(str(content), "OpenRouter")


def _ollama_generation(prompt: str, language: str, context: Dict[str, Any], model: str, base_url: str) -> dict[str, str]:
    payload = _json_request(
        f"{base_url}/api/chat",
        method="POST",
        payload={
            "model": model,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": _system_instructions()},
                {"role": "user", "content": _generation_input(prompt, language, context)},
            ],
            "options": {"temperature": 0.1},
        },
    )
    content = payload.get("message", {}).get("content", "") if isinstance(payload.get("message"), dict) else ""
    return _parse_generation(str(content), "Ollama")


def _generate(prompt: str, language: str, context: Dict[str, Any]) -> dict[str, str]:
    status = _provider_status()
    if not status["ready"]:
        raise RuntimeError("Configure Ollama, OpenAI, or OpenRouter before generating code.")
    provider = str(status["active_provider"])
    model = str(status["active_model"])
    selected = next(item for item in status["providers"] if item["id"] == provider)

    if provider == "openai":
        result = _openai_generation(prompt, language, context, model)
    elif provider == "openrouter":
        result = _openrouter_generation(prompt, language, context, model)
    else:
        result = _ollama_generation(prompt, language, context, model, str(selected["base_url"]))
    return {**result, "provider": f"{provider} ({model})"}


class ProvidersHandler(APIHandler):
    """Discover and configure AI providers without exposing stored credentials."""

    @authenticated
    async def get(self) -> None:
        self.finish(await asyncio.to_thread(_provider_status))

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
