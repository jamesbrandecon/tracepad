import { describe, expect, it } from "vitest";
import { defaultState, newTurn, syncTurnToNotebook, updateTurnCellMetadata } from "./state";

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

  it("syncs an existing turn through the JupyterLab 4 cell API", () => {
    const turn = newTurn("python");
    turn.prompt = "Summarize the data";
    turn.code = "result = data.describe()";
    const metadata = new Map<string, unknown>([["tracepad", { turnId: turn.id }]]);
    let source = "old code";
    const cell = {
      getMetadata: (key: string) => metadata.get(key),
      setMetadata: (key: string, value: unknown) => metadata.set(key, value),
      sharedModel: {
        getSource: () => source,
        setSource: (value: string) => { source = value; }
      }
    };
    const panel = {
      content: { model: { cells: { toArray: () => [cell] } } }
    } as any;

    expect(syncTurnToNotebook(panel, turn)).toBe(cell);
    expect(source).toBe(turn.code);
    expect(cell.getMetadata("tracepad")).toMatchObject({
      turnId: turn.id,
      prompt: turn.prompt,
      language: "python"
    });

    updateTurnCellMetadata(panel, turn, {
      id: "obj-1",
      turnId: turn.id,
      alias: "orders",
      displayName: "orders"
    } as any);
    expect(cell.getMetadata("tracepad")).toMatchObject({
      objectId: "obj-1",
      objectAlias: "orders"
    });
  });

  it("inserts a missing turn through the shared notebook model", () => {
    const turn = newTurn("python");
    turn.code = "answer = 42";
    const cells: any[] = [];
    const panel = {
      content: {
        model: {
          cells: {
            get length() { return cells.length; },
            get: (index: number) => cells[index],
            toArray: () => cells
          },
          sharedModel: {
            insertCell: (index: number, value: any) => {
              let source = value.source;
              const metadata = new Map(Object.entries(value.metadata ?? {}));
              cells.splice(index, 0, {
                getMetadata: (key: string) => metadata.get(key),
                setMetadata: (key: string, next: unknown) => metadata.set(key, next),
                sharedModel: {
                  getSource: () => source,
                  setSource: (next: string) => { source = next; }
                }
              });
            }
          }
        }
      }
    } as any;

    const cell = syncTurnToNotebook(panel, turn) as any;
    expect(cells).toHaveLength(1);
    expect(cell.sharedModel.getSource()).toBe(turn.code);
    expect(cell.getMetadata("tracepad")).toMatchObject({ turnId: turn.id });
  });
});
