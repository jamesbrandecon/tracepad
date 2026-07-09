import { describe, expect, it } from "vitest";
import { defaultState, newTurn } from "./state";

describe("Tracepad notebook state", () => {
  it("starts with one editable turn in the active kernel language", () => {
    const state = defaultState("python");
    expect(state.version).toBe(1);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].language).toBe("python");
    expect(state.turns[0].status).toBe("draft");
  });

  it("records parent lineage for a child turn", () => {
    const turn = newTurn("r", "obj-parent");
    expect(turn.language).toBe("r");
    expect(turn.parentObjectId).toBe("obj-parent");
    expect(turn.outputs).toEqual([]);
  });
});
