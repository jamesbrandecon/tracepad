import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface NotebookCell {
  cell_type: "markdown" | "code";
  execution_count?: number | null;
  metadata: {
    tracepad?: {
      alias?: string;
      role?: "prompt" | "code";
      runtimeName?: string;
      turnId?: string;
      turnNumber?: string;
    };
  };
  outputs?: unknown[];
  source: string[];
}

describe("VS Code demo notebook", () => {
  it("contains prompt-only turns with planned result names", () => {
    const filename = resolve(__dirname, "../demo/tracepad-vscode-demo.ipynb");
    const notebook = JSON.parse(readFileSync(filename, "utf8")) as { cells: NotebookCell[] };
    const prompts = notebook.cells.filter(cell => cell.metadata.tracepad?.role === "prompt");
    const codes = notebook.cells.filter(cell => cell.metadata.tracepad?.role === "code");
    expect(prompts).toHaveLength(3);
    expect(codes).toHaveLength(0);
    expect(prompts.map(cell => cell.metadata.tracepad?.alias)).toEqual([
      "orders",
      "monthly_revenue",
      "revenue_chart"
    ]);

    for (const prompt of prompts) {
      expect(prompt.cell_type).toBe("markdown");
      expect(prompt.metadata.tracepad?.role).toBe("prompt");
      expect(prompt.source.join("")).toMatch(/^%%ai\n/);
      expect(prompt.outputs).toBeUndefined();
    }
  });

  it("declares native prompt keyboard semantics without replacing ordinary notebook cells", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
      version: string;
      contributes: {
        configuration: {
          properties: Record<string, { default?: unknown }>;
        };
        keybindings: Array<{ command: string; key: string; when: string }>;
        commands: Array<{ command: string }>;
      };
    };
    const keybindings = new Map(manifest.contributes.keybindings.map(item => [item.command, item]));
    expect(manifest.version).toBe("0.3.10");
    expect((manifest as { icon?: string }).icon).toBe("media/tracepad-logo.png");
    expect(manifest.contributes.configuration.properties["tracepad.collapseGeneratedCode"]?.default).toBe(true);
    expect(manifest.contributes.configuration.properties["tracepad.models"]?.default).toEqual({});
    expect(keybindings.get("tracepad.generate")).toMatchObject({ key: "alt+t g" });
    expect(keybindings.get("tracepad.generateAndRun")).toMatchObject({ key: "alt+t r" });
    expect(keybindings.get("tracepad.generateRunAndInsert")).toMatchObject({ key: "alt+t n" });
    expect(keybindings.get("tracepad.exploreResult")).toMatchObject({ key: "alt+t e" });
    expect(keybindings.get("tracepad.showLineage")).toMatchObject({ key: "alt+t l" });
    expect(keybindings.get("tracepad.insertReference")).toMatchObject({ key: "alt+t i" });
    expect(keybindings.get("tracepad.setupModel")).toMatchObject({ key: "alt+t m" });
    expect(keybindings.get("tracepad.renameResult")).toMatchObject({ key: "alt+t a" });
    expect(keybindings.get("tracepad.addTurn")).toMatchObject({ key: "alt+t p" });
    for (const binding of manifest.contributes.keybindings) {
      expect(binding.key.startsWith("alt+t ")).toBe(true);
      expect(binding.when).toContain("notebookType == jupyter-notebook");
    }
    expect(manifest.contributes.commands.map(item => item.command)).toContain("tracepad.fixWithAI");
    expect(manifest.contributes.commands.map(item => item.command)).toContain("tracepad.showLineage");
    expect(manifest.contributes.commands.map(item => item.command)).toContain("tracepad.setupModel");
    const toolbar = (manifest.contributes as unknown as {
      menus: { "notebook/toolbar": Array<{ command: string; when: string }> };
    }).menus["notebook/toolbar"];
    expect(toolbar).toContainEqual(expect.objectContaining({
      command: "tracepad.generate",
      when: expect.stringContaining("tracepad.activePrompt")
    }));
  });
});
