export const TRACEPAD_METADATA_KEY = "tracepad";
export const TRACEPAD_PROMPT_MARKER = "%%ai";

export type TracepadCellRole = "prompt" | "code";

export interface TracepadGenerationMetadata {
  profile: string;
  provider: string;
  model: string;
  notes?: string;
  generatedAt: string;
  repairedAt?: string;
}

export interface TracepadDependencyMetadata {
  alias: string;
  runtimeName: string;
  turnId: string;
  turnNumber: string;
}

export interface TracepadCellMetadata {
  version: 1;
  role: TracepadCellRole;
  turnId: string;
  turnNumber: string;
  parentTurnId?: string;
  parentAlias?: string;
  alias?: string;
  aliases?: string[];
  runtimeName?: string;
  generation?: TracepadGenerationMetadata;
  promptHash?: string;
  generatedSourceHash?: string;
  uses?: TracepadDependencyMetadata[];
}

export interface MetadataCellLike {
  metadata: Record<string, unknown>;
}

export interface TracepadReference {
  alias: string;
  runtimeName: string;
  turnId: string;
  turnNumber: string;
}

export type TracepadResultKind = "data" | "model" | "plot";

export function tracepadMetadata(metadata: Record<string, unknown>): TracepadCellMetadata | undefined {
  const custom = record(metadata.custom);
  const customMetadata = record(custom?.metadata);
  const legacyMetadata = record(metadata.metadata);
  const values = [
    metadata[TRACEPAD_METADATA_KEY],
    customMetadata?.[TRACEPAD_METADATA_KEY],
    legacyMetadata?.[TRACEPAD_METADATA_KEY]
  ];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<TracepadCellMetadata>;
    if (
      candidate.version === 1
      && (candidate.role === "prompt" || candidate.role === "code")
      && typeof candidate.turnId === "string"
      && typeof candidate.turnNumber === "string"
    ) return candidate as TracepadCellMetadata;
  }
  return undefined;
}

export function withTracepadMetadata(
  metadata: Record<string, unknown>,
  tracepad: TracepadCellMetadata
): Record<string, unknown> {
  return { ...metadata, [TRACEPAD_METADATA_KEY]: tracepad };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function nextTurnNumber(cells: readonly MetadataCellLike[], parent?: TracepadCellMetadata): string {
  const promptMetadata = cells
    .map(cell => tracepadMetadata(cell.metadata))
    .filter((value): value is TracepadCellMetadata => value?.role === "prompt");
  if (parent) {
    const prefix = `${parent.turnNumber}.`;
    const childNumbers = promptMetadata
      .map(value => value.turnNumber)
      .filter(value => value.startsWith(prefix))
      .map(value => Number(value.slice(prefix.length).split(".")[0]))
      .filter(Number.isFinite);
    return `${parent.turnNumber}.${Math.max(0, ...childNumbers) + 1}`;
  }
  const rootNumbers = promptMetadata
    .map(value => value.turnNumber)
    .filter(value => /^\d+$/.test(value))
    .map(Number);
  return String(Math.max(0, ...rootNumbers) + 1);
}

export function childInsertionIndex(
  cells: readonly MetadataCellLike[],
  parent: TracepadCellMetadata,
  parentCodeIndex: number
): number {
  let index = parentCodeIndex + 1;
  const descendantPrefix = `${parent.turnNumber}.`;
  while (index < cells.length) {
    const metadata = tracepadMetadata(cells[index].metadata);
    if (!metadata?.turnNumber.startsWith(descendantPrefix)) break;
    index += 1;
  }
  return index;
}

export function collectReferences(cells: readonly MetadataCellLike[]): TracepadReference[] {
  const references: TracepadReference[] = [];
  for (const cell of cells) {
    const metadata = tracepadMetadata(cell.metadata);
    if (metadata?.role !== "code" || !metadata.runtimeName) continue;
    const aliases = [metadata.alias, ...(metadata.aliases ?? [])]
      .filter((value): value is string => Boolean(value));
    for (const alias of new Set(aliases)) {
      references.push({
        alias,
        runtimeName: metadata.runtimeName,
        turnId: metadata.turnId,
        turnNumber: metadata.turnNumber
      });
    }
  }
  return references;
}

export function selectGenerationReferences(
  cells: readonly MetadataCellLike[],
  prompt: string,
  parentAlias?: string,
  fallbackLimit = 0
): TracepadReference[] {
  const references = collectReferences(cells);
  const requested = new Set(
    [...prompt.matchAll(/@([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)*)/g)].map(match => match[1])
  );
  if (parentAlias) requested.add(parentAlias);
  const selected = references.filter(reference =>
    requested.has(reference.alias) || requested.has(reference.turnNumber)
  );
  if (selected.length) return selected;

  if (fallbackLimit <= 0) return [];

  const latestByTurn = new Map<string, TracepadReference>();
  for (const reference of references) latestByTurn.set(reference.turnId, reference);
  return [...latestByTurn.values()].slice(-fallbackLimit);
}

export function cleanAlias(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/_$/, "")
    .slice(0, 48);
}

export function runtimeNameFor(turnNumber: string): string {
  return `tracepad_result_${turnNumber.replace(/\./g, "_")}`;
}

export function formatPromptMarkdown(
  prompt: string,
  _turnNumber: string,
  _parentAlias?: string
): string {
  return stripPromptMarker(prompt).trim();
}

export function newPromptSource(): string {
  return `${TRACEPAD_PROMPT_MARKER}\n`;
}

export function extractPromptText(source: string): string {
  const value = stripPromptMarker(source).trim();
  if (!value.startsWith(">")) return value;
  const lines = value.split("\n").map(line => line.replace(/^>\s?/, ""));
  if (/^\*\*(?:Ask|Follow-up)\b/.test(lines[0] ?? "")) lines.shift();
  while (!lines[0]?.trim()) lines.shift();
  return lines.join("\n").trim();
}

export function isPromptMarkerSource(source: string): boolean {
  return /^\s*%%ai\s*(?:\r?\n|$)/i.test(source);
}

export function stripPromptMarker(source: string): string {
  return source.replace(/^\s*%%ai\s*(?:\r?\n|$)/i, "");
}

export function contentHash(source: string): string {
  let value = 2166136261;
  for (const character of source.replace(/\r\n/g, "\n").trim()) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function generatedSourceWasEdited(
  currentSource: string,
  generatedSourceHash: string | undefined
): boolean {
  return Boolean(generatedSourceHash && contentHash(currentSource) !== generatedSourceHash);
}

export function referencedTokens(prompt: string): string[] {
  return [...new Set(
    [...prompt.matchAll(/@([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)*)/g)].map(match => match[1])
  )];
}

export function classifyResult(source: string, outputMimes: readonly string[]): TracepadResultKind {
  const normalized = source.toLowerCase();
  if (
    outputMimes.some(mime => mime.startsWith("image/") || mime.includes("plotly"))
    || /\b(ggplot|matplotlib|seaborn|plotly)\b|\.plot\s*\(/.test(normalized)
  ) return "plot";
  if (
    /\.fit\s*\(|\b(lm|glm|ols|logit|probit|dbreg|dbdemand|dbcausal|dbmlearn)\s*\(/.test(normalized)
    || /\b(statsmodels|scikit-learn|sklearn|tidymodels)\b/.test(normalized)
  ) return "model";
  return "data";
}
