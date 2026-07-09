import { PageConfig } from "@jupyterlab/coreutils";
import { ServerConnection } from "@jupyterlab/services";
import type { NotebookPanel } from "@jupyterlab/notebook";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bindObjectAlias, captureObject, detectLanguage, runInspection, runTurn } from "./kernel";
import { defaultState, loadState, newId, newTurn, persistState, syncTurnToNotebook, updateTurnCellMetadata } from "./state";
import type { GenerationResponse, InspectCapability, InspectResult, ProviderStatusResponse, TracepadLanguage, TracepadObject, TracepadOutput, TracepadProvider, TracepadProviderId, TracepadState, TracepadTurn } from "./types";

interface TracepadAppProps {
  panel: NotebookPanel;
  onOpenClassic?: () => void | Promise<void>;
}

export function TracepadApp({ panel, onOpenClassic }: TracepadAppProps): JSX.Element {
  const initialLanguage = detectLanguage(panel);
  const [state, setState] = useState<TracepadState>(() => loadState(panel, initialLanguage));
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [inspectionBusy, setInspectionBusy] = useState(false);
  const [predictionExpression, setPredictionExpression] = useState("");
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  const refreshProviders = useCallback(async () => {
    try {
      const status = await requestProviderStatus();
      setProviderStatus(status);
      setProviderError(null);
      if (!status.ready) setProviderSetupOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderStatus({ ok: false, ready: false, providers: [], error: message });
      setProviderError(message);
      setProviderSetupOpen(true);
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  const configureProvider = useCallback(async (configuration: ProviderConfiguration) => {
    setProviderBusy(true);
    setProviderError(null);
    try {
      const status = await requestProviderConfiguration(configuration);
      setProviderStatus(status);
      setProviderSetupOpen(false);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  }, []);

  const updateState = useCallback((recipe: (current: TracepadState) => TracepadState) => {
    setState(current => {
      const next = recipe(current);
      persistState(panel, next);
      return next;
    });
  }, [panel]);

  useEffect(() => {
    const model = panel.content.model;
    const onMetadataChanged = () => {
      const restored = loadState(panel, detectLanguage(panel));
      setState(current => current.turns.length === restored.turns.length ? current : restored);
    };
    model?.metadataChanged.connect(onMetadataChanged);
    return () => {
      if (model) model.metadataChanged.disconnect(onMetadataChanged);
    };
  }, [panel]);

  const currentLanguage = detectLanguage(panel);
  const selectedObject = selectedObjectId ? state.objects[selectedObjectId] : null;
  const liveObjects = useMemo(
    () => Object.values(state.objects).filter(object => object.live).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.objects]
  );

  const addTurn = useCallback((parentObjectId?: string) => {
    updateState(current => {
      const next = newTurn(currentLanguage, parentObjectId);
      return { ...current, turns: [...current.turns, next], activeTurnId: next.id };
    });
  }, [currentLanguage, updateState]);

  const updateTurn = useCallback((turnId: string, changes: Partial<TracepadTurn>) => {
    updateState(current => ({
      ...current,
      turns: current.turns.map(turn => turn.id === turnId ? { ...turn, ...changes, updatedAt: new Date().toISOString() } : turn)
    }));
  }, [updateState]);

  const generate = useCallback(async (turn: TracepadTurn, repairError?: string) => {
    if (!providerStatus?.ready) {
      setProviderError("Configure an AI provider before generating code.");
      setProviderSetupOpen(true);
      return;
    }
    if (!turn.prompt.trim()) {
      updateTurn(turn.id, { status: "failed", error: "Write a request before generating code." });
      return;
    }
    updateTurn(turn.id, { status: "generating", error: undefined, generationNote: undefined });
    try {
      const prompt = repairError
        ? `${turn.prompt}\n\nCurrent code:\n${turn.code}\n\nExecution error to fix:\n${repairError}\n\nReturn corrected code only.`
        : turn.prompt;
      const payload = {
        prompt,
        language: turn.language,
        context: {
          notebook_path: panel.context.path,
          notebook_variables: notebookVariableNames(panel),
          references: liveObjects.map(object => ({
            token: `@${object.alias}`,
            runtime_name: object.alias,
            type: object.kind,
            language: object.language,
            class_names: object.classNames,
            columns: object.preview?.columns ?? []
          })),
          parent: turn.parentObjectId ? state.objects[turn.parentObjectId] : null
        }
      };
      const response = await requestGeneration(payload);
      updateTurn(turn.id, {
        code: response.code,
        language: response.language,
        status: "ready",
        error: undefined,
        generationNote: [response.provider, response.notes, response.warning].filter(Boolean).join(" · ")
      });
    } catch (error) {
      updateTurn(turn.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }, [liveObjects, panel.context.path, providerStatus?.ready, state.objects, updateTurn]);

  const run = useCallback(async (turn: TracepadTurn) => {
    const cell = syncTurnToNotebook(panel, turn);
    updateTurn(turn.id, { status: "running", error: undefined, outputs: [] });
    const execution = await runTurn(panel, turn, cell);
    if (execution.error) {
      updateTurn(turn.id, { status: "failed", outputs: execution.outputs, error: execution.error });
      return;
    }

    const objectId = turn.outputObjectId ?? newId("obj");
    const alias = state.objects[objectId]?.alias || `result_${state.turns.findIndex(item => item.id === turn.id) + 1}`;
    const object = await captureObject(panel, turn, objectId, alias).catch(() => null);
    updateState(current => {
      const nextObject = object ? { ...object, live: true } : undefined;
      const nextTurn = {
        ...turn,
        status: "succeeded" as const,
        outputs: execution.outputs,
        outputObjectId: nextObject?.id,
        error: undefined,
        updatedAt: new Date().toISOString()
      };
      const next = {
        ...current,
        turns: current.turns.map(item => item.id === turn.id ? nextTurn : item),
        objects: nextObject ? { ...current.objects, [nextObject.id]: nextObject } : current.objects
      };
      updateTurnCellMetadata(panel, nextTurn, nextObject);
      return next;
    });
    if (object) setSelectedObjectId(object.id);
  }, [panel, state.objects, state.turns, updateState, updateTurn]);

  const runAll = useCallback(async () => {
    for (const turn of state.turns) {
      if (turn.code.trim()) await run(turn);
    }
  }, [run, state.turns]);

  const insertReference = useCallback((turnId: string, object: TracepadObject) => {
    updateState(current => ({
      ...current,
      turns: current.turns.map(turn => turn.id === turnId
        ? { ...turn, prompt: `${turn.prompt}${turn.prompt && !turn.prompt.endsWith(" ") ? " " : ""}@${object.alias} `, updatedAt: new Date().toISOString() }
        : turn)
    }));
  }, [updateState]);

  const renameObject = useCallback(async (object: TracepadObject, alias: string) => {
    const clean = alias.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^\d+/, "").slice(0, 48);
    if (!clean) return;
    await bindObjectAlias(panel, object, clean);
    updateState(current => ({
      ...current,
      objects: { ...current.objects, [object.id]: { ...object, alias: clean, displayName: clean } }
    }));
  }, [panel, updateState]);

  const inspect = useCallback(async (object: TracepadObject, capability: InspectCapability) => {
    setInspectionBusy(true);
    setInspection(null);
    try {
      const result = await runInspection(panel, object, capability, predictionExpression);
      setInspection(result);
    } finally {
      setInspectionBusy(false);
    }
  }, [panel, predictionExpression]);

  return (
    <div className="tracepad-shell">
      <header className="tracepad-topbar">
        <div className="tracepad-brand">
          <div>
            <h1>Tracepad</h1>
            <p>{panel.context.path || "Untitled notebook"}</p>
          </div>
        </div>
        <div className="tracepad-topbar-actions">
          {onOpenClassic ? <button className="tp-secondary" type="button" onClick={() => void onOpenClassic()}>Jupyter view</button> : null}
          <button className={providerStatus?.ready ? "tracepad-provider-pill ready" : "tracepad-provider-pill"} type="button" onClick={() => { setProviderSetupOpen(true); void refreshProviders(); }}>
            {providerStatus?.ready ? `${providerLabel(providerStatus.active_provider)} · ${providerStatus.active_model}` : providerStatus ? "Set up AI" : "Checking AI"}
          </button>
          <span className="tracepad-kernel-pill">{languageLabel(currentLanguage)} kernel</span>
          <button className="tp-secondary" type="button" onClick={() => addTurn()}>+ Cell</button>
          <button className="tp-primary" type="button" onClick={() => void runAll()}>Run all</button>
        </div>
      </header>

      <div className="tracepad-layout">
        <aside className="tracepad-rail" aria-label="Tracepad objects">
          <section>
            <div className="tp-section-heading"><span>Notebook</span><strong>{state.turns.length} turns</strong></div>
            <p className="tp-rail-copy">Ask in plain language, inspect the generated code, then follow each result into the next step.</p>
          </section>
          <section>
            <div className="tp-section-heading"><span>Live objects</span><strong>{liveObjects.length}</strong></div>
            {liveObjects.length ? (
              <div className="tp-object-list">
                {liveObjects.map(object => (
                  <button key={object.id} className={selectedObjectId === object.id ? "tp-object-row active" : "tp-object-row"} type="button" onClick={() => setSelectedObjectId(object.id)}>
                    <span>@{object.alias}</span>
                    <small>{object.kind} · {object.classNames[0]?.split(".").pop() || object.language}</small>
                  </button>
                ))}
              </div>
            ) : <p className="tp-empty-rail">Run a cell to create an inspectable object.</p>}
          </section>
          <section className="tp-rail-footnote">
            <strong>Standard notebook file</strong>
            <span>Generated code and Tracepad lineage are saved with this `.ipynb`.</span>
          </section>
        </aside>

        <main className="tracepad-notebook" aria-label="Tracepad notebook">
          {state.turns.map((turn, index) => (
            <TurnCard
              key={turn.id}
              index={index}
              turn={turn}
              objects={liveObjects}
              outputObject={turn.outputObjectId && state.objects[turn.outputObjectId]?.live ? state.objects[turn.outputObjectId] : undefined}
              onPromptChange={prompt => updateTurn(turn.id, { prompt, status: turn.status === "succeeded" ? "stale" : turn.status })}
              onCodeChange={code => updateTurn(turn.id, { code, status: turn.status === "succeeded" ? "stale" : turn.status })}
              onGenerate={() => void generate(turn)}
              onRun={() => void run(turn)}
              onFix={() => void generate(turn, turn.error)}
              onInsertReference={object => insertReference(turn.id, object)}
              onInspect={object => setSelectedObjectId(object.id)}
              onAddChild={() => addTurn(turn.outputObjectId)}
              onRename={renameObject}
            />
          ))}
          <button className="tp-add-cell-row" type="button" onClick={() => addTurn()}>+ Add analysis cell</button>
        </main>
      </div>

      {selectedObject ? (
        <Inspector
          object={selectedObject}
          inspection={inspection}
          busy={inspectionBusy}
          predictionExpression={predictionExpression}
          onPredictionExpression={setPredictionExpression}
          onInspect={inspect}
          onRename={renameObject}
          onClose={() => { setSelectedObjectId(null); setInspection(null); }}
          onUseInChild={() => { addTurn(selectedObject.id); setSelectedObjectId(null); }}
        />
      ) : null}
      {providerSetupOpen && providerStatus ? (
        <ProviderSetup
          status={providerStatus}
          busy={providerBusy}
          error={providerError}
          onConfigure={configuration => void configureProvider(configuration)}
          onClose={() => { setProviderSetupOpen(false); setProviderError(null); }}
        />
      ) : null}
    </div>
  );
}

interface ProviderConfiguration {
  provider: TracepadProviderId;
  model: string;
  api_key?: string;
  base_url?: string;
}

function ProviderSetup({
  status,
  busy,
  error,
  onConfigure,
  onClose
}: {
  status: ProviderStatusResponse;
  busy: boolean;
  error: string | null;
  onConfigure: (configuration: ProviderConfiguration) => void;
  onClose: () => void;
}) {
  const initialProvider = status.active_provider
    ?? status.providers.find(provider => provider.id === "ollama" && provider.available)?.id
    ?? "openai";
  const [selected, setSelected] = useState<TracepadProviderId>(initialProvider);
  const provider = status.providers.find(item => item.id === selected);
  const [model, setModel] = useState(provider?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "http://127.0.0.1:11434");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const next = status.providers.find(item => item.id === selected);
    setModel(next?.model ?? "");
    setBaseUrl(next?.base_url ?? "http://127.0.0.1:11434");
    setApiKey("");
  }, [selected, status.providers]);

  return (
    <div className="tp-provider-backdrop" role="presentation">
      <section className="tp-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="tracepad-provider-title">
        <header>
          <div>
            <span>AI provider</span>
            <h2 id="tracepad-provider-title">Connect Tracepad</h2>
            <p>Generation requires a live model. Credentials stay in the Jupyter server process and are never saved in notebooks.</p>
          </div>
          <button className="tp-icon" type="button" aria-label="Close AI setup" onClick={onClose}>×</button>
        </header>

        <div className="tp-provider-options" role="tablist" aria-label="AI providers">
          {status.providers.map(item => (
            <button key={item.id} className={selected === item.id ? "active" : ""} type="button" role="tab" aria-selected={selected === item.id} onClick={() => setSelected(item.id)}>
              <strong>{item.label}</strong>
              <small>{providerAvailability(item)}</small>
            </button>
          ))}
        </div>

        {provider ? (
          <form className="tp-provider-form" onSubmit={event => {
            event.preventDefault();
            onConfigure({
              provider: selected,
              model: model.trim(),
              api_key: selected === "ollama" ? undefined : apiKey.trim() || undefined,
              base_url: selected === "ollama" ? baseUrl.trim() : undefined
            });
          }}>
            {selected === "ollama" ? (
              <label>
                Ollama server
                <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434" />
              </label>
            ) : (
              <label>
                API key
                <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={provider.configured ? "Configured on the server" : `Enter ${provider.label} key`} autoComplete="off" />
              </label>
            )}
            <label>
              Model
              <input value={model} onChange={event => setModel(event.target.value)} list={selected === "ollama" ? "tracepad-ollama-models" : undefined} placeholder={selected === "openrouter" ? "Provider/model name" : "Model name"} />
              {selected === "ollama" ? <datalist id="tracepad-ollama-models">{provider.models.map(name => <option key={name} value={name} />)}</datalist> : null}
            </label>
            {provider.error && !provider.configured ? <p className="tp-provider-hint">{provider.error}</p> : null}
            {error ? <p className="tp-provider-error">{error}</p> : null}
            <div className="tp-provider-actions">
              <button className="tp-secondary" type="button" onClick={onClose}>Cancel</button>
              <button className="tp-primary" type="submit" disabled={busy || !model.trim()}>{busy ? "Connecting" : `Use ${provider.label}`}</button>
            </div>
          </form>
        ) : <p className="tp-provider-error">{status.error || "Provider status is unavailable."}</p>}
      </section>
    </div>
  );
}

function providerAvailability(provider: TracepadProvider): string {
  if (provider.configured) return provider.model || "Configured";
  if (provider.id === "ollama" && provider.available) return `${provider.models.length} local models`;
  return "Setup required";
}

function TurnCard({
  index,
  turn,
  objects,
  outputObject,
  onPromptChange,
  onCodeChange,
  onGenerate,
  onRun,
  onFix,
  onInsertReference,
  onInspect,
  onAddChild,
  onRename
}: {
  index: number;
  turn: TracepadTurn;
  objects: TracepadObject[];
  outputObject?: TracepadObject;
  onPromptChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onGenerate: () => void;
  onRun: () => void;
  onFix: () => void;
  onInsertReference: (object: TracepadObject) => void;
  onInspect: (object: TracepadObject) => void;
  onAddChild: () => void;
  onRename: (object: TracepadObject, alias: string) => void | Promise<void>;
}) {
  const [codeOpen, setCodeOpen] = useState(Boolean(turn.code));
  const references = turn.parentObjectId ? objects.filter(object => object.id === turn.parentObjectId) : objects;
  const disabled = turn.status === "generating" || turn.status === "running";
  return (
    <article className={`tp-turn tp-${turn.status}`}>
      <div className="tp-turn-index">{index + 1}</div>
      <section className="tp-prompt-card">
        {references.length ? (
          <div className="tp-reference-strip">
            <span>References</span>
            {references.map(object => <button key={object.id} type="button" onClick={() => onInsertReference(object)}>@{object.alias}<small>{object.kind}</small></button>)}
          </div>
        ) : null}
        <div className="tp-prompt-grid">
          <textarea
            aria-label={`Prompt for analysis cell ${index + 1}`}
            placeholder="Ask for an analysis, a plot, a model, or a follow-up on a prior result."
            value={turn.prompt}
            onChange={event => onPromptChange(event.target.value)}
            onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                onGenerate();
              }
            }}
          />
          <div className="tp-prompt-actions">
            <button className="tp-primary" type="button" onClick={onGenerate} disabled={disabled}>{turn.status === "generating" ? "Generating" : "Generate"}</button>
            <button className="tp-secondary" type="button" onClick={onRun} disabled={disabled || !turn.code.trim()}>{turn.status === "running" ? "Running" : "Run"}</button>
          </div>
        </div>
        {turn.generationNote ? <p className="tp-generation-note">{turn.generationNote}</p> : null}
        {turn.code || codeOpen ? (
          <section className="tp-code-drawer">
            <button className="tp-code-summary" type="button" onClick={() => setCodeOpen(open => !open)}>
              <span>Generated code</span>
              <span><em className={`tp-language ${turn.language}`}>{languageLabel(turn.language)}</em>{codeOpen ? "Hide" : "Show"}</span>
            </button>
            {codeOpen ? (
              <textarea
                className={`tp-code-editor ${turn.language}`}
                aria-label={`Generated code for analysis cell ${index + 1}`}
                value={turn.code}
                spellCheck={false}
                onChange={event => onCodeChange(event.target.value)}
              />
            ) : null}
          </section>
        ) : null}
      </section>

      <section className="tp-output-card">
        <header>
          <div>
            <span>Output</span>
            <strong>{outputObject ? `@${outputObject.alias}` : turn.status === "draft" ? "Awaiting analysis" : statusLabel(turn.status)}</strong>
          </div>
          <div className="tp-output-actions">
            {turn.status === "stale" ? <span className="tp-status stale">Stale</span> : null}
            {outputObject ? <button className="tp-secondary" type="button" onClick={() => onInspect(outputObject)}>Inspect</button> : null}
            {outputObject ? <button className="tp-secondary" type="button" onClick={onAddChild}>+ Child</button> : null}
          </div>
        </header>
        <div className="tp-output-content">
          {turn.error ? (
            <div className="tp-error-panel">
              <strong>Run failed</strong>
              <pre>{turn.error}</pre>
              <button className="tp-secondary" type="button" onClick={onFix}>Fix with AI</button>
            </div>
          ) : turn.outputs.length ? <OutputList outputs={turn.outputs} /> : <p className="tp-empty-output">Generate code, then run this cell to create an output object.</p>}
          {outputObject?.preview ? <TablePreview preview={outputObject.preview} /> : null}
        </div>
        {outputObject ? <AliasForm object={outputObject} onRename={onRename} /> : null}
      </section>
    </article>
  );
}

function Inspector({
  object,
  inspection,
  busy,
  predictionExpression,
  onPredictionExpression,
  onInspect,
  onRename,
  onClose,
  onUseInChild
}: {
  object: TracepadObject;
  inspection: InspectResult | null;
  busy: boolean;
  predictionExpression: string;
  onPredictionExpression: (value: string) => void;
  onInspect: (object: TracepadObject, capability: InspectCapability) => void;
  onRename: (object: TracepadObject, alias: string) => void | Promise<void>;
  onClose: () => void;
  onUseInChild: () => void;
}) {
  const [active, setActive] = useState<InspectCapability | "overview">("overview");
  const tabs: Array<InspectCapability | "overview"> = ["overview", ...object.capabilities];
  const activate = (tab: InspectCapability | "overview") => {
    setActive(tab);
    if (tab !== "overview" && tab !== "predict") onInspect(object, tab);
  };
  return (
    <section className="tp-inspector" aria-label={`Inspecting ${object.alias}`}>
      <header className="tp-inspector-header">
        <div>
          <span>Inspecting</span>
          <h2>@{object.alias}</h2>
          <p>{object.classNames[0] || object.language} · {object.kind}</p>
        </div>
        <button className="tp-icon" type="button" aria-label="Close inspector" onClick={onClose}>×</button>
      </header>
      <div className="tp-inspector-tools">
        <AliasForm object={object} onRename={onRename} />
        <button className="tp-primary" type="button" onClick={onUseInChild}>Use in child cell</button>
      </div>
      <div className="tp-inspector-tabs" role="tablist">
        {tabs.map(tab => <button key={tab} className={active === tab ? "active" : ""} type="button" onClick={() => activate(tab)}>{tabLabel(tab)}</button>)}
      </div>
      <div className="tp-inspector-body">
        {active === "overview" ? <Overview object={object} /> : null}
        {active === "predict" ? (
          <section className="tp-predict-form">
            <label htmlFor="tracepad-predict-expression">Prediction input</label>
            <input id="tracepad-predict-expression" value={predictionExpression} onChange={event => onPredictionExpression(event.target.value)} placeholder="Python or R expression, e.g. data.head()" />
            <button className="tp-primary" type="button" onClick={() => onInspect(object, "predict")} disabled={busy}>Run predict</button>
          </section>
        ) : null}
        {busy ? <p className="tp-inspecting">Running {tabLabel(active)}...</p> : null}
        {inspection && active !== "overview" ? <InspectionResult result={inspection} /> : null}
      </div>
    </section>
  );
}

function Overview({ object }: { object: TracepadObject }) {
  return (
    <>
      <div className="tp-metric-grid">
        <Metric label="Language" value={languageLabel(object.language)} />
        <Metric label="Type" value={object.kind} />
        <Metric label="Methods" value={String(object.capabilities.length)} />
        <Metric label="State" value={object.live ? "Live" : "Rerun needed"} />
      </div>
      {object.summary ? <pre className="tp-inspector-summary">{object.summary}</pre> : <p className="tp-empty-output">No summary was captured for this object.</p>}
      {object.preview ? <TablePreview preview={object.preview} /> : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="tp-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function InspectionResult({ result }: { result: InspectResult }) {
  return (
    <section className="tp-inspection-result">
      <h3>{result.title}</h3>
      {result.error ? <pre className="tp-error-box">{result.error}</pre> : <OutputList outputs={result.outputs} />}
    </section>
  );
}

function AliasForm({ object, onRename }: { object: TracepadObject; onRename: (object: TracepadObject, alias: string) => void }) {
  const [draft, setDraft] = useState(object.alias);
  useEffect(() => setDraft(object.alias), [object.alias, object.id]);
  return (
    <form className="tp-alias-form" onSubmit={event => { event.preventDefault(); void onRename(object, draft); }}>
      <span>@</span>
      <input aria-label="Result name" value={draft} onChange={event => setDraft(event.target.value)} />
      <button className="tp-subtle" type="submit">Name</button>
    </form>
  );
}

function OutputList({ outputs }: { outputs: TracepadOutput[] }) {
  return (
    <div className="tp-output-list">
      {outputs.map((output, index) => <OutputItem key={index} output={output} />)}
    </div>
  );
}

function OutputItem({ output }: { output: TracepadOutput }) {
  if (output.kind === "error") return <pre className="tp-error-box">{[output.text, ...(output.traceback ?? [])].filter(Boolean).join("\n")}</pre>;
  const data = output.data ?? {};
  const image = typeof data["image/png"] === "string" ? `data:image/png;base64,${data["image/png"]}` : null;
  const svg = typeof data["image/svg+xml"] === "string" ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data["image/svg+xml"] as string)}` : null;
  const plain = typeof data["text/plain"] === "string" ? data["text/plain"] : output.text;
  if (image || svg) return <img className="tp-output-image" src={image || svg || ""} alt="Notebook output" />;
  if (typeof data["application/json"] === "object") return <pre className="tp-output-log">{JSON.stringify(data["application/json"], null, 2)}</pre>;
  return plain ? <pre className="tp-output-log">{plain}</pre> : null;
}

function TablePreview({ preview }: { preview: NonNullable<TracepadObject["preview"]> }) {
  if (!preview.columns.length && !preview.rows.length) return null;
  return (
    <section className="tp-table-preview">
      <div className="tp-table-meta"><span>{preview.rowCount ?? preview.rows.length} rows</span>{preview.truncated ? <span>Preview</span> : null}</div>
      <div className="tp-table-scroll">
        <table>
          <thead><tr>{preview.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{preview.columns.map(column => <td key={column}>{formatValue(row[column])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function languageLabel(language: TracepadLanguage): string {
  return language === "r" ? "R" : language === "sql" ? "SQL" : language === "julia" ? "Julia" : "Python";
}

function statusLabel(status: TracepadTurn["status"]): string {
  return status === "ready" ? "Ready to run" : status === "generating" ? "Generating" : status === "running" ? "Running" : status === "failed" ? "Failed" : status === "succeeded" ? "Complete" : status === "stale" ? "Changed since run" : "Draft";
}

function tabLabel(tab: InspectCapability | "overview"): string {
  if (tab === "overview") return "Overview";
  if (tab === "coef") return "Coefficients";
  if (tab === "fitted") return "Fitted";
  return tab[0].toUpperCase() + tab.slice(1);
}

function providerLabel(provider?: TracepadProviderId | null): string {
  return provider === "openai" ? "OpenAI" : provider === "openrouter" ? "OpenRouter" : provider === "ollama" ? "Ollama" : "AI";
}

async function requestProviderStatus(): Promise<ProviderStatusResponse> {
  const url = `${PageConfig.getBaseUrl()}tracepad/providers`;
  const response = await ServerConnection.makeRequest(url, { method: "GET" }, ServerConnection.makeSettings());
  const data = await response.json() as ProviderStatusResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || `Provider discovery failed: ${response.status}`);
  return data;
}

async function requestProviderConfiguration(configuration: ProviderConfiguration): Promise<ProviderStatusResponse> {
  const url = `${PageConfig.getBaseUrl()}tracepad/providers`;
  const response = await ServerConnection.makeRequest(url, {
    method: "POST",
    body: JSON.stringify(configuration),
    headers: { "Content-Type": "application/json" }
  }, ServerConnection.makeSettings());
  const data = await response.json() as ProviderStatusResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || `Provider setup failed: ${response.status}`);
  return data;
}

async function requestGeneration(payload: Record<string, unknown>): Promise<GenerationResponse> {
  const url = `${PageConfig.getBaseUrl()}tracepad/generate`;
  const response = await ServerConnection.makeRequest(url, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" }
  }, ServerConnection.makeSettings());
  const data = await response.json() as GenerationResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || `Generation failed: ${response.status}`);
  return data;
}

function notebookVariableNames(panel: NotebookPanel): string[] {
  const source = (panel.content.model as any)?.cells?.toArray?.()
    ?.map((cell: any) => String(cell.sharedModel?.getSource?.() ?? cell.value?.text ?? ""))
    .join("\n") ?? "";
  const names = new Set<string>();
  for (const match of source.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) names.add(match[1]);
  return Array.from(names).slice(0, 60);
}
