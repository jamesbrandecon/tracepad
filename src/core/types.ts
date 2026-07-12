export type TracepadLanguage = "python" | "r" | "julia" | "sql";

export type TurnStatus = "draft" | "generating" | "ready" | "running" | "succeeded" | "failed" | "stale";

export type ObjectKind = "dataframe" | "model" | "plot" | "text" | "value";

export type InspectCapability = "preview" | "summary" | "coef" | "fitted" | "predict" | "plot";

export interface TracepadOutput {
  kind: "stream" | "result" | "display" | "error";
  text?: string;
  data?: Record<string, unknown>;
  traceback?: string[];
}

export interface TablePreview {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
  truncated?: boolean;
}

export interface TracepadObject {
  id: string;
  handle: string;
  turnId: string;
  alias: string;
  displayName: string;
  language: TracepadLanguage;
  classNames: string[];
  kind: ObjectKind;
  capabilities: InspectCapability[];
  preview?: TablePreview;
  summary?: string;
  live: boolean;
  createdAt: string;
}

export interface TracepadTurn {
  id: string;
  prompt: string;
  code: string;
  language: TracepadLanguage;
  status: TurnStatus;
  generationNote?: string;
  error?: string;
  /** Retained for V1 metadata compatibility. Standard code cells own outputs. */
  outputs: TracepadOutput[];
  outputObjectId?: string;
  parentObjectId?: string;
  inputObjectIds?: string[];
  cellId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TracepadState {
  version: 1;
  turns: TracepadTurn[];
  objects: Record<string, TracepadObject>;
  activeTurnId?: string;
  kernelId?: string;
}

export interface GenerationResponse {
  ok: boolean;
  code: string;
  language: TracepadLanguage;
  notes: string;
  provider: string;
  warning?: string;
  error?: string;
}

export interface GenerationRequest {
  prompt: string;
  language: TracepadLanguage;
  context: Record<string, unknown>;
}

export type TracepadProviderId = string;

export interface TracepadProvider {
  id: TracepadProviderId;
  label: string;
  driver: "ollama-chat" | "openai-responses" | "openai-chat";
  configured: boolean;
  available: boolean;
  model: string;
  models: string[];
  base_url: string;
  requires_api_key: boolean;
  error?: string | null;
}

export interface TracepadModelProfile {
  id: string;
  label: string;
  provider: TracepadProviderId;
  model: string;
  configured: boolean;
  available: boolean;
  error?: string | null;
}

export interface ProviderStatusResponse {
  ok: boolean;
  ready: boolean;
  active_profile?: string | null;
  active_provider?: TracepadProviderId | null;
  active_model?: string | null;
  providers: TracepadProvider[];
  profiles: TracepadModelProfile[];
  config_files?: string[];
  error?: string;
}

export interface ProviderConfiguration {
  profile: string;
  provider?: TracepadProviderId;
  model: string;
  api_key?: string;
  base_url?: string;
}

export interface InspectResult {
  title: string;
  outputs: TracepadOutput[];
  error?: string;
}

export interface ExecutionResult {
  error?: string;
}
