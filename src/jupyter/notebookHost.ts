import { CodeCell, type ICodeCellModel } from "@jupyterlab/cells";
import { PageConfig } from "@jupyterlab/coreutils";
import type { NotebookPanel } from "@jupyterlab/notebook";
import { ServerConnection } from "@jupyterlab/services";
import { Widget } from "@lumino/widgets";
import type { TracepadNotebookHost } from "../core/host";
import { restoreState, stateForPersistence } from "../core/state";
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
} from "../core/types";
import { bindObjectAlias, captureObject, detectLanguage, runInspection } from "../kernel";
import { findTurnCell, syncTurnCell, type NotebookModelLike } from "./cellRepository";

const TRACEPAD_METADATA_KEY = "tracepad";

export class JupyterNotebookHost implements TracepadNotebookHost {
  constructor(readonly panel: NotebookPanel) {}

  get path(): string {
    return this.panel.context.path;
  }

  get language(): TracepadLanguage {
    return detectLanguage(this.panel);
  }

  loadState(): TracepadState {
    return restoreState(
      this.panel.content.model?.getMetadata(TRACEPAD_METADATA_KEY),
      this.language
    );
  }

  persistState(state: TracepadState): void {
    const model = this.panel.content.model;
    if (!model) return;
    model.setMetadata(TRACEPAD_METADATA_KEY, stateForPersistence(state));
    model.dirty = true;
  }

  subscribeStateChanged(listener: () => void): () => void {
    const model = this.panel.content.model;
    if (!model) return () => undefined;
    const changed = () => listener();
    model.metadataChanged.connect(changed);
    return () => model.metadataChanged.disconnect(changed);
  }

  variableNames(): string[] {
    const source = Array.from(this.panel.content.model?.cells ?? [])
      .map(cell => cell.sharedModel.getSource())
      .join("\n") ?? "";
    const names = new Set<string>();
    for (const match of source.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
      names.add(match[1]);
    }
    return Array.from(names).slice(0, 60);
  }

  ensureTurn(turn: TracepadTurn): void {
    this.syncTurn(turn);
  }

  hasOutput(turn: TracepadTurn): boolean {
    return this.findCell(turn)?.outputs.length ? true : false;
  }

  mountCodeEditor(
    turn: TracepadTurn,
    container: HTMLElement,
    onSourceChanged: (source: string) => void
  ): () => void {
    const model = this.syncTurn(turn);
    const widget = this.createCodeCell(model);
    widget.addClass("tp-native-editor-widget");
    widget.inViewport = true;
    let lastSource = model.sharedModel.getSource();
    const changed = () => {
      const source = model.sharedModel.getSource();
      if (source === lastSource) return;
      lastSource = source;
      onSourceChanged(source);
    };
    model.contentChanged.connect(changed);
    Widget.attach(widget, container);
    return () => {
      model.contentChanged.disconnect(changed);
      disposeMountedWidget(widget);
    };
  }

  mountOutput(turn: TracepadTurn, container: HTMLElement): () => void {
    const model = this.syncTurn(turn);
    const cell = this.createCodeCell(model);
    const output = cell.cloneOutputArea();
    output.addClass("tp-native-output-widget");
    Widget.attach(output, container);
    return () => {
      disposeMountedWidget(output);
      cell.dispose();
    };
  }

  async executeTurn(turn: TracepadTurn): Promise<ExecutionResult> {
    if (!turn.code.trim()) return { error: "Generate or write code before running this cell." };
    if (!this.panel.sessionContext.session?.kernel) {
      return { error: "Start a kernel for this notebook before running Tracepad code." };
    }
    const model = this.syncTurn(turn);
    const cell = this.createCodeCell(model);
    cell.inViewport = true;
    try {
      const reply = await CodeCell.execute(cell, this.panel.sessionContext, {
        recordTiming: this.panel.content.notebookConfig.recordTiming
      });
      const content = reply?.content as any;
      if (content?.status === "error") {
        return { error: `${content.ename ?? "ExecutionError"}: ${content.evalue ?? ""}` };
      }
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      cell.dispose();
    }
  }

  updateTurnObjectMetadata(turn: TracepadTurn, object?: TracepadObject): void {
    const cell = this.findCell(turn);
    if (!cell) return;
    cell.setMetadata(TRACEPAD_METADATA_KEY, {
      turnId: turn.id,
      prompt: turn.prompt,
      language: turn.language,
      parentObjectId: turn.parentObjectId ?? null,
      inputObjectIds: turn.inputObjectIds ?? [],
      objectId: object?.id ?? null,
      objectAlias: object?.alias ?? null
    });
  }

  captureObject(turn: TracepadTurn, objectId: string, alias: string): Promise<TracepadObject | null> {
    return captureObject(this.panel, turn, objectId, alias);
  }

  bindObjectAlias(object: TracepadObject, alias: string): Promise<void> {
    return bindObjectAlias(this.panel, object, alias);
  }

  inspect(
    object: TracepadObject,
    capability: InspectCapability,
    predictionExpression = ""
  ): Promise<InspectResult> {
    return runInspection(this.panel, object, capability, predictionExpression);
  }

  async providerStatus(): Promise<ProviderStatusResponse> {
    return this.request<ProviderStatusResponse>("tracepad/providers", { method: "GET" }, "Provider discovery");
  }

  async configureProvider(configuration: ProviderConfiguration): Promise<ProviderStatusResponse> {
    return this.request<ProviderStatusResponse>("tracepad/providers", {
      method: "POST",
      body: JSON.stringify(configuration),
      headers: { "Content-Type": "application/json" }
    }, "Provider setup");
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    return this.request<GenerationResponse>("tracepad/generate", {
      method: "POST",
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" }
    }, "Generation");
  }

  private findCell(turn: TracepadTurn): ICodeCellModel | null {
    const model = this.panel.content.model;
    if (!model) return null;
    return findTurnCell(model as unknown as NotebookModelLike, turn.id) as ICodeCellModel | null;
  }

  private syncTurn(turn: TracepadTurn): ICodeCellModel {
    const notebookModel = this.panel.content.model;
    if (!notebookModel) throw new Error("The notebook model is not available.");
    return syncTurnCell(
      notebookModel as unknown as NotebookModelLike,
      turn
    ) as ICodeCellModel;
  }

  private createCodeCell(model: ICodeCellModel): CodeCell {
    const notebook = this.panel.content;
    return notebook.contentFactory.createCodeCell({
      model,
      contentFactory: notebook.contentFactory,
      rendermime: notebook.rendermime,
      editorConfig: notebook.editorConfig.code,
      maxNumberOutputs: notebook.notebookConfig.maxNumberOutputs,
      showInputPlaceholder: notebook.notebookConfig.showInputPlaceholder,
      inputHistoryScope: notebook.notebookConfig.inputHistoryScope
    }).initializeState();
  }

  private async request<T extends { ok: boolean; error?: string }>(
    path: string,
    init: RequestInit,
    label: string
  ): Promise<T> {
    const response = await ServerConnection.makeRequest(
      `${PageConfig.getBaseUrl()}${path}`,
      init,
      ServerConnection.makeSettings()
    );
    const data = await response.json() as T;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `${label} failed: ${response.status}`);
    }
    return data;
  }
}

function disposeMountedWidget(widget: Widget): void {
  if (widget.isAttached && widget.node.isConnected) {
    Widget.detach(widget);
  } else if (widget.isAttached) {
    widget.clearFlag(Widget.Flag.IsAttached);
  }
  widget.dispose();
}
