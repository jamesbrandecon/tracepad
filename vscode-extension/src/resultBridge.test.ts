import { describe, expect, it } from "vitest";
import {
  appendResultBridge,
  stripResultBridge,
  TRACEPAD_RESULT_MARKER,
  TRACEPAD_RESULT_MIME
} from "./resultBridge";

describe("Tracepad result presentation bridge", () => {
  const options = {
    alias: "orders",
    runtimeName: "tracepad_result_1",
    turnId: "turn-1",
    turnNumber: "1"
  };

  it("adds a custom MIME presentation to Python cells", () => {
    const source = appendResultBridge("tracepad_result_1 = value", "python", options);
    expect(source).toContain(TRACEPAD_RESULT_MARKER);
    expect(source).toContain("from tracepad.runtime import present");
    expect(source).toContain('alias="orders"');
    expect(source).toContain("_tracepad_present(tracepad_result_1");
  });

  it("leaves other kernel languages unchanged", () => {
    expect(appendResultBridge("result <- data", "r", options)).toBe("result <- data");
  });

  it("replaces an existing bridge instead of duplicating it", () => {
    const first = appendResultBridge("tracepad_result_1 = value", "python", options);
    const second = appendResultBridge(first, "python", { ...options, alias: "renamed" });
    expect(second.match(new RegExp(TRACEPAD_RESULT_MARKER, "g"))).toHaveLength(1);
    expect(stripResultBridge(second)).toBe("tracepad_result_1 = value");
    expect(second).toContain('alias="renamed"');
  });
});
