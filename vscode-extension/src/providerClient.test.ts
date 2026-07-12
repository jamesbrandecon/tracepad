import { describe, expect, it } from "vitest";
import { capturesRuntimeResult, systemInstructions } from "./providerClient";

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
});
