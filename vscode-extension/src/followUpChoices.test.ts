import { describe, expect, it } from "vitest";
import { followUpChoices } from "./followUpChoices";

describe("Tracepad result follow-ups", () => {
  it("offers table diagnostics and visualization as child requests", () => {
    const choices = followUpChoices("orders", "data");
    expect(choices.map(choice => choice.label)).toEqual([
      "$(comment-discussion) Ask a follow-up",
      "$(preview) Summarize and diagnose",
      "$(graph) Visualize"
    ]);
    expect(choices.slice(1).every(choice => choice.prompt.includes("@orders"))).toBe(true);
  });

  it("adapts choices to model and plot outputs", () => {
    expect(followUpChoices("fit", "model").map(choice => choice.label)).toContain("$(symbol-value) Generate predictions");
    expect(followUpChoices("chart", "plot").map(choice => choice.label)).toContain("$(edit) Revise visualization");
  });
});
