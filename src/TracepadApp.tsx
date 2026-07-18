import { useCallback, useEffect, useMemo, useState } from "react";
import type { TracepadNotebookHost } from "./core/host";
import {
  buildLineageIndex,
  connectedLineageTurnIds,
  replaceReferenceAlias,
  resolveInputObjectIds
} from "./core/lineage";
import { newId, newTurn } from "./core/state";
import type { InspectCapability, InspectResult, ProviderConfiguration, ProviderStatusResponse, TracepadObject, TracepadState, TracepadTurn } from "./core/types";
import { Inspector } from "./ui/Inspector";
import { languageLabel } from "./ui/labels";
import { ProviderSetup } from "./ui/ProviderSetup";
import { TurnCard } from "./ui/TurnCard";

interface TracepadAppProps {
  host: TracepadNotebookHost;
  onOpenClassic?: () => void | Promise<void>;
}

export function TracepadApp({ host, onOpenClassic }: TracepadAppProps): JSX.Element {
  const [state, setState] = useState<TracepadState>(() => host.loadState());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [inspectionBusy, setInspectionBusy] = useState(false);
  const [predictionExpression, setPredictionExpression] = useState("");
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [lineageObjectId, setLineageObjectId] = useState<string | null>(null);

  const refreshProviders = useCallback(async () => {
    try {
      const status = await host.providerStatus();
      setProviderStatus(status);
      setProviderError(null);
      if (!status.ready) setProviderSetupOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderStatus({ ok: false, ready: false, providers: [], profiles: [], error: message });
      setProviderError(message);
      setProviderSetupOpen(true);
    }
  }, [host]);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  const configureProvider = useCallback(async (configuration: ProviderConfiguration) => {
    setProviderBusy(true);
    setProviderError(null);
    try {
      const status = await host.configureProvider(configuration);
      setProviderStatus(status);
      setProviderSetupOpen(false);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderBusy(false);
    }
  }, [host]);

  const updateState = useCallback((recipe: (current: TracepadState) => TracepadState) => {
    setState(current => {
      const next = recipe(current);
      host.persistState(next);
      return next;
    });
  }, [host]);

  useEffect(() => {
    const onMetadataChanged = () => {
      const restored = host.loadState();
      setState(current => current.turns.length === restored.turns.length ? current : restored);
    };
    return host.subscribeStateChanged(onMetadataChanged);
  }, [host]);

  const currentLanguage = host.language;
  const selectedObjectCandidate = selectedObjectId ? state.objects[selectedObjectId] : null;
  const selectedObject = selectedObjectCandidate?.materialized === false ? null : selectedObjectCandidate;
  const liveObjects = useMemo(
    () => Object.values(state.objects).filter(object => object.live).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.objects]
  );
  const materializedObjects = useMemo(
    () => Object.values(state.objects).filter(object => object.materialized !== false),
    [state.objects]
  );
  const lineage = useMemo(() => buildLineageIndex(state), [state]);
  const focusedLineageTurnIds = useMemo(
    () => lineageObjectId ? connectedLineageTurnIds(lineage, lineageObjectId) : new Set<string>(),
    [lineage, lineageObjectId]
  );
  const lineageObjectCandidate = lineageObjectId ? state.objects[lineageObjectId] : undefined;
  const lineageObject = lineageObjectCandidate?.materialized === false ? undefined : lineageObjectCandidate;
  const turnIndexById = useMemo(
    () => new Map(state.turns.map((turn, index) => [turn.id, index])),
    [state.turns]
  );
  const activeProfile = providerStatus?.profiles?.find(
    profile => profile.id === providerStatus.active_profile
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
    const inputObjectIds = resolveInputObjectIds(turn.prompt, materializedObjects, turn.parentObjectId);
    const referencedObjects = inputObjectIds
      .map(objectId => state.objects[objectId])
      .filter((object): object is TracepadObject => Boolean(object));
    const expectedResultName = turn.outputObjectId
      ? state.objects[turn.outputObjectId]?.alias
      : `result_${state.turns.findIndex(item => item.id === turn.id) + 1}`;
    updateTurn(turn.id, { status: "generating", error: undefined, generationNote: undefined, inputObjectIds });
    try {
      const prompt = repairError
        ? `${turn.prompt}\n\nCurrent code:\n${turn.code}\n\nExecution error to fix:\n${repairError}\n\nReturn corrected code only.`
        : turn.prompt;
      const payload = {
        prompt,
        language: turn.language,
        context: {
          notebook_code: host.notebookCode(turn.id),
          notebook_variables: host.variableNames(),
          expected_result_name: expectedResultName,
          references: referencedObjects.map(generationObjectContext),
          parent: turn.parentObjectId
            ? generationObjectContext(state.objects[turn.parentObjectId])
            : null
        }
      };
      const response = await host.generate(payload);
      updateTurn(turn.id, {
        code: response.code,
        language: response.language,
        status: "ready",
        error: undefined,
        inputObjectIds,
        generationNote: [response.provider, response.notes, response.warning].filter(Boolean).join(" · ")
      });
    } catch (error) {
      updateTurn(turn.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }, [host, materializedObjects, providerStatus?.ready, state.objects, state.turns, updateTurn]);

  const run = useCallback(async (turn: TracepadTurn) => {
    host.ensureTurn(turn);
    updateTurn(turn.id, { status: "running", error: undefined, outputs: [] });
    const execution = await host.executeTurn(turn);
    if (execution.error) {
      updateTurn(turn.id, { status: "failed", outputs: [], error: execution.error });
      return;
    }

    const objectId = turn.outputObjectId ?? newId("obj");
    const alias = state.objects[objectId]?.alias || `result_${state.turns.findIndex(item => item.id === turn.id) + 1}`;
    const object = await host.captureObject(turn, objectId, alias).catch(() => null);
    updateState(current => {
      const nextObject = object ? { ...object, materialized: true, live: true } : undefined;
      const nextTurn = {
        ...turn,
        status: "succeeded" as const,
        outputs: [],
        outputObjectId: nextObject?.id,
        error: undefined,
        updatedAt: new Date().toISOString()
      };
      const next = {
        ...current,
        turns: current.turns.map(item => item.id === turn.id ? nextTurn : item),
        objects: nextObject ? { ...current.objects, [nextObject.id]: nextObject } : current.objects
      };
      host.updateTurnObjectMetadata(nextTurn, nextObject);
      return next;
    });
  }, [host, state.objects, state.turns, updateState, updateTurn]);

  const runAll = useCallback(async () => {
    for (const turn of state.turns) {
      if (turn.code.trim()) await run(turn);
    }
  }, [run, state.turns]);

  const insertReference = useCallback((turnId: string, object: TracepadObject) => {
    updateState(current => ({
      ...current,
      turns: current.turns.map(turn => turn.id === turnId
        ? {
            ...turn,
            prompt: new RegExp(`@${object.alias}\\b`).test(turn.prompt)
              ? turn.prompt
              : `${turn.prompt}${turn.prompt && !turn.prompt.endsWith(" ") ? " " : ""}@${object.alias} `,
            inputObjectIds: [...new Set([...(turn.inputObjectIds ?? []), object.id])],
            updatedAt: new Date().toISOString()
          }
        : turn)
    }));
  }, [updateState]);

  const renameObject = useCallback(async (object: TracepadObject, alias: string) => {
    const clean = alias.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^\d+/, "").slice(0, 48);
    if (!clean) return;
    await host.bindObjectAlias(object, clean);
    const renamedObject = { ...object, alias: clean, displayName: clean };
    updateState(current => ({
      ...current,
      turns: current.turns.map(turn => ({
        ...turn,
        prompt: replaceReferenceAlias(turn.prompt, object.alias, clean)
      })),
      objects: { ...current.objects, [object.id]: renamedObject }
    }));
    const producer = state.turns.find(turn => turn.id === object.turnId);
    if (producer) host.updateTurnObjectMetadata(producer, renamedObject);
  }, [host, state.turns, updateState]);

  const navigateToTurn = useCallback((turnId: string) => {
    document.getElementById(`tracepad-turn-${turnId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const navigateToObject = useCallback((object: TracepadObject) => {
    navigateToTurn(object.turnId);
  }, [navigateToTurn]);

  const focusLineage = useCallback((object: TracepadObject) => {
    setLineageObjectId(current => current === object.id ? null : object.id);
    navigateToObject(object);
  }, [navigateToObject]);

  const inspect = useCallback(async (object: TracepadObject, capability: InspectCapability) => {
    setInspectionBusy(true);
    setInspection(null);
    try {
      const result = await host.inspect(object, capability, predictionExpression);
      setInspection(result);
    } finally {
      setInspectionBusy(false);
    }
  }, [host, predictionExpression]);

  return (
    <div className="tracepad-shell">
      <header className="tracepad-topbar">
        <div className="tracepad-brand">
          <div>
            <h1>Tracepad</h1>
            <p>{host.path || "Untitled notebook"}</p>
          </div>
        </div>
        <div className="tracepad-topbar-actions">
          {onOpenClassic ? <button className="tp-secondary" type="button" onClick={() => void onOpenClassic()}>Jupyter view</button> : null}
          <button className={providerStatus?.ready ? "tracepad-provider-pill ready" : "tracepad-provider-pill"} type="button" onClick={() => { setProviderSetupOpen(true); void refreshProviders(); }}>
            {providerStatus?.ready ? `${activeProfile?.label || providerStatus.active_provider || "AI"} · ${providerStatus.active_model}` : providerStatus ? "Set up AI" : "Checking AI"}
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
          {lineageObject ? (
            <div className="tp-lineage-focusbar" role="status">
              <div><span>Focused lineage</span><strong>@{lineageObject.alias}</strong><small>{focusedLineageTurnIds.size} connected cells</small></div>
              <button className="tp-subtle" type="button" onClick={() => setLineageObjectId(null)}>Show all cells</button>
            </div>
          ) : null}
          {state.turns.map((turn, index) => {
            const inputObjects = (lineage.inputsByTurnId[turn.id] ?? [])
              .map(objectId => state.objects[objectId])
              .filter((object): object is TracepadObject => Boolean(object));
            const outputObjectCandidate = turn.outputObjectId ? state.objects[turn.outputObjectId] : undefined;
            const outputObject = outputObjectCandidate?.materialized === false
              ? undefined
              : outputObjectCandidate;
            const consumers = outputObject
              ? (lineage.consumersByObjectId[outputObject.id] ?? []).map(turnId => {
                  const consumerTurn = state.turns.find(candidate => candidate.id === turnId);
                  const consumerObject = consumerTurn?.outputObjectId
                    ? state.objects[consumerTurn.outputObjectId]
                    : undefined;
                  const consumerIndex = turnIndexById.get(turnId) ?? 0;
                  return {
                    turnId,
                    object: consumerObject,
                    label: consumerObject ? `@${consumerObject.alias}` : `Cell ${consumerIndex + 1}`
                  };
                })
              : [];
            const lineageMode = !lineageObjectId
              ? "none" as const
              : outputObject?.id === lineageObjectId
                ? "focused" as const
                : focusedLineageTurnIds.has(turn.id) ? "related" as const : "muted" as const;
            const availableReferences = liveObjects.filter(object => (turnIndexById.get(object.turnId) ?? -1) < index);
            return (
            <TurnCard
              key={turn.id}
              index={index}
              turn={turn}
              host={host}
              objects={availableReferences}
              inputObjects={inputObjects}
              consumers={consumers}
              outputObject={outputObject}
              lineageMode={lineageMode}
              onPromptChange={prompt => updateTurn(turn.id, {
                prompt,
                inputObjectIds: resolveInputObjectIds(prompt, materializedObjects, turn.parentObjectId),
                status: turn.status === "succeeded" ? "stale" : turn.status
              })}
              onCodeChange={code => updateTurn(turn.id, { code, status: turn.status === "succeeded" ? "stale" : turn.status })}
              onGenerate={() => void generate(turn)}
              onRun={() => void run(turn)}
              onFix={() => void generate(turn, turn.error)}
              onInsertReference={object => insertReference(turn.id, object)}
              onInspect={object => setSelectedObjectId(object.id)}
              onAddChild={() => addTurn(turn.outputObjectId)}
              onRename={renameObject}
              onNavigateObject={navigateToObject}
              onNavigateTurn={navigateToTurn}
              onFocusLineage={focusLineage}
            />
          );})}
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

function generationObjectContext(object: TracepadObject | undefined): Record<string, unknown> | null {
  if (!object || object.materialized === false) return null;
  return {
    token: `@${object.alias}`,
    runtime_name: object.alias,
    type: object.kind,
    language: object.language,
    class_names: object.classNames,
    capabilities: object.capabilities,
    columns: object.preview?.columns ?? []
  };
}
