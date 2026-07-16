import { describe, expect, it } from "vitest";
import { capturesRuntimeResult, prependReferenceBindings, systemInstructions } from "./providerClient";

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

  it("requires the reusable object instead of an ad hoc preview dictionary", () => {
    const instructions = systemInstructions("python", "tracepad_result_1");
    expect(instructions).toContain("actual reusable result object");
    expect(instructions).toContain("full data frame or lazy table");
    expect(instructions).toContain("not a dictionary or list containing previews");
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
});
