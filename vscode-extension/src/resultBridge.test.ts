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
    runtimeName: "tracepad_result_1"
  };

  it("adds a custom MIME presentation to Python cells", () => {
    const source = appendResultBridge("tracepad_result_1 = value", "python", options);
    expect(source).toContain(TRACEPAD_RESULT_MARKER);
    expect(source).toContain("from tracepad import present");
    expect(source).toContain('orders = tracepad_result_1  # Tracepad result: @orders points to this same object');
    expect(source).toContain('present(orders, name="orders")');
    expect(source).not.toContain("turn_id=");
    expect(source).not.toContain("turn=");
  });

  it("leaves other kernel languages unchanged", () => {
    expect(appendResultBridge("result <- data", "r", options)).toBe("result <- data");
  });

  it("replaces an existing bridge instead of duplicating it", () => {
    const first = appendResultBridge("tracepad_result_1 = value", "python", options);
    const second = appendResultBridge(first, "python", { ...options, alias: "renamed" });
    expect(second.match(new RegExp(TRACEPAD_RESULT_MARKER, "g"))).toHaveLength(1);
    expect(stripResultBridge(second)).toBe("tracepad_result_1 = value");
    expect(second).toContain("renamed = tracepad_result_1");
    expect(second).toContain('name="renamed"');
  });
});
