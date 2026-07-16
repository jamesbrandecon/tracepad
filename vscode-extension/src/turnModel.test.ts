import { describe, expect, it } from "vitest";
import {
  childInsertionIndex,
  classifyResult,
  cleanAlias,
  collectReferences,
  contentHash,
  extractPromptText,
  formatPromptMarkdown,
  generatedSourceWasEdited,
  isPromptMarkerSource,
  newPromptSource,
  nextTurnNumber,
  referencedTokens,
  runtimeNameFor,
  selectGenerationReferences,
  tracepadMetadata,
  withTracepadMetadata,
  type MetadataCellLike,
  type TracepadCellMetadata
} from "./turnModel";

function cell(metadata: TracepadCellMetadata): MetadataCellLike {
  return { metadata: withTracepadMetadata({}, metadata) };
}

function prompt(turnNumber: string, turnId = `turn-${turnNumber}`): MetadataCellLike {
  return cell({ version: 1, role: "prompt", turnId, turnNumber });
}

function code(
  turnNumber: string,
  alias: string,
  turnId = `turn-${turnNumber}`,
  aliases: string[] = []
): MetadataCellLike {
  return cell({
    version: 1,
    role: "code",
    turnId,
    turnNumber,
    alias,
    aliases,
    runtimeName: runtimeNameFor(turnNumber)
  });
}

describe("Tracepad turn model", () => {
  it("numbers roots and direct children independently", () => {
    const cells = [prompt("1"), code("1", "orders"), prompt("1.1"), code("1.1", "monthly")];
    expect(nextTurnNumber(cells)).toBe("2");
    expect(nextTurnNumber(cells, {
      version: 1,
      role: "code",
      turnId: "turn-1",
      turnNumber: "1",
      alias: "orders"
    })).toBe("1.2");
  });

  it("reads portable metadata through both VS Code Jupyter serializer shapes", () => {
    const value: TracepadCellMetadata = {
      version: 1,
      role: "code",
      turnId: "turn-1",
      turnNumber: "1",
      alias: "orders",
      runtimeName: "tracepad_result_1"
    };
    expect(tracepadMetadata({ custom: { metadata: { tracepad: value } } })).toEqual(value);
    expect(tracepadMetadata({ metadata: { tracepad: value } })).toEqual(value);
  });

  it("places a new child after the parent's existing descendant block", () => {
    const cells = [
      prompt("1"), code("1", "orders"),
      prompt("1.1"), code("1.1", "summary"),
      prompt("1.1.1"), code("1.1.1", "chart"),
      prompt("2"), code("2", "model")
    ];
    const parent = {
      version: 1 as const,
      role: "code" as const,
      turnId: "turn-1",
      turnNumber: "1",
      alias: "orders"
    };
    expect(childInsertionIndex(cells, parent, 1)).toBe(6);
  });

  it("keeps former names as valid references after a rename", () => {
    const references = collectReferences([code("1", "orders", "turn-1", ["result_1"])]);
    expect(references.map(reference => reference.alias)).toEqual(["orders", "result_1"]);
    expect(new Set(references.map(reference => reference.runtimeName))).toEqual(new Set(["tracepad_result_1"]));
  });

  it("passes named references and parent context instead of every object", () => {
    const cells = [code("1", "orders"), code("2", "customers"), code("3", "model")];
    expect(selectGenerationReferences(cells, "Plot @orders", undefined).map(item => item.alias)).toEqual(["orders"]);
    expect(selectGenerationReferences(cells, "Plot @1", undefined).map(item => item.alias)).toEqual(["orders"]);
    expect(selectGenerationReferences(cells, "Inspect this", "model").map(item => item.alias)).toEqual(["model"]);
    expect(selectGenerationReferences(cells, "Start a separate analysis", undefined)).toEqual([]);
  });

  it("normalizes display aliases without changing runtime naming", () => {
    expect(cleanAlias(" 2026 revenue / region ")).toBe("revenue_region");
    expect(runtimeNameFor("4.2")).toBe("tracepad_result_4_2");
  });

  it("adopts %%ai markdown without preserving extension syntax in the notebook", () => {
    expect(newPromptSource()).toBe("%%ai\n");
    expect(isPromptMarkerSource("%%ai\nSummarize orders.")).toBe(true);
    expect(isPromptMarkerSource("Summarize orders.")).toBe(false);
    expect(extractPromptText("%%ai\nSummarize orders.")).toBe("Summarize orders.");
    const root = formatPromptMarkdown("Summarize orders.", "2");
    const child = formatPromptMarkdown("Plot monthly revenue.", "2.1", "orders");
    expect(root).toBe("Summarize orders.");
    expect(child).toBe("Plot monthly revenue.");
    expect(extractPromptText(root)).toBe("Summarize orders.");
    expect(extractPromptText(child)).toBe("Plot monthly revenue.");
  });

  it("tracks prompt references and detects edits to generated source", () => {
    const hash = contentHash("result = frame.describe()\nresult");
    expect(contentHash("result = frame.describe()\r\nresult")).toBe(hash);
    expect(generatedSourceWasEdited("result = frame.describe()\nresult", hash)).toBe(false);
    expect(generatedSourceWasEdited("result = frame.head()\nresult", hash)).toBe(true);
    expect(referencedTokens("Compare @orders with @2 and @orders")).toEqual(["orders", "2"]);
  });

  it("selects result-specific follow-up tools", () => {
    expect(classifyResult("frame.groupby('region').sum()", ["text/plain"])).toBe("data");
    expect(classifyResult("model = smf.logit(formula, data).fit()", ["text/plain"])).toBe("model");
    expect(classifyResult("fig, ax = plt.subplots()", ["image/png"])).toBe("plot");
  });
});
