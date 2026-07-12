import { useEffect, useState } from "react";
import type { InspectCapability, InspectResult, TracepadLanguage, TracepadObject, TracepadOutput } from "../core/types";

export function Inspector({
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

export function AliasForm({
  object,
  onRename
}: {
  object: TracepadObject;
  onRename: (object: TracepadObject, alias: string) => void | Promise<void>;
}) {
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

function OutputList({ outputs }: { outputs: TracepadOutput[] }) {
  return <div className="tp-output-list">{outputs.map((output, index) => <OutputItem key={index} output={output} />)}</div>;
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

function tabLabel(tab: InspectCapability | "overview"): string {
  if (tab === "overview") return "Overview";
  if (tab === "coef") return "Coefficients";
  if (tab === "fitted") return "Fitted";
  return tab[0].toUpperCase() + tab.slice(1);
}
