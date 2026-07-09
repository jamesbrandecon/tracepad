import type { NotebookPanel } from "@jupyterlab/notebook";
import type { TracepadLanguage, TracepadObject, TracepadState, TracepadTurn } from "./types";

const TRACEPAD_METADATA_KEY = "tracepad";

function timestamp(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const source = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${source}`;
}

export function defaultState(language: TracepadLanguage = "python"): TracepadState {
  return {
    version: 1,
    turns: [newTurn(language)],
    objects: {}
  };
}

export function newTurn(language: TracepadLanguage, parentObjectId?: string): TracepadTurn {
  const now = timestamp();
  return {
    id: newId("turn"),
    prompt: "",
    code: "",
    language,
    status: "draft",
    outputs: [],
    parentObjectId,
    createdAt: now,
    updatedAt: now
  };
}

export function loadState(panel: NotebookPanel, language: TracepadLanguage): TracepadState {
  const model = panel.content.model;
  const stored = model?.getMetadata(TRACEPAD_METADATA_KEY);
  if (!isState(stored)) return defaultState(language);

  const restored: TracepadState = {
    ...stored,
    turns: stored.turns.map(turn => ({
      ...turn,
      status: turn.status === "running" ? "stale" : turn.status,
      outputs: turn.outputs ?? []
    })),
    objects: Object.fromEntries(
      Object.entries(stored.objects ?? {}).map(([id, object]) => [id, { ...object, live: false }])
    )
  };
  return restored.turns.length ? restored : defaultState(language);
}

export function persistState(panel: NotebookPanel, state: TracepadState): void {
  const model = panel.content.model;
  if (!model) return;
  model.setMetadata(TRACEPAD_METADATA_KEY, state);
  model.dirty = true;
}

export function syncTurnToNotebook(panel: NotebookPanel, turn: TracepadTurn): unknown {
  const notebookModel = panel.content.model as any;
  if (!notebookModel) return null;
  const cells = notebookModel.cells?.toArray?.() ?? [];
  let cell = cells.find((candidate: any) => tracepadCellMetadata(candidate)?.turnId === turn.id);

  const metadata = {
    turnId: turn.id,
    prompt: turn.prompt,
    language: turn.language,
    parentObjectId: turn.parentObjectId ?? null
  };

  if (!cell) {
    const index = notebookModel.cells.length;
    notebookModel.sharedModel.insertCell(index, {
      cell_type: "code",
      source: turn.code,
      metadata: { [TRACEPAD_METADATA_KEY]: metadata },
      outputs: [],
      execution_count: null
    });
    cell = notebookModel.cells.get(index);
  }

  if (!cell) return null;
  setCellSource(cell, turn.code);
  setTracepadCellMetadata(cell, metadata);
  return cell;
}

export function updateTurnCellMetadata(panel: NotebookPanel, turn: TracepadTurn, object?: TracepadObject): void {
  const notebookModel = panel.content.model as any;
  const cells = notebookModel?.cells?.toArray?.() ?? [];
  const cell = cells.find((candidate: any) => tracepadCellMetadata(candidate)?.turnId === turn.id);
  if (!cell) return;
  setTracepadCellMetadata(cell, {
    turnId: turn.id,
    prompt: turn.prompt,
    language: turn.language,
    parentObjectId: turn.parentObjectId ?? null,
    objectId: object?.id ?? null,
    objectAlias: object?.alias ?? null
  });
}

function tracepadCellMetadata(cell: any): any {
  if (typeof cell?.getMetadata === "function") {
    return cell.getMetadata(TRACEPAD_METADATA_KEY);
  }
  return cell?.metadata?.get?.(TRACEPAD_METADATA_KEY)
    ?? cell?.metadata?.[TRACEPAD_METADATA_KEY];
}

function setTracepadCellMetadata(cell: any, value: unknown): void {
  if (typeof cell?.setMetadata === "function") {
    cell.setMetadata(TRACEPAD_METADATA_KEY, value);
    return;
  }
  cell?.metadata?.set?.(TRACEPAD_METADATA_KEY, value);
}

function setCellSource(cell: any, source: string): void {
  if (typeof cell?.sharedModel?.setSource === "function") {
    cell.sharedModel.setSource(source);
    return;
  }
  if (cell?.value) cell.value.text = source;
}

function isLanguage(value: unknown): value is TracepadLanguage {
  return value === "python" || value === "r" || value === "julia" || value === "sql";
}

function isTurn(value: unknown): value is TracepadTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return typeof turn.id === "string" && typeof turn.prompt === "string" && typeof turn.code === "string" && isLanguage(turn.language);
}

function isState(value: unknown): value is TracepadState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return state.version === 1 && Array.isArray(state.turns) && state.turns.every(isTurn) && typeof state.objects === "object";
}
