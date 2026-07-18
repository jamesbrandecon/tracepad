import type { TracepadTurn } from "../core/types";

const TRACEPAD_METADATA_KEY = "tracepad";

export interface CellModelLike {
  type: string;
  outputs: { length: number };
  getMetadata(key: string): any;
  setMetadata(key: string, value: unknown): void;
  sharedModel: {
    getSource(): string;
    setSource(source: string): void;
  };
}

export interface NotebookModelLike {
  cells: {
    readonly length: number;
    get(index: number): CellModelLike;
    [Symbol.iterator](): IterableIterator<CellModelLike>;
  };
  sharedModel: {
    insertCell(index: number, value: Record<string, unknown>): unknown;
  };
}

export function findTurnCell(model: NotebookModelLike, turnId: string): CellModelLike | null {
  return Array.from(model.cells).find(cell =>
    cell.type === "code"
    && cell.getMetadata(TRACEPAD_METADATA_KEY)?.turnId === turnId
  ) ?? null;
}

export function syncTurnCell(model: NotebookModelLike, turn: TracepadTurn): CellModelLike {
  let cell = findTurnCell(model, turn.id);
  const metadata = {
    turnId: turn.id,
    prompt: turn.prompt,
    language: turn.language,
    parentObjectId: turn.parentObjectId ?? null,
    inputObjectIds: turn.inputObjectIds ?? []
  };

  if (!cell) {
    const index = model.cells.length;
    model.sharedModel.insertCell(index, {
      cell_type: "code",
      source: turn.code,
      metadata: { [TRACEPAD_METADATA_KEY]: metadata },
      outputs: [],
      execution_count: null
    });
    cell = model.cells.get(index);
    if (!cell || cell.type !== "code") {
      throw new Error("Tracepad could not create the backing notebook cell.");
    }
  }

  if (cell.sharedModel.getSource() !== turn.code) {
    cell.sharedModel.setSource(turn.code);
  }
  cell.setMetadata(TRACEPAD_METADATA_KEY, {
    ...(cell.getMetadata(TRACEPAD_METADATA_KEY) ?? {}),
    ...metadata
  });
  return cell;
}
