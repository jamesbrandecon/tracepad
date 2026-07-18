import pytest

from tracepad import server


@pytest.fixture(autouse=True)
def clear_provider_state(monkeypatch, tmp_path):
    server._SESSION_CONFIG.clear()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    for name in (
        "TRACEPAD_CONFIG",
        "TRACEPAD_PROFILE",
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


def test_generation_context_redacts_common_secrets():
    context = {
        "notebook_code": [
            {
                "cell_index": 1,
                "source": 'api_key = "sk-proj-abcdefghijklmnop"\norders = load_orders()',
            }
        ]
    }

    value = server._generation_input("Summarize orders", "python", context)

    assert "orders = load_orders()" in value
    assert "[REDACTED]" in value
    assert "sk-proj-abcdefghijklmnop" not in value
    assert server._redact_sensitive_text("api_key = sk-proj-abcdefghijklmnop") == (
        "api_key = [REDACTED]"
    )


def test_ollama_is_detected_but_requires_selection(monkeypatch):
    monkeypatch.setattr(server, "_ollama_models", lambda _url: (["qwen2.5-coder:7b", "llama3.2:3b"], None))
    status = server._provider_status()
    assert status["ready"] is False
    assert status["active_provider"] is None
    assert status["active_model"] is None
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
    with pytest.raises(RuntimeError, match="model profile"):
        server._generate("summarize the data", "python", {})


def test_generation_routes_to_selected_provider(monkeypatch):
    monkeypatch.setattr(
        server,
        "_resolved_registry",
        lambda: {
            "active_profile": "router-fast",
            "profiles": {
                "router-fast": {
                    "label": "Router fast",
                    "provider": "router",
                    "model": "vendor/model",
                    "parameters": {"temperature": 0.2},
                    "configured": True,
                }
            },
            "providers": {
                "router": {
                    "id": "router",
                    "label": "Router",
                    "driver": "openai-chat",
                    "base_url": "https://router.example/v1",
                }
            },
        },
    )
    captured = {}
    monkeypatch.setattr(
        server,
        "_chat_generation",
        lambda prompt, language, context, model, **kwargs: captured.update(
            prompt=prompt,
            language=language,
            context=context,
            model=model,
            **kwargs,
        ) or {"code": f"result = {prompt!r}", "notes": "Ready"},
    )
    result = server._generate("count rows", "python", {"references": []})
    assert result["provider"] == "Router fast (vendor/model)"
    assert result["code"] == "result = 'count rows'"
    assert captured["parameters"] == {"temperature": 0.2}


def test_yaml_profile_uses_environment_key_without_exposing_it(monkeypatch, tmp_path):
    (tmp_path / "tracepad.yaml").write_text(
        """
version: 1
default_profile: gateway-fast
providers:
  gateway:
    label: Team gateway
    driver: openai-chat
    base_url: https://models.example/v1
    api_key_env: TEAM_MODEL_KEY
profiles:
  gateway-fast:
    label: Gateway fast
    provider: gateway
    model: team/coder
    parameters:
      temperature: 0.2
      max_tokens: 900
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.setenv("TEAM_MODEL_KEY", "server-secret")

    status = server._provider_status()

    assert status["ready"] is True
    assert status["active_profile"] == "gateway-fast"
    assert status["active_provider"] == "gateway"
    assert status["active_model"] == "team/coder"
    assert "server-secret" not in repr(status)
    assert status["config_files"] == [str((tmp_path / "tracepad.yaml").resolve())]


def test_profile_environment_override_beats_yaml_default(monkeypatch, tmp_path):
    (tmp_path / "tracepad.yaml").write_text(
        """
version: 1
default_profile: openai
profiles:
  openai:
    provider: openai
    model: yaml-model
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("TRACEPAD_OPENAI_MODEL", "environment-model")

    status = server._provider_status()

    assert status["active_model"] == "environment-model"


def test_request_parameters_cannot_replace_model_or_messages():
    payload = {"model": "safe-model", "messages": ["safe"], "temperature": 0.1}
    result = server._apply_parameters(
        payload,
        {"model": "wrong", "messages": ["wrong"], "temperature": 0.6, "max_tokens": 400},
        {"model", "messages"},
    )
    assert result == {
        "model": "safe-model",
        "messages": ["safe"],
        "temperature": 0.6,
        "max_tokens": 400,
    }


def test_model_prompt_preserves_inspectable_final_object_contract():
    instructions = server._system_instructions()
    assert "final expression" in instructions
    assert "summary, coefficients, fitted values, predict" in instructions
    assert "code value must be one string" in instructions
    assert "environment variables or established credential providers" in instructions


def test_openai_generation_disables_storage(monkeypatch):
    captured = {}

    def fake_request(url, **kwargs):
        captured.update(kwargs["payload"])
        return {
            "output": [
                {"content": [{"text": '{"code":"answer = 42\\nanswer","notes":"Ready"}'}]}
            ]
        }

    monkeypatch.setattr(server, "_json_request", fake_request)
    result = server._openai_generation(
        "Answer",
        "python",
        {"notebook_code": []},
        "test-model",
        parameters={"store": True},
    )

    assert result["code"] == "answer = 42\nanswer"
    assert captured["store"] is False


def test_chat_generation_disables_storage(monkeypatch):
    captured = {}

    def fake_request(url, **kwargs):
        captured.update(kwargs["payload"])
        return {
            "choices": [
                {"message": {"content": '{"code":"answer = 42\\nanswer","notes":"Ready"}'}}
            ]
        }

    monkeypatch.setattr(server, "_json_request", fake_request)
    result = server._chat_generation(
        "Answer",
        "python",
        {"notebook_code": []},
        "test-model",
        provider={
            "label": "Test",
            "base_url": "https://models.example/v1",
            "headers": {},
        },
        parameters={"store": True},
    )

    assert result["code"] == "answer = 42\nanswer"
    assert captured["store"] is False


def test_ollama_generation_requests_a_string_code_schema(monkeypatch):
    captured = {}

    def fake_request(url, **kwargs):
        captured.update(kwargs["payload"])
        return {"message": {"content": '{"code":"[1, 2, 3]","notes":"Ready"}'}}

    monkeypatch.setattr(server, "_json_request", fake_request)
    result = server._ollama_generation(
        "Create a list",
        "python",
        {},
        "tiny-model",
        "http://127.0.0.1:11434",
    )

    assert result["code"] == "[1, 2, 3]"
    assert captured["format"]["properties"]["code"] == {"type": "string"}


def test_server_extension_point_is_discoverable():
    assert server._jupyter_server_extension_points() == [{"module": "tracepad.server"}]
