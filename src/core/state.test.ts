import { describe, expect, it } from "vitest";
import { defaultState, newTurn, restoreState, stateForPersistence } from "./state";

describe("Tracepad core state", () => {
  it("starts with one editable turn in the requested language", () => {
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
    expect(turn.inputObjectIds).toEqual(["obj-parent"]);
  });

  it("restores interrupted turns as stale and runtime objects as offline", () => {
    const state = defaultState("python");
    state.turns[0].status = "running";
    state.turns[0].outputs = [{ kind: "stream", text: "legacy duplicate" }];
    state.objects["obj-1"] = {
      id: "obj-1",
      handle: "__tracepad_obj_1",
      turnId: state.turns[0].id,
      alias: "orders",
      displayName: "orders",
      language: "python",
      classNames: ["pandas.DataFrame"],
      kind: "dataframe",
      capabilities: ["preview"],
      live: true,
      createdAt: new Date().toISOString()
    };

    const restored = restoreState(state, "python");
    expect(restored.turns[0].status).toBe("stale");
    expect(restored.turns[0].outputs).toEqual([]);
    expect(restored.objects["obj-1"].live).toBe(false);
  });

  it("never persists duplicate main-cell outputs in Tracepad metadata", () => {
    const state = defaultState("python");
    state.turns[0].outputs = [{ kind: "result", data: { "text/plain": "42" } }];
    expect(stateForPersistence(state).turns[0].outputs).toEqual([]);
  });
});
