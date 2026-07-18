import type { TracepadLanguage, TracepadState, TracepadTurn } from "./types";

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
    inputObjectIds: parentObjectId ? [parentObjectId] : [],
    createdAt: now,
    updatedAt: now
  };
}

export function restoreState(value: unknown, language: TracepadLanguage): TracepadState {
  if (!isState(value)) return defaultState(language);
  const restored: TracepadState = {
    ...value,
    turns: value.turns.map(turn => ({
      ...turn,
      status: turn.status === "running" ? "stale" : turn.status,
      outputs: []
    })),
    objects: Object.fromEntries(
      Object.entries(value.objects ?? {}).map(([id, object]) => [id, { ...object, live: false }])
    )
  };
  return restored.turns.length ? restored : defaultState(language);
}

export function stateForPersistence(state: TracepadState): TracepadState {
  return {
    ...state,
    turns: state.turns.map(turn => ({ ...turn, outputs: [] }))
  };
}

function isLanguage(value: unknown): value is TracepadLanguage {
  return value === "python" || value === "r" || value === "julia" || value === "sql";
}

function isTurn(value: unknown): value is TracepadTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return typeof turn.id === "string"
    && typeof turn.prompt === "string"
    && typeof turn.code === "string"
    && isLanguage(turn.language);
}

function isState(value: unknown): value is TracepadState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return state.version === 1
    && Array.isArray(state.turns)
    && state.turns.every(isTurn)
    && Boolean(state.objects)
    && typeof state.objects === "object";
}
