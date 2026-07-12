import { useState } from "react";
import type { TracepadNotebookHost } from "../core/host";
import type { TracepadObject, TracepadTurn } from "../core/types";
import { AliasForm } from "./Inspector";
import { languageLabel, statusLabel } from "./labels";
import { NativeCellOutput, NativeCodeEditor } from "./NativeCell";

export interface TurnLineageConsumer {
  turnId: string;
  label: string;
  object?: TracepadObject;
}

export function TurnCard({
  index,
  turn,
  host,
  objects,
  inputObjects,
  consumers,
  outputObject,
  lineageMode,
  onPromptChange,
  onCodeChange,
  onGenerate,
  onRun,
  onFix,
  onInsertReference,
  onInspect,
  onAddChild,
  onRename,
  onNavigateObject,
  onNavigateTurn,
  onFocusLineage
}: {
  index: number;
  turn: TracepadTurn;
  host: TracepadNotebookHost;
  objects: TracepadObject[];
  inputObjects: TracepadObject[];
  consumers: TurnLineageConsumer[];
  outputObject?: TracepadObject;
  lineageMode: "none" | "focused" | "related" | "muted";
  onPromptChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onGenerate: () => void;
  onRun: () => void;
  onFix: () => void;
  onInsertReference: (object: TracepadObject) => void;
  onInspect: (object: TracepadObject) => void;
  onAddChild: () => void;
  onRename: (object: TracepadObject, alias: string) => void | Promise<void>;
  onNavigateObject: (object: TracepadObject) => void;
  onNavigateTurn: (turnId: string) => void;
  onFocusLineage: (object: TracepadObject) => void;
}) {
  const [codeOpen, setCodeOpen] = useState(Boolean(turn.code));
  const references = inputObjects.length ? inputObjects : objects.slice(-4).reverse();
  const referenceMode = inputObjects.length ? "uses" : "suggestions";
  const disabled = turn.status === "generating" || turn.status === "running";
  const hasOutput = host.hasOutput(turn);
  return (
    <article
      id={`tracepad-turn-${turn.id}`}
      className={`tp-turn tp-${turn.status} tp-lineage-${lineageMode}${inputObjects.length ? " tp-has-inputs" : ""}`}
    >
      <div className="tp-turn-index">{index + 1}</div>
      <section className="tp-prompt-card">
        {references.length ? (
          <div className={`tp-reference-strip tp-reference-${referenceMode}`}>
            <span>{referenceMode === "uses" ? "Uses" : "Add reference"}</span>
            {references.map(object => (
              <button
                key={object.id}
                type="button"
                title={referenceMode === "uses" ? `Go to the cell that created @${object.alias}` : `Insert @${object.alias}`}
                onClick={() => referenceMode === "uses" ? onNavigateObject(object) : onInsertReference(object)}
              >
                @{object.alias}<small>{object.live ? object.kind : "stale"}</small>
              </button>
            ))}
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
            {codeOpen ? <NativeCodeEditor host={host} turn={turn} onSourceChanged={onCodeChange} /> : null}
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
            <div className="tp-error-toolbar">
              <strong>Execution failed: {turn.error}</strong>
              <button className="tp-secondary" type="button" onClick={onFix}>Fix with AI</button>
            </div>
          ) : null}
          {!hasOutput && turn.status !== "running" && turn.status !== "failed" ? (
            <p className="tp-empty-output">Generate code, then run this cell to create an output object.</p>
          ) : null}
          <NativeCellOutput host={host} turn={turn} hidden={!hasOutput} />
        </div>
        {outputObject ? (
          <nav className="tp-lineage-row" aria-label={`Lineage for ${outputObject.alias}`}>
            <div className="tp-lineage-direction">
              <span>Inputs</span>
              <div>
                {inputObjects.length ? inputObjects.map(object => (
                  <button key={object.id} type="button" onClick={() => onNavigateObject(object)}>@{object.alias}</button>
                )) : <em>Root result</em>}
              </div>
            </div>
            <div className="tp-lineage-node" aria-hidden="true"><i /></div>
            <div className="tp-lineage-direction downstream">
              <span>Used by</span>
              <div>
                {consumers.length ? consumers.map(consumer => (
                  <button
                    key={consumer.turnId}
                    type="button"
                    onClick={() => consumer.object ? onNavigateObject(consumer.object) : onNavigateTurn(consumer.turnId)}
                  >
                    {consumer.label}
                  </button>
                )) : <em>Nothing yet</em>}
              </div>
            </div>
            <button className="tp-lineage-focus" type="button" onClick={() => onFocusLineage(outputObject)}>
              {lineageMode === "focused" ? "Clear focus" : "Focus lineage"}
            </button>
          </nav>
        ) : null}
        {outputObject ? <AliasForm object={outputObject} onRename={onRename} /> : null}
      </section>
    </article>
  );
}
