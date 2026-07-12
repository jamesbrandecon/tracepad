import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import * as vscode from "vscode";
import { generateCode } from "./providerClient";
import {
  discoverConfigurationRoot,
  loadProviderRegistry,
  profileReady,
  type ProviderRegistry
} from "./providerConfig";
import {
  appendResultBridge,
  stripResultBridge,
  TRACEPAD_RESULT_MIME
} from "./resultBridge";
import {
  childInsertionIndex,
  classifyResult,
  cleanAlias,
  collectReferences,
  contentHash,
  extractPromptText,
  formatPromptMarkdown,
  generatedSourceWasEdited,
  isPromptMarkerSource,
  nextTurnNumber,
  referencedTokens,
  runtimeNameFor,
  selectGenerationReferences,
  tracepadMetadata,
  withTracepadMetadata,
  type TracepadCellMetadata
} from "./turnModel";

const NOTEBOOK_TYPE = "jupyter-notebook";
let resultRendererMessaging: vscode.NotebookRendererMessaging | undefined;
const activeGenerations = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Tracepad");
  const statusBars = new TracepadStatusBarProvider();
  const modelStatus = new TracepadModelStatus(context);
  const rendererMessaging = vscode.notebooks.createRendererMessaging("tracepad.resultRenderer");
  resultRendererMessaging = rendererMessaging;
  output.appendLine(`Tracepad ${String(context.extension.packageJSON.version)} activated.`);
  context.subscriptions.push(
    output,
    statusBars,
    modelStatus,
    rendererMessaging.onDidReceiveMessage(event => {
      void handleRendererMessage(event.editor, event.message, rendererMessaging, output, context);
    }),
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, statusBars),
    vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook.notebookType === NOTEBOOK_TYPE) {
        statusBars.refresh();
        updateActiveTracepadContext();
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const cell = findCell(event.document.uri);
      if (cell?.notebook.notebookType === NOTEBOOK_TYPE) {
        statusBars.refresh();
        updateActiveTracepadContext();
        if (
          isTracepadPromptCell(cell)
          && event.contentChanges.some(change => change.text.endsWith("@"))
        ) {
          void vscode.commands.executeCommand("editor.action.triggerSuggest");
        }
      }
    }),
    vscode.window.onDidChangeActiveNotebookEditor(editor => {
      updateActiveTracepadContext(editor);
      void modelStatus.refresh(editor);
    }),
    vscode.window.onDidChangeNotebookEditorSelection(event => updateActiveTracepadContext(event.notebookEditor)),
    vscode.workspace.onDidOpenNotebookDocument(notebook => {
      if (notebook.notebookType === NOTEBOOK_TYPE) void migrateLegacyEmptyCodeCells(notebook, output);
    }),
    vscode.languages.registerCompletionItemProvider(
      { language: "markdown" },
      new TracepadReferenceCompletionProvider(),
      "@"
    ),
    vscode.commands.registerCommand("tracepad.addTurn", () => addRootTurn(output)),
    vscode.commands.registerCommand("tracepad.generate", (target?: unknown) => generateTurn(target, output, context)),
    vscode.commands.registerCommand("tracepad.generateAndRun", (target?: unknown) => generateAndRun(target, output, context)),
    vscode.commands.registerCommand("tracepad.generateRunAndInsert", (target?: unknown) => generateRunAndInsert(target, output, context)),
    vscode.commands.registerCommand("tracepad.fixWithAI", (target?: unknown) => fixWithAI(target, output, context)),
    vscode.commands.registerCommand("tracepad.exploreResult", (target?: unknown) => exploreResult(target, output, context)),
    vscode.commands.registerCommand("tracepad.insertReference", (target?: unknown) => insertReference(target)),
    vscode.commands.registerCommand("tracepad.showLineage", (target?: unknown) => showLineage(target)),
    vscode.commands.registerCommand("tracepad.removeEmptyTurn", (target?: unknown) => removeEmptyTurn(target)),
    vscode.commands.registerCommand("tracepad.renameResult", (target?: unknown) => renameResult(target)),
    vscode.commands.registerCommand("tracepad.selectProfile", () => selectProfile(context)),
    vscode.commands.registerCommand("tracepad.configureCredential", () => configureCredential(context)),
    vscode.commands.registerCommand("tracepad.showDiagnostics", () => showDiagnostics(context, output))
  );
  updateActiveTracepadContext();
  void modelStatus.refresh();
  for (const notebook of vscode.workspace.notebookDocuments) {
    if (notebook.notebookType === NOTEBOOK_TYPE) void migrateLegacyEmptyCodeCells(notebook, output);
  }
}

export function deactivate(): void {}

async function handleRendererMessage(
  editor: vscode.NotebookEditor,
  messageValue: unknown,
  messaging: vscode.NotebookRendererMessaging,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  const message = messageValue && typeof messageValue === "object"
    ? messageValue as Record<string, unknown>
    : {};
  const turnId = typeof message.turnId === "string" ? message.turnId : "";
  const cell = turnId
    ? editor.notebook.getCells().find(candidate => tracepadMetadata(candidate.metadata)?.turnId === turnId
      && tracepadMetadata(candidate.metadata)?.role === "code")
    : undefined;
  if (!cell) return;
  const metadata = tracepadMetadata(cell.metadata);
  if (message.type === "ready" && metadata?.alias) {
    await messaging.postMessage({ type: "aliasUpdated", turnId, alias: metadata.alias }, editor);
  }
  if (message.type === "rename") await renameResult(cell);
  if (message.type === "explore") await exploreResult(cell, output, context);
}

class TracepadStatusBarProvider implements vscode.NotebookCellStatusBarItemProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCellStatusBarItems = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  provideCellStatusBarItems(cell: vscode.NotebookCell): vscode.NotebookCellStatusBarItem[] | undefined {
    const metadata = tracepadMetadata(cell.metadata);
    const markerPrompt = cell.kind === vscode.NotebookCellKind.Markup
      && isPromptMarkerSource(cell.document.getText());
    if (!metadata && !markerPrompt) return undefined;
    const items: vscode.NotebookCellStatusBarItem[] = [];

    if (markerPrompt || metadata?.role === "prompt") {
      const codeCell = metadata && findTurnCell(cell.notebook, metadata.turnId, "code");
      const codeMetadata = codeCell && tracepadMetadata(codeCell.metadata);
      const prompt = extractPromptText(cell.document.getText());
      const stale = Boolean(codeMetadata?.promptHash && contentHash(prompt) !== codeMetadata.promptHash);
      const dependencies = codeMetadata?.uses ?? [];
      const availableReferences = currentReferencesBefore(cell);
      if (availableReferences.length) {
        items.push(statusItem(
          "$(mention) Reference",
          vscode.NotebookCellStatusBarAlignment.Left,
          command("tracepad.insertReference", cell),
          "Insert a reference to a prior Tracepad result",
          65
        ));
      }
      if (dependencies.length) {
        items.push(statusItem(
          `$(references) Uses ${dependencies.map(item => `@${item.alias}`).join(", ")}`,
          vscode.NotebookCellStatusBarAlignment.Left,
          command("tracepad.showLineage", cell),
          "Show this turn's inputs and downstream results",
          70
        ));
      }
      if (stale) {
        items.push(statusItem(
          "$(warning) Code is stale",
          vscode.NotebookCellStatusBarAlignment.Right,
          command("tracepad.generate", cell),
          "The prompt changed after code was generated",
          110
        ));
      }
      items.push(statusItem(
        "$(sparkle) Generate",
        vscode.NotebookCellStatusBarAlignment.Right,
        command("tracepad.generate", cell),
        markerPrompt ? "Adopt this %%ai prompt and generate code" : "Generate code from this request",
        100
      ));
      return items;
    }
    if (!metadata) return undefined;

    if (!cell.document.getText().trim() && !cell.outputs.length) {
      items.push(statusItem(
        "$(trash)",
        vscode.NotebookCellStatusBarAlignment.Right,
        command("tracepad.removeEmptyTurn", cell),
        "Remove this empty Tracepad turn",
        100
      ));
      return items;
    }
    const renderedOutput = hasTracepadRenderedOutput(cell);
    if (metadata.alias && !renderedOutput) {
      items.push(statusItem(
        `$(edit) @${metadata.alias}`,
        vscode.NotebookCellStatusBarAlignment.Left,
        command("tracepad.renameResult", cell),
        `Result name; runtime variable ${metadata.runtimeName}`,
        80
      ));
    }
    const consumers = consumersFor(cell);
    if (consumers.length) {
      items.push(statusItem(
        `$(references) Used by ${consumers.length}`,
        vscode.NotebookCellStatusBarAlignment.Left,
        command("tracepad.showLineage", cell),
        "Show downstream Tracepad turns",
        70
      ));
    }
    if (hasExecutionError(cell)) {
      const repairedAt = metadata.generation?.repairedAt
        ? Date.parse(metadata.generation.repairedAt)
        : 0;
      const failedAt = cell.executionSummary?.timing?.endTime ?? 0;
      const repairPending = repairedAt > failedAt;
      items.push(repairPending
        ? statusItem(
            "$(check) AI fix ready · run to verify",
            vscode.NotebookCellStatusBarAlignment.Right,
            undefined,
            "Tracepad replaced the failed code; use the native Run action to verify it",
            120
          )
        : statusItem(
            "$(wrench) Fix with AI",
            vscode.NotebookCellStatusBarAlignment.Right,
            command("tracepad.fixWithAI", cell),
            "Generate a correction from the prompt, code, and kernel error",
            120
          ));
    }
    if (hasInspectableOutput(cell) && !renderedOutput) {
      items.push(statusItem(
        "$(search) Explore",
        vscode.NotebookCellStatusBarAlignment.Right,
        command("tracepad.exploreResult", cell),
        "Ask a follow-up or inspect this result",
        100
      ));
    }
    return items;
  }
}

class TracepadModelStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem("tracepad.model", vscode.StatusBarAlignment.Right, 90);
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item.command = "tracepad.selectProfile";
    this.item.name = "Tracepad model";
    this.subscriptions = [
      this.item,
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("tracepad")) void this.refresh();
      }),
      context.secrets.onDidChange(() => void this.refresh())
    ];
  }

  async refresh(editor = vscode.window.activeNotebookEditor): Promise<void> {
    if (!editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) {
      this.item.hide();
      return;
    }
    try {
      const registry = await resolvedProviderRegistry(this.context, editor.notebook.uri);
      const profile = registry.profiles[registry.activeProfile];
      const provider = registry.providers[profile.provider];
      const ready = profileReady(profile, registry.providers, registry.environment);
      const model = profile.model || (provider.driver === "ollama-chat" ? "Auto-detect" : "Select model");
      this.item.text = `$(sparkle) ${provider.label} · ${model}`;
      this.item.tooltip = ready
        ? `Tracepad uses ${profile.label} (${profile.model}). Click to change model profile.`
        : `${profile.label} needs setup. Click to select or configure a model profile.`;
      this.item.backgroundColor = ready ? undefined : new vscode.ThemeColor("statusBarItem.warningBackground");
      this.item.show();
    } catch (error) {
      this.item.text = "$(warning) Tracepad model setup";
      this.item.tooltip = `Tracepad configuration error: ${errorMessage(error)}`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      this.item.show();
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

class TracepadReferenceCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument): vscode.CompletionItem[] | undefined {
    const cell = findCell(document.uri);
    const metadata = cell && tracepadMetadata(cell.metadata);
    const markerPrompt = cell?.kind === vscode.NotebookCellKind.Markup
      && isPromptMarkerSource(cell.document.getText());
    if (!cell || (metadata?.role !== "prompt" && !markerPrompt)) return undefined;

    const references = currentReferencesBefore(cell);
    return references.reverse().map((reference, index) => {
      const item = new vscode.CompletionItem(`@${reference.alias}`, vscode.CompletionItemKind.Variable);
      item.insertText = reference.alias;
      item.filterText = reference.alias;
      const resultCell = findTurnCell(cell.notebook, reference.turnId, "code");
      const state = resultCell && hasRuntimeResult(resultCell) ? "ready" : "run required";
      const kind = resultCell
        ? classifyResult(stripResultBridge(resultCell.document.getText()), resultCell.outputs.flatMap(value => value.items.map(output => output.mime)))
        : "result";
      item.detail = `${kind} · turn ${reference.turnNumber} · ${state}`;
      item.documentation = new vscode.MarkdownString(
        `Use **@${reference.alias}** (or **@${reference.turnNumber}**) to reference kernel object \`${reference.runtimeName}\`.`
      );
      item.sortText = String(index).padStart(4, "0");
      item.preselect = index === 0;
      return item;
    });
  }
}

async function insertReference(target: unknown): Promise<void> {
  const cell = findCell(target);
  if (!cell || !isTracepadPromptCell(cell)) {
    void vscode.window.showErrorMessage("Choose a Tracepad prompt before inserting a result reference.");
    return;
  }
  const references = currentReferencesBefore(cell).reverse();
  if (!references.length) {
    void vscode.window.showInformationMessage("No earlier named Tracepad results are available in this notebook.");
    return;
  }
  const choice = await vscode.window.showQuickPick(references.map(reference => {
    const resultCell = findTurnCell(cell.notebook, reference.turnId, "code");
    const state = resultCell && hasRuntimeResult(resultCell) ? "ready" : "run required";
    const kind = resultCell
      ? classifyResult(
          stripResultBridge(resultCell.document.getText()),
          resultCell.outputs.flatMap(value => value.items.map(output => output.mime))
        )
      : "result";
    return {
      label: `@${reference.alias}`,
      description: `turn ${reference.turnNumber} · ${kind} · ${state}`,
      detail: reference.runtimeName,
      reference
    };
  }), {
    title: "Insert Tracepad result reference",
    placeHolder: "Choose a prior result"
  });
  if (!choice) return;

  const editor = vscode.window.activeTextEditor?.document.uri.toString() === cell.document.uri.toString()
    ? vscode.window.activeTextEditor
    : undefined;
  const end = cell.document.lineAt(Math.max(0, cell.document.lineCount - 1)).range.end;
  const position = editor?.selection.active ?? end;
  const prefix = position.character === 0 && position.line === 0
    ? ""
    : /\s$/.test(cell.document.getText(new vscode.Range(new vscode.Position(0, 0), position))) ? "" : " ";
  const edit = new vscode.WorkspaceEdit();
  edit.insert(cell.document.uri, position, `${prefix}@${choice.reference.alias}`);
  if (!await vscode.workspace.applyEdit(edit)) {
    void vscode.window.showErrorMessage("Tracepad could not insert the selected reference.");
  }
}

function updateActiveTracepadContext(editor = vscode.window.activeNotebookEditor): void {
  let metadata: TracepadCellMetadata | undefined;
  let markerPrompt = false;
  let executionError = false;
  if (editor?.notebook.cellCount) {
    const index = Math.min(editor.selection.start, editor.notebook.cellCount - 1);
    const cell = editor.notebook.cellAt(index);
    metadata = tracepadMetadata(cell.metadata);
    markerPrompt = cell.kind === vscode.NotebookCellKind.Markup && isPromptMarkerSource(cell.document.getText());
    executionError = metadata?.role === "code" && hasExecutionError(cell);
  }
  void vscode.commands.executeCommand("setContext", "tracepad.activePrompt", metadata?.role === "prompt" || markerPrompt);
  void vscode.commands.executeCommand("setContext", "tracepad.activeResult", metadata?.role === "code");
  void vscode.commands.executeCommand("setContext", "tracepad.activeError", executionError);
}

async function addRootTurn(output: vscode.OutputChannel): Promise<void> {
  output.appendLine(`[${new Date().toISOString()}] Add AI Prompt command invoked.`);
  const editor = vscode.window.activeNotebookEditor;
  if (!editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) {
    void vscode.window.showErrorMessage("Open a Jupyter notebook before adding a Tracepad turn.");
    return;
  }
  const index = insertionIndex(editor);
  await insertPromptCell(editor, index, undefined, "");
}

async function exploreResult(
  target: unknown,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  const cell = findCell(target);
  const metadata = cell && tracepadMetadata(cell.metadata);
  if (!cell || metadata?.role !== "code" || !metadata.alias) {
    void vscode.window.showErrorMessage("Choose a Tracepad result cell first.");
    return;
  }
  if (!hasInspectableOutput(cell)) {
    void vscode.window.showInformationMessage("Run this cell successfully before exploring its result.");
    return;
  }
  const resultKind = classifyResult(
    stripResultBridge(cell.document.getText()),
    cell.outputs.flatMap(output => output.items.map(item => item.mime))
  );
  const renderedKind = tracepadRenderedKind(cell) ?? resultKind;
  const choices: Array<vscode.QuickPickItem & { prompt: string }> = [{
      label: "$(comment-discussion) Ask a follow-up",
      description: "Write a custom request using this result",
      prompt: ""
    }];
  if (renderedKind === "data") choices.push({
      label: "$(preview) Summarize and diagnose",
      description: "Structure, quality, assumptions, and useful diagnostics",
      prompt: `Using @${metadata.alias}, summarize this result and show the most informative diagnostics for its object type.`
    },
    {
      label: "$(graph) Visualize",
      description: "Generate an appropriate, reusable plot",
      prompt: `Using @${metadata.alias}, create the most informative visualization for this result with clear labels and return the plot object.`
    });
  if (renderedKind === "model") choices.push({
      label: "$(symbol-method) Inspect model",
      description: "Summary, coefficients, fitted values, and prediction support",
      prompt: `Using @${metadata.alias}, inspect this model. Show its summary and coefficients, diagnose the fit, and explain what prediction and plotting methods are available.`
    },
    {
      label: "$(graph) Plot model diagnostics",
      description: "Create diagnostics appropriate for the fitted model",
      prompt: `Using @${metadata.alias}, create and return the most informative diagnostic plot for this fitted model.`
    },
    {
      label: "$(symbol-value) Generate predictions",
      description: "Create a reusable prediction result",
      prompt: `Using @${metadata.alias}, generate a useful prediction example from the available model data and return the prediction result.`
    });
  if (renderedKind === "plot") choices.push({
    label: "$(preview) Explain and critique",
    description: "Interpret the plot and identify improvements",
    prompt: `Using @${metadata.alias}, explain the important patterns in this plot and critique whether it communicates the result clearly.`
  }, {
    label: "$(edit) Revise visualization",
    description: "Generate an improved plot object",
    prompt: `Using @${metadata.alias}, revise this visualization for clearer comparison, labeling, and presentation, then return the improved plot object.`
  });
  const choice = await vscode.window.showQuickPick(choices, {
    title: `Explore @${metadata.alias}`,
    placeHolder: "Choose how to continue from this result"
  });
  if (!choice) return;
  let prompt = choice.prompt;
  if (!prompt) {
    prompt = await vscode.window.showInputBox({
      title: `Ask about @${metadata.alias}`,
      prompt: "The result reference is added automatically.",
      placeHolder: "Compare the top categories and plot their monthly trend",
      ignoreFocusOut: true,
      validateInput: value => value.trim() ? undefined : "Write a follow-up request."
    }) ?? "";
    if (!prompt.trim()) return;
    if (!prompt.includes(`@${metadata.alias}`)) prompt = `Using @${metadata.alias}, ${prompt.trim()}`;
  }
  const editor = await showNotebookEditor(cell.notebook);
  const index = childInsertionIndex(cell.notebook.getCells(), metadata, cell.index);
  const promptCell = await insertPromptCell(editor, index, metadata, prompt);
  if (promptCell) await generatePromptCell(promptCell, output, context);
}

async function insertPromptCell(
  editor: vscode.NotebookEditor,
  index: number,
  parent: TracepadCellMetadata | undefined,
  promptText: string
): Promise<vscode.NotebookCell | undefined> {
  const notebook = editor.notebook;
  const turnId = randomUUID();
  const turnNumber = nextTurnNumber(notebook.getCells(), parent);
  const shared = {
    version: 1 as const,
    turnId,
    turnNumber,
    ...(parent?.turnId ? { parentTurnId: parent.turnId } : {}),
    ...(parent?.alias ? { parentAlias: parent.alias } : {})
  };
  const renderedPrompt = promptText ? formatPromptMarkdown(promptText, turnNumber, parent?.alias) : "%%ai\n";
  const prompt = new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, renderedPrompt, "markdown");
  prompt.metadata = withHostTracepadMetadata({}, { ...shared, role: "prompt" });

  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [vscode.NotebookEdit.insertCells(index, [prompt])]);
  if (!await vscode.workspace.applyEdit(edit)) {
    void vscode.window.showErrorMessage("Tracepad could not add the notebook cells.");
    return undefined;
  }
  editor.selection = new vscode.NotebookRange(index, index + 1);
  editor.revealRange(editor.selection, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);
  if (!promptText) await vscode.commands.executeCommand("notebook.cell.edit");
  return notebook.cellAt(index);
}

async function generateTurn(
  target: unknown,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext,
  options: GenerationOptions = {}
): Promise<vscode.NotebookCell | undefined> {
  output.appendLine(`[${new Date().toISOString()}] Generate command invoked.`);
  let cell = findCell(target);
  if (!cell) {
    void vscode.window.showErrorMessage("Choose a Tracepad prompt cell first.");
    return undefined;
  }
  let metadata = tracepadMetadata(cell.metadata);
  if (!metadata && cell.kind === vscode.NotebookCellKind.Markup && isPromptMarkerSource(cell.document.getText())) {
    cell = await adoptMarkerPrompt(cell);
    metadata = cell && tracepadMetadata(cell.metadata);
  }
  if (!cell) return undefined;
  const promptCell = metadata?.role === "prompt" ? cell : findTurnCell(cell.notebook, metadata?.turnId, "prompt");
  if (!promptCell) {
    void vscode.window.showErrorMessage("Start a Markdown cell with %%ai, or choose an existing Tracepad prompt.");
    return undefined;
  }
  return generatePromptCell(promptCell, output, context, options);
}

async function generateAndRun(
  target: unknown,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  const codeCell = await generateTurn(target, output, context);
  if (!codeCell) return;
  if (!await ensureReferencesReady(codeCell)) return;
  await executeCodeCell(codeCell);
}

async function generateRunAndInsert(
  target: unknown,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  const codeCell = await generateTurn(target, output, context);
  if (!codeCell || !await ensureReferencesReady(codeCell)) return;
  await executeCodeCell(codeCell);
  if (codeCell.executionSummary?.success === false) return;
  const editor = await showNotebookEditor(codeCell.notebook);
  await insertPromptCell(editor, codeCell.index + 1, undefined, "");
}

async function adoptMarkerPrompt(cell: vscode.NotebookCell): Promise<vscode.NotebookCell | undefined> {
  const prompt = extractPromptText(cell.document.getText());
  if (!prompt) {
    void vscode.window.showErrorMessage("Write an English request below %%ai first.");
    return undefined;
  }
  const metadata: TracepadCellMetadata = {
    version: 1,
    role: "prompt",
    turnId: randomUUID(),
    turnNumber: nextTurnNumber(cell.notebook.getCells())
  };
  const edit = new vscode.WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    vscode.NotebookEdit.updateCellMetadata(cell.index, withHostTracepadMetadata(cell.metadata, metadata))
  ]);
  if (!await vscode.workspace.applyEdit(edit)) {
    void vscode.window.showErrorMessage("Tracepad could not adopt this %%ai prompt.");
    return undefined;
  }
  return cell.notebook.cellAt(cell.index);
}

async function executeCodeCell(codeCell: vscode.NotebookCell): Promise<void> {
  const editor = await showNotebookEditor(codeCell.notebook);
  editor.selection = new vscode.NotebookRange(codeCell.index, codeCell.index + 1);
  editor.revealRange(editor.selection, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);
  const completion = waitForCellExecution(codeCell);
  await vscode.commands.executeCommand("notebook.cell.execute");
  await completion;
  const settings = vscode.workspace.getConfiguration("tracepad", codeCell.notebook.uri);
  if (
    settings.get<boolean>("collapseCodeAfterRun", true)
    && codeCell.executionSummary?.success !== false
    && codeCell.outputs.length
  ) {
    await vscode.commands.executeCommand("notebook.cell.collapseCellInput");
  }
}

function waitForCellExecution(cell: vscode.NotebookCell): Promise<void> {
  const previousOrder = cell.executionSummary?.executionOrder;
  const previousEnd = cell.executionSummary?.timing?.endTime;
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      subscription.dispose();
      if (error) reject(error);
      else resolve();
    };
    const subscription = vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook !== cell.notebook) return;
      const change = event.cellChanges.find(value => value.cell.document.uri.toString() === cell.document.uri.toString());
      const summary = change?.executionSummary;
      if (
        summary?.success !== undefined
        && (summary.executionOrder !== previousOrder || summary.timing?.endTime !== previousEnd)
      ) finish();
    });
    const timeout = setTimeout(() => finish(new Error(
      "The Jupyter cell did not finish within five minutes. It may still be running in the kernel."
    )), 300_000);
  });
}

interface GenerationOptions {
  repairError?: string;
  forceReplace?: boolean;
}

async function generatePromptCell(
  promptCell: vscode.NotebookCell,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext,
  options: GenerationOptions = {}
): Promise<vscode.NotebookCell | undefined> {
  const metadata = tracepadMetadata(promptCell.metadata);
  let codeCell = findTurnCell(promptCell.notebook, metadata?.turnId, "code");
  const existingCodeMetadata = codeCell && tracepadMetadata(codeCell.metadata);
  const prompt = extractPromptText(promptCell.document.getText());
  if (!metadata) {
    void vscode.window.showErrorMessage("Tracepad could not read this prompt's notebook metadata.");
    return undefined;
  }
  if (!prompt) {
    void vscode.window.showErrorMessage("Write an English request in the Tracepad prompt cell first.");
    return undefined;
  }
  if (activeGenerations.has(metadata.turnId)) {
    void vscode.window.showInformationMessage(`Tracepad is already generating turn ${metadata.turnNumber}.`);
    return undefined;
  }
  activeGenerations.add(metadata.turnId);
  if (
    codeCell
    && existingCodeMetadata
    && !options.forceReplace
    && generatedSourceWasEdited(stripResultBridge(codeCell.document.getText()), existingCodeMetadata.generatedSourceHash)
  ) {
    const action = await vscode.window.showWarningMessage(
      "This generated code was edited after Tracepad created it. Replace those edits?",
      { modal: true },
      "Replace edited code"
    );
    if (action !== "Replace edited code") {
      activeGenerations.delete(metadata.turnId);
      return undefined;
    }
  }
  const runtimeName = existingCodeMetadata?.runtimeName ?? runtimeNameFor(metadata.turnNumber);
  const language = codeCell?.document.languageId ?? notebookLanguage(promptCell.notebook);

  let registry: ProviderRegistry;
  try {
    registry = await resolvedProviderRegistry(context, promptCell.notebook.uri);
  } catch (error) {
    activeGenerations.delete(metadata.turnId);
    output.appendLine(`[${new Date().toISOString()}] Configuration error: ${errorMessage(error)}`);
    output.show(true);
    void vscode.window.showErrorMessage(`Tracepad configuration failed: ${errorMessage(error)}`);
    return undefined;
  }
  const activeProfile = registry.profiles[registry.activeProfile];
  const activeProvider = registry.providers[activeProfile.provider];
  if (!profileReady(activeProfile, registry.providers, registry.environment)) {
    activeGenerations.delete(metadata.turnId);
    output.appendLine(`[${new Date().toISOString()}] Profile ${activeProfile.id} is not ready.`);
    const actions = activeProvider.requiresApiKey
      ? ["Configure credentials", "Select profile", "Show diagnostics"]
      : ["Select profile", "Show diagnostics"];
    const action = await vscode.window.showErrorMessage(
      `${activeProfile.label} is not ready. Configure ${activeProvider.apiKeyEnv || "its model"} before generating.`,
      ...actions
    );
    if (action === "Configure credentials") await configureCredential(context, activeProvider.id);
    if (action === "Select profile") await selectProfile(context);
    if (action === "Show diagnostics") await showDiagnostics(context, output);
    return undefined;
  }
  output.appendLine(
    `[${new Date().toISOString()}] Using ${activeProfile.id} (${activeProvider.id}/${activeProfile.model}); config root ${configurationRoot(promptCell.notebook.uri)}.`
  );
  const priorCells = promptCell.notebook.getCells().filter(cell => cell.index < promptCell.index);
  const selectedReferences = selectGenerationReferences(priorCells, prompt, metadata.parentAlias);
  const promptTokens = new Set(referencedTokens(prompt));
  const references = selectedReferences.map(reference => ({
    token: promptTokens.has(reference.turnNumber) ? `@${reference.turnNumber}` : `@${reference.alias}`,
    runtimeName: reference.runtimeName,
    turnNumber: reference.turnNumber,
    source: stripResultBridge(
      findTurnCell(promptCell.notebook, reference.turnId, "code")?.document.getText() ?? ""
    ).slice(0, 4000)
  }));

  let cancellationRequested = false;
  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: options.repairError
        ? `Tracepad: fixing turn ${metadata.turnNumber}`
        : `Tracepad: generating turn ${metadata.turnNumber}`,
      cancellable: true
    }, (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        cancellationRequested = true;
        controller.abort();
      });
      const generationPrompt = options.repairError
        ? repairPrompt(prompt, stripResultBridge(codeCell?.document.getText() ?? ""), options.repairError)
        : prompt;
      return generateCode(registry, generationPrompt, language, runtimeName, references, controller.signal);
    });
    if (cancellationRequested) return undefined;
    if (!findTurnCell(promptCell.notebook, metadata.turnId, "prompt")) {
      throw new Error("The prompt cell was removed while generation was running.");
    }
    const normalizedPrompt = formatPromptMarkdown(prompt, metadata.turnNumber, metadata.parentAlias);
    if (promptCell.document.getText() !== normalizedPrompt) await replaceCellSource(promptCell, normalizedPrompt);
    const generation = {
      profile: result.profile,
      provider: result.provider,
      model: result.model,
      notes: result.notes,
      generatedAt: new Date().toISOString(),
      ...(options.repairError ? { repairedAt: new Date().toISOString() } : {})
    };
    const alias = existingCodeMetadata?.alias ?? `result_${metadata.turnNumber.replace(/\./g, "_")}`;
    const presentedSource = appendResultBridge(result.code, language, {
      alias,
      runtimeName,
      turnId: metadata.turnId,
      turnNumber: metadata.turnNumber
    });
    const generatedSourceHash = contentHash(stripResultBridge(presentedSource));
    const dependencyMetadata = selectedReferences.map(reference => ({ ...reference }));
    if (codeCell && existingCodeMetadata) {
      await replaceGeneratedCell(codeCell, presentedSource, {
        ...existingCodeMetadata,
        alias,
        generation,
        promptHash: contentHash(prompt),
        generatedSourceHash,
        uses: dependencyMetadata
      });
    } else {
      codeCell = await insertGeneratedCodeCell(
        promptCell,
        metadata,
        language,
        runtimeName,
        alias,
        presentedSource,
        generation,
        contentHash(prompt),
        generatedSourceHash,
        dependencyMetadata
      );
    }
    if (!codeCell) throw new Error("Tracepad could not insert the generated code cell.");
    output.appendLine(`[${new Date().toISOString()}] Generated turn ${metadata.turnNumber} with ${result.profile} (${result.model}).`);
    const editor = await showNotebookEditor(codeCell.notebook);
    editor.selection = new vscode.NotebookRange(codeCell.index, codeCell.index + 1);
    editor.revealRange(editor.selection, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport);
    return codeCell;
  } catch (error) {
    if (cancellationRequested) {
      output.appendLine(`[${new Date().toISOString()}] Generation cancelled for turn ${metadata.turnNumber}.`);
      return undefined;
    }
    output.appendLine(error instanceof Error ? error.stack ?? error.message : String(error));
    output.show(true);
    void vscode.window.showErrorMessage(`Tracepad generation failed: ${errorMessage(error)}`);
    return undefined;
  } finally {
    activeGenerations.delete(metadata.turnId);
  }
}

async function fixWithAI(
  target: unknown,
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  const codeCell = findCell(target);
  const metadata = codeCell && tracepadMetadata(codeCell.metadata);
  if (!codeCell || metadata?.role !== "code" || !hasExecutionError(codeCell)) {
    void vscode.window.showInformationMessage("Fix with AI is available after a Tracepad cell returns an error.");
    return;
  }
  const promptCell = findTurnCell(codeCell.notebook, metadata.turnId, "prompt");
  if (!promptCell) {
    void vscode.window.showErrorMessage("Tracepad could not find the request paired with this code cell.");
    return;
  }
  const error = executionErrorText(codeCell);
  const fixed = await generatePromptCell(promptCell, output, context, {
    repairError: error,
    forceReplace: true
  });
  if (fixed) {
    void vscode.window.showInformationMessage("Tracepad updated the generated code. Run the cell to verify the fix.");
  }
}

function repairPrompt(prompt: string, source: string, error: string): string {
  return [
    "Repair the notebook code while preserving the user's intent and result contract.",
    `Original request:\n${prompt}`,
    `Current code:\n${source}`,
    `Kernel error:\n${error}`,
    "Return corrected executable code only through the required JSON contract."
  ].join("\n\n");
}

async function ensureReferencesReady(codeCell: vscode.NotebookCell): Promise<boolean> {
  const metadata = tracepadMetadata(codeCell.metadata);
  const missing = (metadata?.uses ?? []).filter(reference => {
    const source = findTurnCell(codeCell.notebook, reference.turnId, "code");
    return !source || !hasRuntimeResult(source);
  });
  if (!missing.length) return true;
  const action = await vscode.window.showWarningMessage(
    `Run required result${missing.length === 1 ? "" : "s"} first: ${missing.map(item => `@${item.alias}`).join(", ")}.`,
    "Run required cells"
  );
  if (action !== "Run required cells") return false;
  for (const reference of missing) {
    const source = findTurnCell(codeCell.notebook, reference.turnId, "code");
    if (!source) return false;
    await executeCodeCell(source);
    if (source.executionSummary?.success === false) {
      void vscode.window.showErrorMessage(`Could not prepare @${reference.alias}; its source cell failed.`);
      return false;
    }
  }
  return true;
}

async function showLineage(target: unknown): Promise<void> {
  const selected = findCell(target);
  const selectedMetadata = selected && tracepadMetadata(selected.metadata);
  if (!selected || !selectedMetadata) return;
  const codeCell = selectedMetadata.role === "code"
    ? selected
    : findTurnCell(selected.notebook, selectedMetadata.turnId, "code");
  const metadata = codeCell && tracepadMetadata(codeCell.metadata);
  if (!codeCell || !metadata) {
    void vscode.window.showInformationMessage("Generate this prompt to create its lineage.");
    return;
  }
  const entries: Array<vscode.QuickPickItem & { cell: vscode.NotebookCell }> = [];
  for (const dependency of metadata.uses ?? []) {
    const cell = findTurnCell(codeCell.notebook, dependency.turnId, "code");
    if (cell) entries.push({
      label: `$(arrow-up) @${dependency.alias}`,
      description: `input from turn ${dependency.turnNumber}`,
      detail: "Jump to the result used by this turn",
      cell
    });
  }
  for (const consumer of consumersFor(codeCell)) {
    const consumerMetadata = tracepadMetadata(consumer.metadata);
    if (!consumerMetadata) continue;
    entries.push({
      label: `$(arrow-down) @${consumerMetadata.alias ?? `result_${consumerMetadata.turnNumber.replace(/\./g, "_")}`}`,
      description: `downstream turn ${consumerMetadata.turnNumber}`,
      detail: "Jump to a result that uses this turn",
      cell: consumer
    });
  }
  if (!entries.length) {
    void vscode.window.showInformationMessage("This result has no recorded inputs or downstream Tracepad turns yet.");
    return;
  }
  const choice = await vscode.window.showQuickPick(entries, {
    title: `Lineage for @${metadata.alias ?? metadata.turnNumber}`,
    placeHolder: "Choose a connected result to jump to"
  });
  if (!choice) return;
  const editor = await showNotebookEditor(choice.cell.notebook);
  editor.selection = new vscode.NotebookRange(choice.cell.index, choice.cell.index + 1);
  editor.revealRange(editor.selection, vscode.NotebookEditorRevealType.InCenter);
}

async function insertGeneratedCodeCell(
  promptCell: vscode.NotebookCell,
  promptMetadata: TracepadCellMetadata,
  language: string,
  runtimeName: string,
  alias: string,
  source: string,
  generation: NonNullable<TracepadCellMetadata["generation"]>,
  promptHash: string,
  generatedSourceHash: string,
  uses: NonNullable<TracepadCellMetadata["uses"]>
): Promise<vscode.NotebookCell | undefined> {
  const code = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, source, language);
  code.metadata = withHostTracepadMetadata({}, {
    version: 1,
    role: "code",
    turnId: promptMetadata.turnId,
    turnNumber: promptMetadata.turnNumber,
    ...(promptMetadata.parentTurnId ? { parentTurnId: promptMetadata.parentTurnId } : {}),
    ...(promptMetadata.parentAlias ? { parentAlias: promptMetadata.parentAlias } : {}),
    alias,
    aliases: [],
    runtimeName,
    generation,
    promptHash,
    generatedSourceHash,
    uses
  });
  const index = promptCell.index + 1;
  const edit = new vscode.WorkspaceEdit();
  edit.set(promptCell.notebook.uri, [vscode.NotebookEdit.insertCells(index, [code])]);
  if (!await vscode.workspace.applyEdit(edit)) return undefined;
  return promptCell.notebook.cellAt(index);
}

async function renameResult(target: unknown): Promise<void> {
  const cell = findCell(target);
  const metadata = cell && tracepadMetadata(cell.metadata);
  if (!cell || metadata?.role !== "code" || !metadata.alias) {
    void vscode.window.showErrorMessage("Choose a Tracepad result cell first.");
    return;
  }
  const value = await vscode.window.showInputBox({
    title: "Name Tracepad result",
    value: metadata.alias,
    prompt: `The runtime variable remains ${metadata.runtimeName}; this name is used for @ references.`,
    validateInput: input => cleanAlias(input) ? undefined : "Use letters, numbers, and underscores."
  });
  if (value === undefined) return;
  const alias = cleanAlias(value);
  const duplicate = collectReferences(cell.notebook.getCells()).some(reference =>
    reference.alias === alias && reference.turnId !== metadata.turnId
  );
  if (duplicate) {
    void vscode.window.showErrorMessage(`@${alias} is already used by another Tracepad result.`);
    return;
  }
  await updateCellMetadata(cell, {
    ...metadata,
    alias,
    aliases: [...new Set([...(metadata.aliases ?? []), metadata.alias])]
  });
  if (resultRendererMessaging) {
    const editor = vscode.window.visibleNotebookEditors.find(candidate => candidate.notebook === cell.notebook);
    await resultRendererMessaging.postMessage({ type: "aliasUpdated", turnId: metadata.turnId, alias }, editor);
  }
}

async function removeEmptyTurn(target: unknown): Promise<void> {
  const codeCell = findCell(target);
  const metadata = codeCell && tracepadMetadata(codeCell.metadata);
  const promptCell = codeCell && findTurnCell(codeCell.notebook, metadata?.turnId, "prompt");
  if (
    !codeCell
    || metadata?.role !== "code"
    || codeCell.document.getText().trim()
    || codeCell.outputs.length
    || !promptCell
    || Math.abs(promptCell.index - codeCell.index) !== 1
  ) {
    void vscode.window.showErrorMessage("Only an adjacent, unexecuted empty Tracepad turn can be removed here.");
    return;
  }
  const start = Math.min(promptCell.index, codeCell.index);
  const edit = new vscode.WorkspaceEdit();
  edit.set(codeCell.notebook.uri, [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(start, start + 2))]);
  if (!await vscode.workspace.applyEdit(edit)) {
    void vscode.window.showErrorMessage("Tracepad could not remove the empty turn.");
  }
}

async function selectProfile(context: vscode.ExtensionContext): Promise<void> {
  const notebookUri = vscode.window.activeNotebookEditor?.notebook.uri;
  const settings = vscode.workspace.getConfiguration("tracepad", notebookUri);
  let registry: ProviderRegistry;
  try {
    registry = await resolvedProviderRegistry(context, notebookUri);
  } catch (error) {
    void vscode.window.showErrorMessage(errorMessage(error));
    return;
  }
  const selected = await vscode.window.showQuickPick(
    Object.values(registry.profiles).map(profile => {
      const provider = registry.providers[profile.provider];
      return {
        label: `${profile.id === registry.activeProfile ? "$(check) " : ""}${profile.label}`,
        description: profile.model || (provider.driver === "ollama-chat" ? "Auto-detect installed model" : "model required"),
        detail: `${provider.label} · ${provider.driver}${profileReady(profile, registry.providers, registry.environment) ? "" : " · setup required"}`,
        profile: profile.id,
        plainLabel: profile.label
      };
    }),
    { title: "Select Tracepad model profile", placeHolder: registry.activeProfile }
  );
  if (!selected) return;
  const target = configurationTarget(notebookUri);
  await settings.update("profile", selected.profile, target);
  const profile = registry.profiles[selected.profile];
  const provider = registry.providers[profile.provider];
  if (!profileReady(profile, registry.providers, registry.environment) && provider.requiresApiKey) {
    const action = await vscode.window.showWarningMessage(
      `${selected.plainLabel} needs ${provider.apiKeyEnv || "credentials"}.`,
      "Configure now"
    );
    if (action === "Configure now") await configureCredential(context, provider.id);
    return;
  }
  void vscode.window.showInformationMessage(`Tracepad will use ${selected.plainLabel}.`);
}

async function configureCredential(
  context: vscode.ExtensionContext,
  preferredProvider?: string
): Promise<void> {
  const notebookUri = vscode.window.activeNotebookEditor?.notebook.uri;
  let registry: ProviderRegistry;
  try {
    registry = await resolvedProviderRegistry(context, notebookUri);
  } catch (error) {
    void vscode.window.showErrorMessage(`Tracepad configuration failed: ${errorMessage(error)}`);
    return;
  }
  const providers = Object.values(registry.providers).filter(provider => provider.requiresApiKey && provider.apiKeyEnv);
  const selected = preferredProvider
    ? providers.find(provider => provider.id === preferredProvider)
    : await vscode.window.showQuickPick(providers.map(provider => ({
        label: provider.label,
        description: provider.apiKeyEnv,
        provider
      })), { title: "Configure Tracepad credentials" }).then(item => item?.provider);
  if (!selected) return;
  const value = await vscode.window.showInputBox({
    title: `${selected.label} API key`,
    prompt: `Stored in VS Code SecretStorage as ${selected.apiKeyEnv}; never written to the notebook or YAML.`,
    password: true,
    ignoreFocusOut: true,
    validateInput: input => input.trim() ? undefined : "Enter an API key."
  });
  if (!value?.trim()) return;
  await context.secrets.store(secretStorageKey(selected.apiKeyEnv), value.trim());
  const profile = Object.values(registry.profiles).find(item => item.provider === selected.id);
  if (profile) {
    const settings = vscode.workspace.getConfiguration("tracepad", notebookUri);
    await settings.update("profile", profile.id, configurationTarget(notebookUri));
  }
  void vscode.window.showInformationMessage(`${selected.label} credentials configured for Tracepad.`);
}

async function resolvedProviderRegistry(
  context: vscode.ExtensionContext,
  notebookUri?: vscode.Uri
): Promise<ProviderRegistry> {
  const settings = vscode.workspace.getConfiguration("tracepad", notebookUri);
  const options = {
    workspaceRoot: configurationRoot(notebookUri),
    explicitPath: settings.get<string>("configPath", ""),
    profileOverride: settings.get<string>("profile", "")
  };
  const initial = loadProviderRegistry(options);
  const environment = { ...process.env };
  for (const provider of Object.values(initial.providers)) {
    if (!provider.apiKeyEnv) continue;
    const secret = await context.secrets.get(secretStorageKey(provider.apiKeyEnv));
    if (secret) environment[provider.apiKeyEnv] = secret;
  }
  return loadProviderRegistry({ ...options, environment });
}

function configurationRoot(notebookUri?: vscode.Uri): string {
  if (notebookUri) {
    const workspace = vscode.workspace.getWorkspaceFolder(notebookUri);
    if (workspace) return workspace.uri.fsPath;
    if (notebookUri.scheme === "file") return discoverConfigurationRoot(dirname(notebookUri.fsPath));
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function configurationTarget(notebookUri?: vscode.Uri): vscode.ConfigurationTarget {
  return notebookUri && vscode.workspace.getWorkspaceFolder(notebookUri)
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function secretStorageKey(environmentName: string): string {
  return `tracepad.apiKey.${environmentName}`;
}

async function showDiagnostics(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeNotebookEditor;
  const notebook = editor?.notebook;
  output.appendLine("\n=== Tracepad diagnostics ===");
  output.appendLine(`Version: ${String(context.extension.packageJSON.version)}`);
  output.appendLine(`Notebook: ${notebook?.uri.fsPath ?? "none selected"}`);
  output.appendLine(`Notebook type: ${notebook?.notebookType ?? "none"}`);
  output.appendLine(`Configuration root: ${configurationRoot(notebook?.uri)}`);
  if (notebook) {
    const kernelspec = (notebook.metadata as any)?.kernelspec;
    output.appendLine(`Kernelspec metadata: ${JSON.stringify(kernelspec ?? {})}`);
    const successful = notebook.getCells().filter(hasRuntimeResult).length;
    output.appendLine(`Successfully executed cells: ${successful}`);
    if (!successful) output.appendLine("Kernel warning: no successful execution is visible; verify the selected Jupyter kernel has ipykernel.");
  }
  try {
    const registry = await resolvedProviderRegistry(context, notebook?.uri);
    const profile = registry.profiles[registry.activeProfile];
    const provider = registry.providers[profile.provider];
    output.appendLine(`Config files: ${registry.loadedFiles.join(", ") || "built-in defaults"}`);
    output.appendLine(`Active profile: ${profile.id} (${profile.model || "model missing"})`);
    output.appendLine(`Provider: ${provider.id} (${provider.driver})`);
    output.appendLine(`Credential: ${provider.requiresApiKey ? (registry.environment[provider.apiKeyEnv] ? "configured" : `missing ${provider.apiKeyEnv}`) : "not required"}`);
    output.appendLine(`Ready: ${profileReady(profile, registry.providers, registry.environment)}`);
  } catch (error) {
    output.appendLine(`Configuration error: ${errorMessage(error)}`);
  }
  output.appendLine("=== End diagnostics ===\n");
  output.show(true);
}

async function migrateLegacyEmptyCodeCells(
  notebook: vscode.NotebookDocument,
  output: vscode.OutputChannel
): Promise<void> {
  const cells = notebook.getCells().filter(cell => {
    const metadata = tracepadMetadata(cell.metadata);
    return metadata?.role === "code"
      && !cell.document.getText().trim()
      && !cell.outputs.length;
  }).sort((left, right) => right.index - left.index);
  for (const cell of cells) {
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [
      vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(cell.index, cell.index + 1))
    ]);
    if (await vscode.workspace.applyEdit(edit)) {
      output.appendLine(`[${new Date().toISOString()}] Migrated empty legacy code cell for ${notebook.uri.fsPath}.`);
    }
  }
}

function statusItem(
  text: string,
  alignment: vscode.NotebookCellStatusBarAlignment,
  itemCommand?: vscode.Command,
  tooltip?: string,
  priority?: number
): vscode.NotebookCellStatusBarItem {
  const item = new vscode.NotebookCellStatusBarItem(text, alignment);
  item.command = itemCommand;
  item.tooltip = tooltip;
  item.priority = priority;
  return item;
}

function command(id: string, cell: vscode.NotebookCell): vscode.Command {
  return { title: id, command: id, arguments: [cell.document.uri] };
}

function hasInspectableOutput(cell: vscode.NotebookCell): boolean {
  if (!cell.outputs.length) return false;
  return !cell.outputs.some(output => output.items.some(item => item.mime.includes("error")));
}

function tracepadRenderedKind(cell: vscode.NotebookCell): "data" | "model" | "plot" | undefined {
  for (const output of cell.outputs) {
    for (const item of output.items) {
      if (item.mime !== TRACEPAD_RESULT_MIME) continue;
      try {
        const value = JSON.parse(new TextDecoder().decode(item.data)) as { kind?: unknown };
        if (value.kind === "data" || value.kind === "model" || value.kind === "plot") return value.kind;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function hasTracepadRenderedOutput(cell: vscode.NotebookCell): boolean {
  return cell.outputs.some(output => output.items.some(item => item.mime === TRACEPAD_RESULT_MIME));
}

function hasRuntimeResult(cell: vscode.NotebookCell): boolean {
  return cell.executionSummary?.executionOrder !== undefined
    && cell.executionSummary.success !== false;
}

function isTracepadPromptCell(cell: vscode.NotebookCell): boolean {
  const metadata = tracepadMetadata(cell.metadata);
  return cell.kind === vscode.NotebookCellKind.Markup
    && (metadata?.role === "prompt" || isPromptMarkerSource(cell.document.getText()));
}

function currentReferencesBefore(cell: vscode.NotebookCell) {
  const references = collectReferences(cell.notebook.getCells().filter(item => item.index < cell.index));
  const current = new Map<string, typeof references[number]>();
  for (const reference of references) {
    if (!current.has(reference.turnId)) current.set(reference.turnId, reference);
  }
  return [...current.values()];
}

function findCell(target?: unknown): vscode.NotebookCell | undefined {
  if (isNotebookCell(target)) return target;
  if (target instanceof vscode.Uri) {
    const documentUri = target.toString();
    for (const notebook of vscode.workspace.notebookDocuments) {
      const cell = notebook.getCells().find(item => item.document.uri.toString() === documentUri);
      if (cell) return cell;
    }
    return undefined;
  }
  const editor = vscode.window.activeNotebookEditor;
  if (!editor?.notebook.cellCount) return undefined;
  return editor.notebook.cellAt(Math.min(editor.selection.start, editor.notebook.cellCount - 1));
}

function isNotebookCell(value: unknown): value is vscode.NotebookCell {
  if (!value || typeof value !== "object") return false;
  return "document" in value
    && "notebook" in value
    && "index" in value;
}

function findTurnCell(
  notebook: vscode.NotebookDocument,
  turnId: string | undefined,
  role: "prompt" | "code"
): vscode.NotebookCell | undefined {
  if (!turnId) return undefined;
  return notebook.getCells().find(cell => {
    const metadata = tracepadMetadata(cell.metadata);
    return metadata?.turnId === turnId && metadata.role === role;
  });
}

function insertionIndex(editor: vscode.NotebookEditor): number {
  if (!editor.notebook.cellCount) return 0;
  const selected = editor.notebook.cellAt(Math.min(editor.selection.start, editor.notebook.cellCount - 1));
  const metadata = tracepadMetadata(selected.metadata);
  if (!metadata) return selected.index + 1;
  const rootNumber = metadata.turnNumber.split(".")[0];
  const rootCode = selected.notebook.getCells().find(cell => {
    const candidate = tracepadMetadata(cell.metadata);
    return candidate?.role === "code" && candidate.turnNumber === rootNumber;
  });
  const rootMetadata = rootCode && tracepadMetadata(rootCode.metadata);
  if (!rootCode || !rootMetadata) return selected.index + 1;
  return childInsertionIndex(selected.notebook.getCells(), rootMetadata, rootCode.index);
}

async function updateCellMetadata(cell: vscode.NotebookCell, tracepad: TracepadCellMetadata): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    vscode.NotebookEdit.updateCellMetadata(cell.index, withHostTracepadMetadata(cell.metadata, tracepad))
  ]);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("Could not update Tracepad cell metadata.");
}

function withHostTracepadMetadata(
  metadata: Record<string, unknown>,
  tracepad: TracepadCellMetadata
): Record<string, unknown> {
  const next = withTracepadMetadata(metadata, tracepad) as Record<string, any>;
  if (vscode.extensions.getExtension("vscode.ipynb")?.exports?.dropCustomMetadata) {
    next.metadata = { ...(next.metadata ?? {}), tracepad };
  } else {
    next.custom = { ...(next.custom ?? {}) };
    next.custom.metadata = { ...(next.custom.metadata ?? {}), tracepad };
  }
  return next;
}

async function replaceGeneratedCell(
  cell: vscode.NotebookCell,
  source: string,
  tracepad: TracepadCellMetadata
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  replaceDocumentText(edit, cell.document, source);
  edit.set(cell.notebook.uri, [
    vscode.NotebookEdit.updateCellMetadata(cell.index, withHostTracepadMetadata(cell.metadata, tracepad))
  ]);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("Could not update the generated code cell.");
}

async function replaceCellSource(cell: vscode.NotebookCell, source: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  replaceDocumentText(edit, cell.document, source);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("Could not update the generated code cell.");
}

function replaceDocumentText(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, source: string): void {
  const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
  edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), source);
}

function consumersFor(cell: vscode.NotebookCell): vscode.NotebookCell[] {
  const metadata = tracepadMetadata(cell.metadata);
  if (!metadata) return [];
  return cell.notebook.getCells().filter(candidate => {
    const candidateMetadata = tracepadMetadata(candidate.metadata);
    return candidateMetadata?.role === "code"
      && candidateMetadata.turnId !== metadata.turnId
      && (
        candidateMetadata.parentTurnId === metadata.turnId
        || candidateMetadata.uses?.some(reference => reference.turnId === metadata.turnId)
      );
  });
}

function hasExecutionError(cell: vscode.NotebookCell): boolean {
  return cell.executionSummary?.success === false
    || cell.outputs.some(output => output.items.some(item => item.mime.includes("error")));
}

function executionErrorText(cell: vscode.NotebookCell): string {
  const values: string[] = [];
  for (const output of cell.outputs) {
    for (const item of output.items) {
      if (!item.mime.includes("error") && item.mime !== "text/plain") continue;
      const text = new TextDecoder().decode(item.data);
      if (!text.trim()) continue;
      try {
        const parsed = JSON.parse(text) as { ename?: unknown; evalue?: unknown; traceback?: unknown };
        const traceback = Array.isArray(parsed.traceback) ? parsed.traceback.join("\n") : "";
        values.push([parsed.ename, parsed.evalue, traceback].filter(Boolean).join(": "));
      } catch {
        values.push(text);
      }
    }
  }
  return values.join("\n").slice(0, 12000) || "The kernel reported that execution failed without a textual traceback.";
}

async function showNotebookEditor(notebook: vscode.NotebookDocument): Promise<vscode.NotebookEditor> {
  return vscode.window.visibleNotebookEditors.find(editor => editor.notebook === notebook)
    ?? vscode.window.showNotebookDocument(notebook);
}

function notebookLanguage(notebook: vscode.NotebookDocument): string {
  const metadata = notebook.metadata as any;
  const value = String(metadata?.language_info?.name ?? metadata?.kernelspec?.language ?? "python").toLowerCase();
  if (value === "ir" || value.startsWith("r-")) return "r";
  if (value.startsWith("julia")) return "julia";
  if (value.includes("sql")) return "sql";
  return value.startsWith("python") ? "python" : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
