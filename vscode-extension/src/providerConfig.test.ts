import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConfigurationRoot, loadProviderRegistry, profileReady } from "./providerConfig";

function fixture(): { root: string; user: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "tracepad-vscode-"));
  const user = join(root, "user");
  const workspace = join(root, "workspace");
  mkdirSync(join(user, "tracepad"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  return { root, user, workspace };
}

describe("Tracepad VS Code provider configuration", () => {
  it("requires users to supply a model name", () => {
    const paths = fixture();
    const registry = loadProviderRegistry({
      workspaceRoot: paths.workspace,
      userConfigRoot: paths.user,
      environment: {}
    });
    expect(registry.activeProfile).toBe("");
    expect(registry.profiles.openai.model).toBe("");
    expect(registry.profiles.openrouter.model).toBe("");
  });

  it("layers user, workspace, and explicit YAML in that order", () => {
    const paths = fixture();
    writeFileSync(join(paths.user, "tracepad", "config.yaml"), `
profiles:
  openai:
    model: user-model
`);
    writeFileSync(join(paths.workspace, "tracepad.yaml"), `
profiles:
  openai:
    model: workspace-model
`);
    writeFileSync(join(paths.workspace, "extra.yaml"), `
default_profile: openai
profiles:
  openai:
    model: explicit-model
`);

    const registry = loadProviderRegistry({
      workspaceRoot: paths.workspace,
      userConfigRoot: paths.user,
      explicitPath: "extra.yaml",
      environment: { OPENAI_API_KEY: "test-key" }
    });

    expect(registry.profiles.openai.model).toBe("explicit-model");
    expect(registry.activeProfile).toBe("openai");
    expect(registry.loadedFiles).toHaveLength(3);
    expect(profileReady(registry.profiles.openai, registry.providers, registry.environment)).toBe(true);
  });

  it("lets environment variables select a profile and model without storing a key", () => {
    const paths = fixture();
    const registry = loadProviderRegistry({
      workspaceRoot: paths.workspace,
      userConfigRoot: paths.user,
      environment: {
        TRACEPAD_PROFILE: "ollama",
        TRACEPAD_OLLAMA_MODEL: "qwen2.5-coder:7b"
      }
    });
    expect(registry.activeProfile).toBe("ollama");
    expect(registry.profiles.ollama.model).toBe("qwen2.5-coder:7b");
    expect(registry.providers.ollama.requiresApiKey).toBe(false);
  });

  it("allows Ollama to discover an installed model at generation time", () => {
    const paths = fixture();
    const registry = loadProviderRegistry({
      workspaceRoot: paths.workspace,
      userConfigRoot: paths.user,
      profileOverride: "ollama",
      environment: {}
    });
    expect(registry.profiles.ollama.model).toBe("");
    expect(profileReady(registry.profiles.ollama, registry.providers, registry.environment)).toBe(true);
  });

  it("loads Windows user profiles from APPDATA", () => {
    const paths = fixture();
    const appData = join(paths.root, "AppData", "Roaming");
    mkdirSync(join(appData, "tracepad"), { recursive: true });
    writeFileSync(join(appData, "tracepad", "config.yaml"), `
version: 1
default_profile: windows-model
profiles:
  windows-model:
    provider: openai
    model: configured-on-windows
`);
    const registry = loadProviderRegistry({
      workspaceRoot: paths.workspace,
      environment: { APPDATA: appData },
      platform: "win32"
    });
    expect(registry.activeProfile).toBe("windows-model");
    expect(registry.loadedFiles).toContain(join(appData, "tracepad", "config.yaml"));
  });

  it("rejects unsupported provider drivers", () => {
    const paths = fixture();
    writeFileSync(join(paths.workspace, "tracepad.yaml"), `
providers:
  broken:
    driver: shell
    base_url: http://localhost
profiles:
  broken:
    provider: broken
    model: test
default_profile: broken
`);
    expect(() => loadProviderRegistry({
      workspaceRoot: paths.workspace,
      userConfigRoot: paths.user,
      environment: {}
    })).toThrow("unsupported driver");
  });

  it("discovers project configuration above an out-of-workspace notebook", () => {
    const paths = fixture();
    const notebookDirectory = join(paths.workspace, "vscode-extension", "demo");
    mkdirSync(notebookDirectory, { recursive: true });
    writeFileSync(join(paths.workspace, "pyproject.toml"), "[project]\nname = \"fixture\"\n");
    expect(discoverConfigurationRoot(notebookDirectory)).toBe(paths.workspace);
  });
});
