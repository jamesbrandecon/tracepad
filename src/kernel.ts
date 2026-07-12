import type { NotebookPanel } from "@jupyterlab/notebook";
import { KernelMessage } from "@jupyterlab/services";
import type { InspectCapability, InspectResult, TracepadLanguage, TracepadObject, TracepadOutput, TracepadTurn } from "./types";

const DESCRIPTOR_MARKER = "__TRACEPAD_DESCRIPTOR__";

export function detectLanguage(panel: NotebookPanel): TracepadLanguage {
  const preferred = String(panel.sessionContext.kernelPreference.language ?? "").toLowerCase();
  const kernelName = String(panel.sessionContext.session?.kernel?.name ?? "").toLowerCase();
  const merged = `${preferred} ${kernelName}`;
  if (merged.includes("r") && (merged.includes("ir") || preferred === "r")) return "r";
  if (merged.includes("julia")) return "julia";
  if (merged.includes("sql")) return "sql";
  return "python";
}

export async function captureObject(
  panel: NotebookPanel,
  turn: TracepadTurn,
  objectId: string,
  alias: string
): Promise<TracepadObject | null> {
  const handle = `__tracepad_${objectId.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const language = turn.language;
  const captureCode = language === "r"
    ? `assign("${handle}", if (exists(".Last.value", envir = .GlobalEnv)) get(".Last.value", envir = .GlobalEnv) else NULL, envir = .GlobalEnv)\nassign(${JSON.stringify(alias)}, get("${handle}", envir = .GlobalEnv), envir = .GlobalEnv)`
    : language === "python"
      ? `${handle} = globals().get("_", None)\nglobals()[${JSON.stringify(alias)}] = ${handle}`
      : "";
  if (!captureCode) return null;

  await requestExecution(panel, captureCode);
  const descriptorCode = language === "r" ? rDescriptorCode(handle) : pythonDescriptorCode(handle);
  const response = await requestExecution(panel, descriptorCode);
  const descriptor = findDescriptor(response.outputs);
  if (!descriptor) return null;

  return {
    id: objectId,
    handle,
    turnId: turn.id,
    alias,
    displayName: String(descriptor.display_name ?? alias),
    language,
    classNames: Array.isArray(descriptor.class_names) ? descriptor.class_names.map(String) : [],
    kind: normalizeKind(descriptor.kind),
    capabilities: normalizeCapabilities(descriptor.capabilities),
    preview: normalizePreview(descriptor.preview),
    summary: typeof descriptor.summary === "string" ? descriptor.summary : undefined,
    live: descriptor.live !== false,
    createdAt: new Date().toISOString()
  };
}

export async function bindObjectAlias(
  panel: NotebookPanel,
  object: TracepadObject,
  alias: string
): Promise<void> {
  const code = object.language === "r"
    ? `assign(${JSON.stringify(alias)}, get(${JSON.stringify(object.handle)}, envir = .GlobalEnv, inherits = FALSE), envir = .GlobalEnv)`
    : object.language === "python"
      ? `globals()[${JSON.stringify(alias)}] = globals().get(${JSON.stringify(object.handle)})`
      : "";
  if (code) await requestExecution(panel, code);
}

export async function runInspection(
  panel: NotebookPanel,
  object: TracepadObject,
  capability: InspectCapability,
  predictionExpression = ""
): Promise<InspectResult> {
  const code = object.language === "r"
    ? rInspectionCode(object.handle, capability, predictionExpression)
    : pythonInspectionCode(object.handle, capability, predictionExpression);
  if (!code) {
    return { title: capability, outputs: [], error: "This inspector action is not available for the active kernel language yet." };
  }
  const result = await requestExecution(panel, code);
  return { title: capabilityLabel(capability), outputs: result.outputs, error: result.error };
}

async function requestExecution(panel: NotebookPanel, code: string): Promise<{ outputs: TracepadOutput[]; error?: string }> {
  const kernel = panel.sessionContext.session?.kernel;
  if (!kernel) return { outputs: [], error: "No active kernel." };
  const outputs: TracepadOutput[] = [];
  const future = kernel.requestExecute({ code, stop_on_error: true, store_history: false });
  future.onIOPub = (message: KernelMessage.IIOPubMessage) => {
    const msgType = message.header.msg_type;
    const content = message.content as any;
    if (msgType === "stream") {
      const output: TracepadOutput = { kind: "stream", text: String(content.text ?? "") };
      outputs.push(output);
    } else if (msgType === "execute_result" || msgType === "display_data") {
      const output: TracepadOutput = { kind: msgType === "execute_result" ? "result" : "display", data: content.data ?? {} };
      outputs.push(output);
    } else if (msgType === "error") {
      const traceback = Array.isArray(content.traceback) ? content.traceback.map(String) : [];
      const output: TracepadOutput = { kind: "error", text: `${content.ename ?? "Error"}: ${content.evalue ?? ""}`, traceback };
      outputs.push(output);
    }
  };
  try {
    const reply = await future.done as any;
    if (reply?.content?.status === "error") {
      return { outputs, error: `${reply.content.ename ?? "ExecutionError"}: ${reply.content.evalue ?? ""}` };
    }
    const outputError = outputs.find(output => output.kind === "error");
    return { outputs, error: outputError?.text };
  } catch (error) {
    return { outputs, error: error instanceof Error ? error.message : String(error) };
  } finally {
    future.dispose();
  }
}

function pythonDescriptorCode(handle: string): string {
  return `import json\nobj = globals().get(${JSON.stringify(handle)})\ndesc = {\"live\": obj is not None, \"display_name\": type(obj).__name__ if obj is not None else \"No final value\", \"class_names\": [type(obj).__module__ + \".\" + type(obj).__name__] if obj is not None else [], \"kind\": \"value\", \"capabilities\": [], \"summary\": \"\"}\nif obj is None:\n    desc[\"summary\"] = \"Tracepad could not capture a final expression. End the cell with the object you want to inspect.\"\nelif hasattr(obj, \"columns\") and hasattr(obj, \"head\"):\n    desc.update({\"kind\": \"dataframe\", \"capabilities\": [\"preview\", \"summary\", \"plot\"], \"preview\": {\"columns\": [str(x) for x in list(obj.columns)], \"rows\": obj.head(12).to_dict(orient=\"records\"), \"rowCount\": int(len(obj)), \"truncated\": len(obj) > 12}, \"summary\": f\"{len(obj)} rows x {len(obj.columns)} columns\"})\nelse:\n    caps = []\n    if callable(getattr(obj, \"summary\", None)): caps.append(\"summary\")\n    if hasattr(obj, \"coef_\") or callable(getattr(obj, \"coef\", None)) or hasattr(obj, \"params\"): caps.append(\"coef\")\n    if hasattr(obj, \"fittedvalues\") or hasattr(obj, \"fitted_\"): caps.append(\"fitted\")\n    if callable(getattr(obj, \"predict\", None)): caps.append(\"predict\")\n    if callable(getattr(obj, \"plot\", None)): caps.append(\"plot\")\n    desc.update({\"kind\": \"model\" if caps else \"value\", \"capabilities\": caps, \"summary\": repr(obj)[:1200]})\nprint(${JSON.stringify(DESCRIPTOR_MARKER)} + json.dumps(desc, default=str))`;
}

function rDescriptorCode(handle: string): string {
  return `obj <- get(${JSON.stringify(handle)}, envir = .GlobalEnv, inherits = FALSE)\nif (is.null(obj)) { desc <- list(live = FALSE, display_name = \"No final value\", class_names = character(), kind = \"value\", capabilities = character(), summary = \"End the cell with the object you want to inspect.\") } else { caps <- character(); if (is.data.frame(obj)) caps <- c(\"preview\", \"summary\", \"plot\"); if (exists(\"coef\", mode = \"function\") && !inherits(try(coef(obj), silent = TRUE), \"try-error\")) caps <- unique(c(caps, \"coef\")); if (exists(\"fitted\", mode = \"function\") && !inherits(try(fitted(obj), silent = TRUE), \"try-error\")) caps <- unique(c(caps, \"fitted\")); if (exists(\"predict\", mode = \"function\") && !inherits(try(predict(obj), silent = TRUE), \"try-error\")) caps <- unique(c(caps, \"predict\")); desc <- list(live = TRUE, display_name = class(obj)[1], class_names = class(obj), kind = if (is.data.frame(obj)) \"dataframe\" else if (length(caps)) \"model\" else \"value\", capabilities = caps, summary = paste(utils::capture.output(str(obj, max.level = 1)), collapse = \"\\n\")); if (is.data.frame(obj)) desc$preview <- list(columns = names(obj), rows = utils::head(obj, 12), rowCount = nrow(obj), truncated = nrow(obj) > 12) }; if (requireNamespace(\"jsonlite\", quietly = TRUE)) cat(${JSON.stringify(DESCRIPTOR_MARKER)}, jsonlite::toJSON(desc, auto_unbox = TRUE, dataframe = \"rows\", null = \"null\"), sep = \"\") else cat(${JSON.stringify(DESCRIPTOR_MARKER)}, \"{\\\"live\\\":false,\\\"summary\\\":\\\"Install jsonlite for R object inspection.\\\"}\", sep = \"\")`;
}

function pythonInspectionCode(handle: string, capability: InspectCapability, predictionExpression: string): string {
  const ref = `globals().get(${JSON.stringify(handle)})`;
  if (capability === "preview") return `display(${ref}.head(100) if hasattr(${ref}, \"head\") else ${ref})`;
  if (capability === "summary") return `obj = ${ref}\nprint(obj.summary() if callable(getattr(obj, \"summary\", None)) else repr(obj))`;
  if (capability === "coef") return `obj = ${ref}\nprint(getattr(obj, \"coef_\", getattr(obj, \"params\", obj.coef() if callable(getattr(obj, \"coef\", None)) else \"No coefficients available\")))`;
  if (capability === "fitted") return `obj = ${ref}\nprint(getattr(obj, \"fittedvalues\", getattr(obj, \"fitted_\", \"No fitted values available\")))`;
  if (capability === "predict") {
    if (!predictionExpression.trim()) return "raise ValueError('Provide a Python expression for prediction input, such as data[[\"x1\", \"x2\"]].head()')";
    return `obj = ${ref}\nobj.predict(${predictionExpression})`;
  }
  if (capability === "plot") return `obj = ${ref}\nplot = obj.plot()\nplot.figure if hasattr(plot, \"figure\") else plot`;
  return "";
}

function rInspectionCode(handle: string, capability: InspectCapability, predictionExpression: string): string {
  const ref = `get(${JSON.stringify(handle)}, envir = .GlobalEnv, inherits = FALSE)`;
  if (capability === "preview") return `utils::head(${ref}, 100)`;
  if (capability === "summary") return `summary(${ref})`;
  if (capability === "coef") return `coef(${ref})`;
  if (capability === "fitted") return `fitted(${ref})`;
  if (capability === "predict") {
    if (!predictionExpression.trim()) return "stop('Provide an R expression for prediction input, such as head(data)')";
    return `predict(${ref}, newdata = ${predictionExpression})`;
  }
  if (capability === "plot") return `plot(${ref})`;
  return "";
}

function findDescriptor(outputs: TracepadOutput[]): Record<string, any> | null {
  for (const output of outputs) {
    const text = output.text ?? "";
    const markerIndex = text.indexOf(DESCRIPTOR_MARKER);
    if (markerIndex < 0) continue;
    try {
      return JSON.parse(text.slice(markerIndex + DESCRIPTOR_MARKER.length));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeKind(value: unknown): TracepadObject["kind"] {
  return value === "dataframe" || value === "model" || value === "plot" || value === "text" ? value : "value";
}

function normalizeCapabilities(value: unknown): InspectCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is InspectCapability => ["preview", "summary", "coef", "fitted", "predict", "plot"].includes(String(entry)));
}

function normalizePreview(value: unknown): TracepadObject["preview"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const columns = Array.isArray(raw.columns) ? raw.columns.map(String) : [];
  const rows = Array.isArray(raw.rows) ? raw.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
  return columns.length || rows.length ? {
    columns,
    rows,
    rowCount: typeof raw.rowCount === "number" ? raw.rowCount : undefined,
    truncated: raw.truncated === true
  } : undefined;
}

function capabilityLabel(capability: InspectCapability): string {
  return capability === "coef" ? "Coefficients" : capability === "fitted" ? "Fitted values" : capability[0].toUpperCase() + capability.slice(1);
}
