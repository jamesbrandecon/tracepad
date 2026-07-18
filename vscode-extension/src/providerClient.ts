import type { ProfileDefinition, ProviderDefinition, ProviderRegistry } from "./providerConfig";

export interface GenerationReference {
  token: string;
  alias: string;
  runtimeName: string;
  turnNumber: string;
  source?: string;
}

export interface NotebookCodeCell {
  cellNumber: number;
  language: string;
  source: string;
  executionOrder?: number;
  tracepadResult?: {
    alias: string;
    runtimeName: string;
  };
}

export interface GenerationContext {
  references: GenerationReference[];
  notebookCode: NotebookCodeCell[];
}

export interface GenerationResult {
  code: string;
  notes: string;
  profile: string;
  provider: string;
  model: string;
}

export async function generateCode(
  registry: ProviderRegistry,
  prompt: string,
  language: string,
  runtimeName: string,
  context: GenerationContext,
  signal?: AbortSignal
): Promise<GenerationResult> {
  const profile = registry.profiles[registry.activeProfile];
  if (!profile) throw new Error("Select a Tracepad model profile before generating code.");
  const provider = registry.providers[profile.provider];
  let model = profile.model;
  if (!model && provider.driver === "ollama-chat") {
    model = (await discoverOllamaModels(provider))[0] ?? "";
  }
  if (!model) throw new Error(`Model profile ${profile.label} requires a model name.`);
  const apiKey = provider.apiKeyEnv ? registry.environment[provider.apiKeyEnv] ?? "" : "";
  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`${provider.label} requires ${provider.apiKeyEnv || "an API key"} in the extension host environment.`);
  }

  const instructions = systemInstructions(language, runtimeName);
  const safePrompt = redactSensitiveText(prompt);
  const safeContext = sanitizeGenerationContext(context);
  const input = [
    `User request: ${safePrompt}`,
    `Notebook code (source only; cell outputs are excluded): ${JSON.stringify(safeContext.notebookCode)}`,
    `Available Tracepad references: ${JSON.stringify(safeContext.references)}`
  ].join("\n");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...provider.headers
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let raw = "";
  if (provider.driver === "openai-responses") {
    const payload = applyParameters(
      { model, store: false, instructions, input },
      profile.parameters,
      new Set(["model", "store", "instructions", "input"])
    );
    const response = await fetchJson(endpoint(provider, "responses"), payload, headers, signal);
    raw = extractResponsesText(response);
  } else if (provider.driver === "openai-chat") {
    const payload = applyParameters({
      model,
      store: false,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ]
    }, profile.parameters, new Set(["model", "store", "messages"]));
    const response = await fetchJson(endpoint(provider, "chat/completions"), payload, headers, signal);
    raw = String((response.choices as any[])?.[0]?.message?.content ?? "");
  } else {
    const response = await fetchJson(endpoint(provider, "api/chat"), {
      model,
      stream: false,
      format: generationJsonSchema(),
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      options: profile.parameters
    }, headers, signal);
    raw = String((response.message as any)?.content ?? "");
  }

  const parsed = parseGeneration(raw, profile);
  const boundCode = bindGeneratedResult(parsed.code, language, runtimeName);
  if (!capturesRuntimeResult(boundCode, runtimeName)) {
    throw new Error(`${profile.label} did not bind the result to ${runtimeName}. Generate again or edit the code before running.`);
  }
  return {
    ...parsed,
    code: prependReferenceBindings(boundCode, language, context.references),
    notes: boundCode === parsed.code
      ? parsed.notes
      : `${parsed.notes} Tracepad added the reusable result binding.`,
    profile: profile.id,
    provider: provider.id,
    model
  };
}

export function systemInstructions(language: string, runtimeName: string): string {
  const resultContract = language === "sql"
    ? `Create or replace a temporary view named ${runtimeName} for the primary result, then SELECT from that view as the final statement.`
    : `Assign the primary inspectable result to the exact runtime variable ${runtimeName}, then leave ${runtimeName} as the final expression.`;
  return [
    "Generate concise executable notebook code.",
    "Return JSON only with string keys code and notes. The code value must be one string containing the entire program, never an array. Do not use markdown fences.",
    `Use the ${language} kernel language.`,
    "Available references include a user-facing alias and a stable runtimeName.",
    "Use the readable alias in executable code; Tracepad binds it to runtimeName without copying the object.",
    "Bind the actual reusable result object, not a dictionary or list containing previews, shapes, columns, dtypes, summaries, or diagnostics.",
    "For tabular requests, bind the full data frame or lazy table; Tracepad renders its own bounded preview and metadata.",
    "The notebook context contains source code only; do not invent output values that were not supplied.",
    `The response is invalid unless the code literally creates ${runtimeName} according to the next instruction.`,
    resultContract,
    "Tracepad handles display, result registration, and lineage tracking after execution.",
    "Do not generate code that embeds, prints, or requests secrets; use environment variables or established credential providers."
  ].join(" ");
}

export function redactSensitiveText(value: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/gi, "[REDACTED]"],
    [/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]"],
    [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]"],
    [/(https?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1[REDACTED]@"],
    [/(\b(?:authorization|api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\b\s*(?:=|:)\s*)(["'])([^"'\n]+)\2/gi, "$1$2[REDACTED]$2"],
    [/(\b(?:authorization|api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\b\s*(?:=|:)\s*)(?!["'])([^\s,;]+)/gi, "$1[REDACTED]"]
  ];
  return patterns.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}

function sanitizeGenerationContext(context: GenerationContext): GenerationContext {
  return {
    references: context.references.map(reference => ({
      ...reference,
      ...(reference.source === undefined ? {} : { source: redactSensitiveText(reference.source) })
    })),
    notebookCode: context.notebookCode.map(cell => ({
      ...cell,
      source: redactSensitiveText(cell.source)
    }))
  };
}

function generationJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      code: { type: "string" },
      notes: { type: "string" }
    },
    required: ["code"],
    additionalProperties: false
  };
}

export function prependReferenceBindings(
  code: string,
  language: string,
  references: GenerationReference[]
): string {
  const cleanCode = stripReferenceBindings(code);
  const unique = [...new Map(
    references
      .filter(reference => reference.alias && reference.runtimeName)
      .map(reference => [reference.alias, reference])
  ).values()];
  if (!unique.length) return cleanCode;

  const normalized = language.toLowerCase();
  const marker = "Tracepad references: friendly names point to the same objects; no data is copied";
  if (normalized === "sql") {
    return [
      `-- ${marker}`,
      ...unique.map(reference => `-- @${reference.alias} -> ${reference.runtimeName}`),
      "",
      cleanCode
    ].join("\n");
  }
  const assignment = normalized === "r" ? "<-" : "=";
  return [
    `# ${marker}`,
    ...unique.map(reference => `${reference.alias} ${assignment} ${reference.runtimeName}  # @${reference.alias}`),
    "",
    cleanCode
  ].join("\n");
}

function stripReferenceBindings(code: string): string {
  const lines = code.trim().split("\n");
  if (!lines[0]?.includes("Tracepad references: friendly names point to the same objects")) {
    return code.trim();
  }
  const separator = lines.findIndex((line, index) => index > 0 && !line.trim());
  return (separator >= 0 ? lines.slice(separator + 1) : []).join("\n").trim();
}

export function capturesRuntimeResult(code: string, runtimeName: string): boolean {
  const escaped = runtimeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(code);
}

export function bindGeneratedResult(code: string, language: string, runtimeName: string): string {
  const clean = code.trim();
  if (!clean || capturesRuntimeResult(clean, runtimeName) || language.toLowerCase() === "sql") return clean;
  const lines = clean.split("\n");
  const assignment = language.toLowerCase() === "r" ? "<-" : "=";
  const assignmentPattern = language.toLowerCase() === "r"
    ? /^([A-Za-z_][A-Za-z0-9_.]*)\s*(?:<-|=(?!=))/
    : /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/;
  const assignedName = [...lines].reverse()
    .map(line => line.match(assignmentPattern)?.[1] ?? "")
    .find(Boolean);
  const lastLine = lines.at(-1)?.trim() ?? "";
  const simpleExpression = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(lastLine)
    || /^\[[\s\S]*\]$/.test(lastLine)
    || /^\{[\s\S]*\}$/.test(lastLine)
    || /^\([\s\S]*\)$/.test(lastLine)
    ? lastLine
    : "";
  const resultExpression = simpleExpression || assignedName;
  if (!resultExpression) return clean;
  return [
    clean,
    "",
    "# Tracepad result binding",
    `${runtimeName} ${assignment} ${resultExpression}`,
    runtimeName
  ].join("\n");
}

export async function discoverOllamaModels(
  provider: ProviderDefinition,
  signal?: AbortSignal
): Promise<string[]> {
  const response = await fetch(provider.baseUrl + "/api/tags", {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
      : AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`Ollama model discovery returned HTTP ${response.status}.`);
  const payload = await response.json() as any;
  const models = [...new Set(
    (payload.models ?? [])
      .map((item: any) => String(item?.name ?? "").trim())
      .filter(Boolean)
  )] as string[];
  if (!models.length) throw new Error("Ollama is reachable but has no installed models.");
  return models;
}

async function fetchJson(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000)
    });
  } catch (error) {
    throw new Error(`Could not reach model provider: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`Model provider returned HTTP ${response.status}: ${text.slice(0, 800)}`);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Model provider returned invalid JSON.");
  }
}

function endpoint(provider: ProviderDefinition, suffix: string): string {
  if (provider.endpoint) return `${provider.baseUrl}/${provider.endpoint.replace(/^\//, "")}`;
  return `${provider.baseUrl}/${suffix.replace(/^\//, "")}`;
}

function applyParameters(
  base: Record<string, unknown>,
  parameters: Record<string, unknown>,
  protectedKeys: Set<string>
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(parameters)) {
    if (protectedKeys.has(key)) continue;
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
}

function extractResponsesText(response: Record<string, any>): string {
  const pieces: string[] = [];
  for (const item of response.output ?? []) {
    for (const part of item?.content ?? []) {
      const text = part?.text ?? part?.output_text;
      if (typeof text === "string") pieces.push(text);
    }
  }
  return pieces.join("\n");
}

function parseGeneration(raw: string, profile: ProfileDefinition): { code: string; notes: string } {
  const clean = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let value: any;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new Error(`${profile.label} returned code outside the expected JSON contract.`);
  }
  const code = String(value?.code ?? "").trim();
  if (!code) throw new Error(`${profile.label} returned empty code.`);
  return { code, notes: String(value?.notes ?? "Generated by AI.") };
}
