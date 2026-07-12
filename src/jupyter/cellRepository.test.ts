import { describe, expect, it } from "vitest";
import { newTurn } from "../core/state";
import { syncTurnCell, type CellModelLike, type NotebookModelLike } from "./cellRepository";

function fakeNotebookModel(): { model: NotebookModelLike; cells: CellModelLike[] } {
  const cells: CellModelLike[] = [];
  const cellList = {
    get length() { return cells.length; },
    get: (index: number) => cells[index],
    [Symbol.iterator]: function* () { yield* cells; }
  };
  const model: NotebookModelLike = {
    cells: cellList,
    sharedModel: {
      insertCell: (index, value: any) => {
        let source = value.source;
        const metadata = new Map(Object.entries(value.metadata ?? {}));
        cells.splice(index, 0, {
          type: "code",
          outputs: { length: 0 },
          getMetadata: key => metadata.get(key),
          setMetadata: (key, next) => metadata.set(key, next),
          sharedModel: {
            getSource: () => source,
            setSource: next => { source = next; }
          }
        });
      }
    }
  };
  return { model, cells };
}

describe("Tracepad Jupyter cell repository", () => {
  it("creates one standard code cell per Tracepad turn", () => {
    const { model, cells } = fakeNotebookModel();
    const turn = newTurn("python");
    turn.prompt = "Summarize the data";
    turn.code = "result = data.describe()";

    syncTurnCell(model, turn);
    syncTurnCell(model, turn);

    expect(cells).toHaveLength(1);
    expect(cells[0].sharedModel.getSource()).toBe(turn.code);
    expect(cells[0].getMetadata("tracepad")).toMatchObject({
      turnId: turn.id,
      prompt: turn.prompt,
      language: "python",
      inputObjectIds: []
    });
  });

  it("updates the canonical source without replacing the cell", () => {
    const { model, cells } = fakeNotebookModel();
    const turn = newTurn("python");
    turn.code = "orders = load_orders()";
    syncTurnCell(model, turn);

    turn.code = "orders = load_orders().dropna()";
    syncTurnCell(model, turn);

    expect(cells).toHaveLength(1);
    expect(cells[0].sharedModel.getSource()).toBe(turn.code);
  });

  it("preserves captured object metadata when a native view remounts", () => {
    const { model, cells } = fakeNotebookModel();
    const turn = newTurn("python");
    syncTurnCell(model, turn);
    cells[0].setMetadata("tracepad", {
      ...cells[0].getMetadata("tracepad"),
      objectId: "obj-orders",
      objectAlias: "orders"
    });

    turn.prompt = "Inspect @orders";
    syncTurnCell(model, turn);

    expect(cells[0].getMetadata("tracepad")).toMatchObject({
      turnId: turn.id,
      prompt: "Inspect @orders",
      objectId: "obj-orders",
      objectAlias: "orders"
    });
  });

  it("persists stable input object ids on the backing cell", () => {
    const { model, cells } = fakeNotebookModel();
    const turn = newTurn("python", "obj-orders");
    turn.inputObjectIds = ["obj-orders", "obj-prices"];

    syncTurnCell(model, turn);

    expect(cells[0].getMetadata("tracepad")).toMatchObject({
      parentObjectId: "obj-orders",
      inputObjectIds: ["obj-orders", "obj-prices"]
    });
  });
});
