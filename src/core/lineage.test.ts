import { describe, expect, it } from "vitest";
import { buildLineageIndex, connectedLineageTurnIds, replaceReferenceAlias, resolveInputObjectIds } from "./lineage";
import { defaultState, newTurn } from "./state";
import type { TracepadObject } from "./types";

function object(id: string, alias: string, turnId: string): TracepadObject {
  return {
    id,
    alias,
    turnId,
    handle: `__${id}`,
    displayName: alias,
    language: "python",
    classNames: ["pandas.DataFrame"],
    kind: "dataframe",
    capabilities: ["preview"],
    live: true,
    createdAt: "2026-01-01T00:00:00Z"
  };
}

describe("Tracepad lineage", () => {
  it("resolves explicit references and inspection parents to stable object ids", () => {
    const objects = [object("obj-orders", "orders", "turn-1"), object("obj-prices", "prices", "turn-2")];
    expect(resolveInputObjectIds("Compare @orders with @prices and @orders", objects)).toEqual([
      "obj-orders",
      "obj-prices"
    ]);
    expect(resolveInputObjectIds("Plot this", objects, "obj-orders")).toEqual(["obj-orders"]);
  });

  it("does not expose planned objects or downstream lineage before results exist", () => {
    const state = defaultState("python");
    const first = state.turns[0];
    first.id = "turn-1";
    first.outputObjectId = "obj-orders";
    state.objects["obj-orders"] = object("obj-orders", "orders", first.id);
    const child = newTurn("python", "obj-orders");
    child.id = "turn-2";
    child.inputObjectIds = ["obj-orders"];
    child.outputObjectId = "obj-summary";
    state.objects["obj-summary"] = {
      ...object("obj-summary", "summary", child.id),
      materialized: false,
      live: false
    };
    state.turns.push(child);

    const planned = buildLineageIndex(state);
    expect(planned.turnByObjectId["obj-orders"]).toBe("turn-1");
    expect(planned.turnByObjectId["obj-summary"]).toBeUndefined();
    expect(planned.inputsByTurnId["turn-2"]).toEqual(["obj-orders"]);
    expect(planned.consumersByObjectId["obj-orders"]).toBeUndefined();

    state.objects["obj-summary"].materialized = true;
    const completed = buildLineageIndex(state);
    expect(completed.consumersByObjectId["obj-orders"]).toEqual(["turn-2"]);
  });

  it("does not resolve planned aliases as executable references", () => {
    const planned = { ...object("obj-orders", "orders", "turn-1"), materialized: false };
    expect(resolveInputObjectIds("Summarize @orders", [planned], planned.id)).toEqual([]);
  });

  it("collects the connected lineage while excluding unrelated turns", () => {
    const state = defaultState("python");
    const source = state.turns[0];
    source.id = "turn-source";
    source.outputObjectId = "obj-source";
    state.objects["obj-source"] = object("obj-source", "source", source.id);

    const model = newTurn("python", "obj-source");
    model.id = "turn-model";
    model.inputObjectIds = ["obj-source"];
    model.outputObjectId = "obj-model";
    state.objects["obj-model"] = object("obj-model", "model", model.id);

    const plot = newTurn("python", "obj-model");
    plot.id = "turn-plot";
    plot.inputObjectIds = ["obj-model"];
    plot.outputObjectId = "obj-plot";
    state.objects["obj-plot"] = object("obj-plot", "plot", plot.id);

    const unrelated = newTurn("python");
    unrelated.id = "turn-unrelated";
    unrelated.inputObjectIds = ["obj-source"];
    state.turns.push(model, plot, unrelated);

    expect([...connectedLineageTurnIds(buildLineageIndex(state), "obj-model")].sort()).toEqual([
      "turn-model",
      "turn-plot",
      "turn-source"
    ].sort());
  });

  it("updates prompt references when a result is renamed", () => {
    expect(replaceReferenceAlias("Plot @orders but not @orders_old", "orders", "sales")).toBe(
      "Plot @sales but not @orders_old"
    );
  });
});
