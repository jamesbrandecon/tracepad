import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capturesRuntimeResult,
  bindGeneratedResult,
  discoverOllamaModels,
  generateCode,
  prependReferenceBindings,
  redactSensitiveText,
  systemInstructions
} from "./providerClient";

afterEach(() => vi.unstubAllGlobals());

describe("Tracepad generation contract", () => {
  it("accepts variable and temporary-view result bindings", () => {
    expect(capturesRuntimeResult(
      "tracepad_result_2 = frame.describe()\ntracepad_result_2",
      "tracepad_result_2"
    )).toBe(true);
    expect(capturesRuntimeResult(
      "CREATE TEMP VIEW tracepad_result_2 AS SELECT * FROM orders;",
      "tracepad_result_2"
    )).toBe(true);
  });

  it("rejects code that cannot support a later @ reference", () => {
    expect(capturesRuntimeResult("orders.describe()", "tracepad_result_2")).toBe(false);
  });

  it("adds a no-copy result binding for a model-selected variable", () => {
    const code = bindGeneratedResult(
      "my_list = [1, 2, 3]",
      "python",
      "tracepad_result_1"
    );
    expect(code).toContain("tracepad_result_1 = my_list");
    expect(code.endsWith("tracepad_result_1")).toBe(true);
  });

  it("does not guess a SQL result binding", () => {
    expect(bindGeneratedResult("SELECT * FROM orders", "sql", "tracepad_result_1"))
      .toBe("SELECT * FROM orders");
  });

  it("requires the reusable object instead of an ad hoc preview dictionary", () => {
    const instructions = systemInstructions("python", "tracepad_result_1");
    expect(instructions).toContain("actual reusable result object");
    expect(instructions).toContain("full data frame or lazy table");
    expect(instructions).toContain("not a dictionary or list containing previews");
    expect(instructions).toContain("environment variables or established credential providers");
  });

  it("redacts common secrets without removing ordinary notebook code", () => {
    const source = 'api_key = "sk-proj-abcdefghijklmnop"\norders = load_orders()';
    expect(redactSensitiveText(source)).toBe(
      'api_key = "[REDACTED]"\norders = load_orders()'
    );
    expect(redactSensitiveText("api_key = sk-proj-abcdefghijklmnop"))
      .toBe("api_key = [REDACTED]");
  });

  it("binds friendly reference names without copying their objects", () => {
    const code = prependReferenceBindings(
      "tracepad_result_2 = tracepad_result_1.describe()\ntracepad_result_2",
      "python",
      [{ token: "@orders", alias: "orders", runtimeName: "tracepad_result_1", turnNumber: "1" }]
    );
    expect(code).toContain("orders = tracepad_result_1  # @orders");
    expect(code).toContain("no data is copied");
  });

  it("does not duplicate friendly reference bindings during repair", () => {
    const reference = { token: "@orders", alias: "orders", runtimeName: "tracepad_result_1", turnNumber: "1" };
    const first = prependReferenceBindings("tracepad_result_2 = orders.head()", "python", [reference]);
    const second = prependReferenceBindings(first, "python", [reference]);
    expect(second.match(/Tracepad references/g)).toHaveLength(1);
  });

  it("discovers all unique Ollama models for native setup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: "qwen2.5-coder:0.5b" }, { name: "phi4-mini:latest" }, { name: "qwen2.5-coder:0.5b" }]
    }), { status: 200 })));
    const models = await discoverOllamaModels({
      id: "ollama",
      label: "Ollama",
      driver: "ollama-chat",
      baseUrl: "http://127.0.0.1:11434",
      apiKeyEnv: "",
      requiresApiKey: false,
      headers: {}
    });
    expect(models).toEqual(["qwen2.5-coder:0.5b", "phi4-mini:latest"]);
  });

  it("requests a string-valued JSON schema from Ollama", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: {
        content: JSON.stringify({
          code: "tracepad_result_1 = [1, 2, 3]\ntracepad_result_1",
          notes: "Ready"
        })
      }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await generateCode({
      activeProfile: "ollama",
      loadedFiles: [],
      environment: {},
      providers: {
        ollama: {
          id: "ollama",
          label: "Ollama",
          driver: "ollama-chat",
          baseUrl: "http://127.0.0.1:11434",
          apiKeyEnv: "",
          requiresApiKey: false,
          headers: {}
        }
      },
      profiles: {
        ollama: {
          id: "ollama",
          label: "Ollama local",
          provider: "ollama",
          model: "qwen2.5-coder:0.5b",
          parameters: {}
        }
      }
    }, "Create a list.", "python", "tracepad_result_1", {
      references: [],
      notebookCode: []
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(body.format.properties.code.type).toBe("string");
    expect(body.format.required).toContain("code");
  });

  it("sends code-only notebook context with stateless hosted requests", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ text: JSON.stringify({
        code: "tracepad_result_2 = orders.describe()\ntracepad_result_2",
        notes: "Ready"
      }) }] }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await generateCode({
      activeProfile: "openai",
      loadedFiles: [],
      environment: { OPENAI_API_KEY: "transport-secret" },
      providers: {
        openai: {
          id: "openai",
          label: "OpenAI",
          driver: "openai-responses",
          baseUrl: "https://api.openai.test/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          requiresApiKey: true,
          headers: {}
        }
      },
      profiles: {
        openai: {
          id: "openai",
          label: "OpenAI",
          provider: "openai",
          model: "test-model",
          parameters: { store: true }
        }
      }
    }, "Summarize @orders.", "python", "tracepad_result_2", {
      references: [{
        token: "@orders",
        alias: "orders",
        runtimeName: "tracepad_result_1",
        turnNumber: "1",
        source: 'api_key = "sk-proj-abcdefghijklmnop"\norders = load_orders()'
      }],
      notebookCode: [{
        cellNumber: 1,
        language: "python",
        source: 'api_key = "sk-proj-abcdefghijklmnop"\norders = load_orders()',
        executionOrder: 1
      }]
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(body.store).toBe(false);
    expect(body.input).toContain("Notebook code (source only; cell outputs are excluded)");
    expect(body.input).toContain("orders = load_orders()");
    expect(body.input).toContain("[REDACTED]");
    expect(body.input).not.toContain("sk-proj-abcdefghijklmnop");
    expect(body.input).not.toContain("transport-secret");
  });
});
