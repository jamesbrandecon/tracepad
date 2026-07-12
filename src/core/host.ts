import type {
  ExecutionResult,
  GenerationRequest,
  GenerationResponse,
  InspectCapability,
  InspectResult,
  ProviderConfiguration,
  ProviderStatusResponse,
  TracepadLanguage,
  TracepadObject,
  TracepadState,
  TracepadTurn
} from "./types";

export type DisposeHostView = () => void;

export interface TracepadNotebookHost {
  readonly path: string;
  readonly language: TracepadLanguage;

  loadState(): TracepadState;
  persistState(state: TracepadState): void;
  subscribeStateChanged(listener: () => void): () => void;
  variableNames(): string[];

  ensureTurn(turn: TracepadTurn): void;
  hasOutput(turn: TracepadTurn): boolean;
  mountCodeEditor(
    turn: TracepadTurn,
    container: HTMLElement,
    onSourceChanged: (source: string) => void
  ): DisposeHostView;
  mountOutput(turn: TracepadTurn, container: HTMLElement): DisposeHostView;
  executeTurn(turn: TracepadTurn): Promise<ExecutionResult>;
  updateTurnObjectMetadata(turn: TracepadTurn, object?: TracepadObject): void;

  captureObject(turn: TracepadTurn, objectId: string, alias: string): Promise<TracepadObject | null>;
  bindObjectAlias(object: TracepadObject, alias: string): Promise<void>;
  inspect(object: TracepadObject, capability: InspectCapability, predictionExpression?: string): Promise<InspectResult>;

  providerStatus(): Promise<ProviderStatusResponse>;
  configureProvider(configuration: ProviderConfiguration): Promise<ProviderStatusResponse>;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}
