interface TracepadRendererContext {
  postMessage?(message: unknown): void;
  onDidReceiveMessage?(listener: (event: unknown) => void): { dispose(): void };
}

interface TracepadOutputItem {
  json(): unknown;
}

type ResultKind = "data" | "model" | "plot" | "value";

interface TracepadResultPayload {
  version: 1;
  kind: ResultKind;
  alias: string;
  runtimeName: string;
  turnId: string;
  turnNumber: string;
  typeName?: string;
  module?: string;
  shape?: [number, number];
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  truncated?: boolean;
  summary?: string;
  coefficients?: Array<{ term: string; estimate: unknown }>;
  capabilities?: string[];
  imageDataUrl?: string;
}

export function activate(context: TracepadRendererContext) {
  installStyles();
  context.onDidReceiveMessage?.(event => {
    const message = messageRecord(event);
    if (message.type !== "aliasUpdated" || typeof message.turnId !== "string" || typeof message.alias !== "string") return;
    const turnId = message.turnId;
    const previousAlias = typeof message.previousAlias === "string" ? message.previousAlias : "";
    const aliasValue = message.alias;
    document.querySelectorAll("[data-tracepad-turn-id]").forEach(candidate => {
      const element = candidate as HTMLElement;
      if (element.dataset.tracepadTurnId !== turnId && element.dataset.alias !== previousAlias) return;
      element.dataset.alias = aliasValue;
      const alias = element.querySelector("[data-tracepad-alias]") as HTMLElement | null;
      if (alias) alias.textContent = `@${aliasValue}`;
    });
  });

  return {
    renderOutputItem(outputItem: TracepadOutputItem, element: HTMLElement): void {
      const payload = parsePayload(outputItem.json());
      element.replaceChildren();
      element.classList.add("tracepad-output-host");
      element.dataset.alias = payload.alias;
      element.dataset.tracepadTurnId = payload.turnId;
      renderResult(context, payload, element);
      context.postMessage?.({ type: "ready", turnId: payload.turnId });
    },
    disposeOutputItem(_id: string): void {}
  };
}

function renderResult(
  context: TracepadRendererContext,
  payload: TracepadResultPayload,
  host: HTMLElement
): void {
  const surface = node("section", "tracepad-result");
  surface.dataset.kind = payload.kind;
  const header = node("header", "tracepad-result__header");
  const identity = node("div", "tracepad-result__identity");
  const alias = node("strong", "tracepad-result__alias", `@${payload.alias}`);
  alias.dataset.tracepadAlias = "true";
  identity.append(alias, node("span", "tracepad-result__kind", resultLabel(payload)));
  const actions = node("div", "tracepad-result__actions");
  actions.append(
    actionButton("Rename", "Rename this result", () => {
      context.postMessage?.({ type: "rename", turnId: payload.turnId });
    }),
    actionButton("Explore", "Ask a follow-up using this result", () => {
      context.postMessage?.({ type: "explore", turnId: payload.turnId });
    })
  );
  header.append(identity, actions);
  surface.append(header);

  if (payload.kind === "data") renderData(payload, surface);
  else if (payload.kind === "model") renderModel(payload, surface);
  else if (payload.kind === "plot") renderPlot(payload, surface);
  else renderValue(payload, surface);
  host.append(surface);
}

function renderData(payload: TracepadResultPayload, surface: HTMLElement): void {
  const columns = payload.columns ?? [];
  const rows = payload.rows ?? [];
  const tableWrap = node("div", "tracepad-table-wrap");
  const table = node("table", "tracepad-table");
  const head = node("thead");
  const headRow = node("tr");
  for (const column of columns) headRow.append(node("th", undefined, column));
  head.append(headRow);
  const body = node("tbody");
  const initialRows = 12;
  const drawRows = (limit: number) => {
    body.replaceChildren();
    for (const row of rows.slice(0, limit)) {
      const rowElement = node("tr");
      for (const column of columns) rowElement.append(node("td", undefined, displayValue(row[column])));
      body.append(rowElement);
    }
  };
  drawRows(initialRows);
  table.append(head, body);
  tableWrap.append(table);
  surface.append(tableWrap);

  const footer = node("footer", "tracepad-result__footer");
  const [rowCount = rows.length, columnCount = columns.length] = payload.shape ?? [];
  footer.append(node(
    "span",
    undefined,
    `${numberFormat(rowCount)} rows x ${numberFormat(columnCount)} columns${payload.truncated ? ` · previewing ${rows.length}` : ""}`
  ));
  if (rows.length > initialRows) {
    let expanded = false;
    const toggle = actionButton(`Show ${rows.length} rows`, "Expand or collapse this preview", () => {
      expanded = !expanded;
      drawRows(expanded ? rows.length : initialRows);
      toggle.textContent = expanded ? "Show fewer" : `Show ${rows.length} rows`;
    });
    toggle.classList.add("tracepad-link-button");
    footer.append(toggle);
  }
  surface.append(footer);
}

function renderModel(payload: TracepadResultPayload, surface: HTMLElement): void {
  const capabilities = payload.capabilities ?? [];
  if (capabilities.length) {
    const bar = node("div", "tracepad-capabilities");
    bar.append(node("span", "tracepad-capabilities__label", "Available"));
    for (const capability of capabilities) bar.append(node("code", undefined, `${capability}()`));
    surface.append(bar);
  }
  if (payload.coefficients?.length) {
    const section = node("section", "tracepad-model-section");
    section.append(node("h4", undefined, "Coefficients"));
    const table = node("table", "tracepad-table tracepad-coefficient-table");
    const head = node("thead");
    const row = node("tr");
    row.append(node("th", undefined, "Term"), node("th", undefined, "Estimate"));
    head.append(row);
    const body = node("tbody");
    for (const coefficient of payload.coefficients) {
      const coefficientRow = node("tr");
      coefficientRow.append(
        node("td", undefined, coefficient.term),
        node("td", "tracepad-number", displayValue(coefficient.estimate))
      );
      body.append(coefficientRow);
    }
    table.append(head, body);
    section.append(table);
    surface.append(section);
  }
  if (payload.summary) {
    const details = document.createElement("details");
    details.className = "tracepad-summary";
    const summary = document.createElement("summary");
    summary.textContent = "Model summary";
    details.append(summary, node("pre", undefined, payload.summary));
    surface.append(details);
  }
  surface.append(modelFooter(payload));
}

function renderPlot(payload: TracepadResultPayload, surface: HTMLElement): void {
  if (payload.imageDataUrl) {
    const figure = node("figure", "tracepad-figure");
    const image = document.createElement("img");
    image.src = payload.imageDataUrl;
    image.alt = `Plot result @${payload.alias}`;
    figure.append(image);
    surface.append(figure);
  } else {
    surface.append(node("p", "tracepad-empty", "The plot object did not include a rendered preview."));
  }
  surface.append(modelFooter(payload));
}

function renderValue(payload: TracepadResultPayload, surface: HTMLElement): void {
  surface.append(node("pre", "tracepad-value", payload.summary ?? `${payload.module ?? ""}.${payload.typeName ?? "value"}`));
  surface.append(modelFooter(payload));
}

function modelFooter(payload: TracepadResultPayload): HTMLElement {
  const footer = node("footer", "tracepad-result__footer");
  footer.append(node("span", undefined, [payload.module, payload.typeName].filter(Boolean).join(" · ") || `turn ${payload.turnNumber}`));
  return footer;
}

function resultLabel(payload: TracepadResultPayload): string {
  if (payload.kind === "data") return "Data result";
  if (payload.kind === "model") return "Model result";
  if (payload.kind === "plot") return "Plot result";
  return payload.typeName || "Result";
}

function actionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tracepad-action";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function numberFormat(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : String(value);
}

function parsePayload(value: unknown): TracepadResultPayload {
  if (!value || typeof value !== "object") throw new Error("Tracepad result output is not a JSON object.");
  const payload = value as TracepadResultPayload;
  if (payload.version !== 1 || !payload.alias) {
    throw new Error("Tracepad result output uses an unsupported schema.");
  }
  payload.turnId ||= payload.alias;
  return payload;
}

function messageRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function installStyles(): void {
  if (document.getElementById("tracepad-result-styles")) return;
  const style = document.createElement("style");
  style.id = "tracepad-result-styles";
  style.textContent = `
    .tracepad-output-host { color: var(--vscode-foreground); font-family: var(--vscode-font-family); letter-spacing: 0; }
    .tracepad-result { overflow: hidden; border: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); border-radius: 6px; background: var(--vscode-notebook-cellEditorBackground, var(--vscode-editor-background)); }
    .tracepad-result__header { min-height: 38px; padding: 6px 10px 6px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); }
    .tracepad-result__identity { min-width: 0; display: flex; align-items: baseline; gap: 9px; }
    .tracepad-result__alias { overflow: hidden; color: var(--vscode-textLink-foreground); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .tracepad-result__kind, .tracepad-result__footer { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .tracepad-result__actions { display: flex; gap: 4px; flex: 0 0 auto; }
    .tracepad-action { min-height: 26px; padding: 3px 9px; color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; background: var(--vscode-button-secondaryBackground); font: inherit; font-size: 12px; cursor: pointer; }
    .tracepad-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .tracepad-action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .tracepad-table-wrap { max-width: 100%; overflow: auto; }
    .tracepad-table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
    .tracepad-table th, .tracepad-table td { max-width: 360px; padding: 6px 10px; overflow: hidden; border-bottom: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); text-align: left; text-overflow: ellipsis; white-space: nowrap; }
    .tracepad-table th { position: sticky; top: 0; z-index: 1; color: var(--vscode-descriptionForeground); background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); font-weight: 600; }
    .tracepad-table tbody tr:last-child td { border-bottom: 0; }
    .tracepad-table tbody tr:hover td { background: var(--vscode-list-hoverBackground); }
    .tracepad-result__footer { min-height: 31px; padding: 5px 10px 5px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); }
    .tracepad-link-button { padding: 2px 4px; color: var(--vscode-textLink-foreground); border: 0; background: transparent; }
    .tracepad-link-button:hover { color: var(--vscode-textLink-activeForeground); background: transparent; text-decoration: underline; }
    .tracepad-capabilities { padding: 9px 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); }
    .tracepad-capabilities__label { margin-right: 2px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .tracepad-capabilities code { padding: 2px 5px; border-radius: 3px; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); font-size: 11px; }
    .tracepad-model-section { padding: 10px 12px 12px; }
    .tracepad-model-section h4 { margin: 0 0 7px; font-size: 12px; font-weight: 600; }
    .tracepad-model-section .tracepad-table { border: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); border-radius: 4px; }
    .tracepad-number { font-family: var(--vscode-editor-font-family); }
    .tracepad-summary { border-top: 1px solid var(--vscode-notebook-cellBorderColor, var(--vscode-widget-border)); }
    .tracepad-summary summary { padding: 8px 12px; color: var(--vscode-textLink-foreground); font-size: 12px; cursor: pointer; }
    .tracepad-summary pre, .tracepad-value { max-height: 360px; margin: 0; padding: 12px; overflow: auto; background: var(--vscode-textCodeBlock-background); font: 12px/1.5 var(--vscode-editor-font-family); white-space: pre; }
    .tracepad-figure { margin: 0; padding: 12px; overflow: auto; text-align: center; background: var(--vscode-editor-background); }
    .tracepad-figure img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
    .tracepad-empty { margin: 0; padding: 16px 12px; color: var(--vscode-descriptionForeground); }
    @media (max-width: 520px) {
      .tracepad-result__header { align-items: flex-start; }
      .tracepad-result__kind { display: none; }
      .tracepad-table th, .tracepad-table td { padding-inline: 7px; }
    }
  `;
  document.head.append(style);
}
