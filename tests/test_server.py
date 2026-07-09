import pytest

from tracepad import server


@pytest.fixture(autouse=True)
def clear_provider_state(monkeypatch):
    server._SESSION_CONFIG.clear()
    for name in (
        "TRACEPAD_PROVIDER",
        "TRACEPAD_OLLAMA_MODEL",
        "TRACEPAD_OPENAI_MODEL",
        "TRACEPAD_OPENROUTER_MODEL",
        "OLLAMA_HOST",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(server, "_ollama_models", lambda _url: ([], "Ollama is not running."))


def test_language_normalization_defaults_to_python():
    assert server._clean_language("R") == "r"
    assert server._clean_language("not-a-kernel") == "python"


def test_ollama_host_accepts_host_and_port_without_scheme():
    assert server._clean_base_url("127.0.0.1:11434", server.DEFAULT_OLLAMA_URL) == "http://127.0.0.1:11434"


def test_generation_parser_accepts_json_without_markdown():
    result = server._parse_generation('{"code":"answer = 42\\nanswer","notes":"Ready"}', "Test")
    assert result == {"code": "answer = 42\nanswer", "notes": "Ready"}


def test_generation_parser_rejects_empty_code():
    with pytest.raises(RuntimeError, match="empty code"):
        server._parse_generation('{"code":""}', "Test")


def test_ollama_is_auto_selected_when_reachable(monkeypatch):
    monkeypatch.setattr(server, "_ollama_models", lambda _url: (["qwen2.5-coder:7b", "llama3.2:3b"], None))
    status = server._provider_status()
    assert status["ready"] is True
    assert status["active_provider"] == "ollama"
    assert status["active_model"] == "qwen2.5-coder:7b"
    assert status["providers"][0]["models"] == ["qwen2.5-coder:7b", "llama3.2:3b"]


def test_openai_session_configuration_never_returns_key():
    status = server._configure_provider(
        {"provider": "openai", "model": "gpt-test", "api_key": "secret-key"}
    )
    assert status["ready"] is True
    assert status["active_provider"] == "openai"
    assert status["active_model"] == "gpt-test"
    assert "secret-key" not in repr(status)


def test_openrouter_requires_a_model_name():
    with pytest.raises(RuntimeError, match="model name"):
        server._configure_provider({"provider": "openrouter", "api_key": "secret-key"})


def test_generation_fails_closed_without_provider():
    with pytest.raises(RuntimeError, match="Configure Ollama"):
        server._generate("summarize the data", "python", {})


def test_generation_routes_to_selected_provider(monkeypatch):
    monkeypatch.setattr(
        server,
        "_provider_status",
        lambda: {
            "ready": True,
            "active_provider": "openrouter",
            "active_model": "vendor/model",
            "providers": [
                {"id": "openrouter", "base_url": server.DEFAULT_OPENROUTER_URL}
            ],
        },
    )
    monkeypatch.setattr(
        server,
        "_openrouter_generation",
        lambda prompt, language, context, model: {
            "code": f"result = {prompt!r}",
            "notes": f"{language}:{model}:{len(context)}",
        },
    )
    result = server._generate("count rows", "python", {"references": []})
    assert result["provider"] == "openrouter (vendor/model)"
    assert result["code"] == "result = 'count rows'"


def test_model_prompt_preserves_inspectable_final_object_contract():
    instructions = server._system_instructions()
    assert "final expression" in instructions
    assert "summary, coefficients, fitted values, predict" in instructions


def test_server_extension_point_is_discoverable():
    assert server._jupyter_server_extension_points() == [{"module": "tracepad.server"}]
