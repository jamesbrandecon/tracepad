import type { ProfileDefinition, ProviderDefinition, ProviderRegistry } from "./providerConfig";

export interface GenerationReference {
  token: string;
  runtimeName: string;
  turnNumber: string;
  source?: string;
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
  references: GenerationReference[],
  signal?: AbortSignal
): Promise<GenerationResult> {
  const profile = registry.profiles[registry.activeProfile];
  if (!profile) throw new Error("Select a Tracepad model profile before generating code.");
  const provider = registry.providers[profile.provider];
  let model = profile.model;
  if (!model && provider.driver === "ollama-chat") {
    model = await discoverOllamaModel(provider);
  }
  if (!model) throw new Error(`Model profile ${profile.label} requires a model name.`);
  const apiKey = provider.apiKeyEnv ? registry.environment[provider.apiKeyEnv] ?? "" : "";
  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`${provider.label} requires ${provider.apiKeyEnv || "an API key"} in the extension host environment.`);
  }

  const instructions = systemInstructions(language, runtimeName);
  const input = [
    `User request: ${prompt}`,
    `Available references: ${JSON.stringify(references)}`
  ].join("\n");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...provider.headers
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let raw = "";
  if (provider.driver === "openai-responses") {
    const payload = applyParameters({ model, instructions, input }, profile.parameters, new Set(["model", "instructions", "input"]));
    const response = await fetchJson(endpoint(provider, "responses"), payload, headers, signal);
    raw = extractResponsesText(response);
  } else if (provider.driver === "openai-chat") {
    const payload = applyParameters({
      model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ]
    }, profile.parameters, new Set(["model", "messages"]));
    const response = await fetchJson(endpoint(provider, "chat/completions"), payload, headers, signal);
    raw = String((response.choices as any[])?.[0]?.message?.content ?? "");
  } else {
    const response = await fetchJson(endpoint(provider, "api/chat"), {
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      options: profile.parameters
    }, headers, signal);
    raw = String((response.message as any)?.content ?? "");
  }

  const parsed = parseGeneration(raw, profile);
  if (!capturesRuntimeResult(parsed.code, runtimeName)) {
    throw new Error(`${profile.label} did not bind the result to ${runtimeName}. Generate again or edit the code before running.`);
  }
  return {
    ...parsed,
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
    "Return JSON only with string keys code and notes. Do not use markdown fences.",
    `Use the ${language} kernel language.`,
    "Use supplied reference runtime names instead of @ tokens in executable code.",
    "Bind the actual reusable result object, not a dictionary or list containing previews, shapes, columns, dtypes, summaries, or diagnostics.",
    "For tabular requests, bind the full data frame or lazy table; Tracepad renders its own bounded preview and metadata.",
    resultContract,
    "Never include credentials."
  ].join(" ");
}

export function capturesRuntimeResult(code: string, runtimeName: string): boolean {
  const escaped = runtimeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(code);
}

async function discoverOllamaModel(provider: ProviderDefinition): Promise<string> {
  const response = await fetch(provider.baseUrl + "/api/tags", { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Ollama model discovery returned HTTP ${response.status}.`);
  const payload = await response.json() as any;
  const model = payload.models?.find((item: any) => item?.name)?.name;
  if (!model) throw new Error("Ollama is reachable but has no installed models.");
  return String(model);
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
