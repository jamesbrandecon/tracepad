import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";

export type ProviderDriver = "ollama-chat" | "openai-responses" | "openai-chat";

export interface ProviderDefinition {
  id: string;
  label: string;
  driver: ProviderDriver;
  baseUrl: string;
  apiKeyEnv: string;
  requiresApiKey: boolean;
  headers: Record<string, string>;
  endpoint?: string;
}

export interface ProfileDefinition {
  id: string;
  label: string;
  provider: string;
  model: string;
  parameters: Record<string, unknown>;
}

export interface ProviderRegistry {
  providers: Record<string, ProviderDefinition>;
  profiles: Record<string, ProfileDefinition>;
  activeProfile: string;
  loadedFiles: string[];
  environment: NodeJS.ProcessEnv;
}

export interface RegistryOptions {
  workspaceRoot?: string;
  explicitPath?: string;
  profileOverride?: string;
  environment?: NodeJS.ProcessEnv;
  userConfigRoot?: string;
}

const DEFAULT_CONFIGURATION: Record<string, unknown> = {
  version: 1,
  default_profile: "openai",
  providers: {
    ollama: {
      label: "Ollama",
      driver: "ollama-chat",
      base_url: "http://127.0.0.1:11434",
      base_url_env: "OLLAMA_HOST",
      requires_api_key: false
    },
    openai: {
      label: "OpenAI",
      driver: "openai-responses",
      base_url: "https://api.openai.com/v1",
      api_key_env: "OPENAI_API_KEY",
      requires_api_key: true
    },
    openrouter: {
      label: "OpenRouter",
      driver: "openai-chat",
      base_url: "https://openrouter.ai/api/v1",
      api_key_env: "OPENROUTER_API_KEY",
      requires_api_key: true,
      headers: {
        "HTTP-Referer": "https://github.com/tracepad/tracepad",
        "X-Title": "Tracepad"
      }
    }
  },
  profiles: {
    ollama: {
      label: "Ollama local",
      provider: "ollama",
      model: "",
      model_env: "TRACEPAD_OLLAMA_MODEL",
      parameters: { temperature: 0.1 }
    },
    openai: {
      label: "OpenAI",
      provider: "openai",
      model: "gpt-5.4-mini",
      model_env: "TRACEPAD_OPENAI_MODEL",
      parameters: { max_output_tokens: 1800 }
    },
    openrouter: {
      label: "OpenRouter",
      provider: "openrouter",
      model: "",
      model_env: "TRACEPAD_OPENROUTER_MODEL",
      parameters: {
        temperature: 0.1,
        max_tokens: 1800,
        response_format: { type: "json_object" }
      }
    }
  }
};

export function loadProviderRegistry(options: RegistryOptions = {}): ProviderRegistry {
  const environment = options.environment ?? process.env;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const userRoot = options.userConfigRoot
    ?? environment.XDG_CONFIG_HOME
    ?? join(homedir(), ".config");
  const explicit = options.explicitPath || environment.TRACEPAD_CONFIG || "";
  const explicitPath = explicit
    ? (isAbsolute(explicit) ? explicit : resolve(workspaceRoot, explicit))
    : "";
  const candidates = [
    join(userRoot, "tracepad", "config.yaml"),
    join(workspaceRoot, "tracepad.yaml"),
    explicitPath
  ].filter(Boolean);

  let configuration = structuredClone(DEFAULT_CONFIGURATION);
  const loadedFiles: string[] = [];
  for (const filename of [...new Set(candidates.map(value => resolve(value)))]) {
    if (!existsSync(filename)) {
      if (explicitPath && filename === resolve(explicitPath)) {
        throw new Error(`Tracepad config does not exist: ${filename}`);
      }
      continue;
    }
    const value = parse(readFileSync(filename, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Tracepad config must contain a YAML mapping: ${filename}`);
    }
    configuration = deepMerge(configuration, value as Record<string, unknown>);
    loadedFiles.push(filename);
  }

  const rawProviders = mapping(configuration.providers, "providers");
  const providers: Record<string, ProviderDefinition> = {};
  for (const [id, rawValue] of Object.entries(rawProviders)) {
    const raw = mapping(rawValue, `provider ${id}`);
    if (raw.enabled === false) continue;
    const driver = String(raw.driver ?? "") as ProviderDriver;
    if (!["ollama-chat", "openai-responses", "openai-chat"].includes(driver)) {
      throw new Error(`Provider ${id} uses unsupported driver ${driver || "(empty)"}.`);
    }
    const baseUrlEnvironment = String(raw.base_url_env ?? "");
    const configuredBaseUrl = baseUrlEnvironment ? environment[baseUrlEnvironment] : "";
    providers[id] = {
      id,
      label: String(raw.label || id),
      driver,
      baseUrl: cleanBaseUrl(configuredBaseUrl || String(raw.base_url || "")),
      apiKeyEnv: String(raw.api_key_env ?? ""),
      requiresApiKey: Boolean(raw.requires_api_key ?? raw.api_key_env),
      headers: stringMapping(raw.headers),
      endpoint: raw.endpoint ? String(raw.endpoint) : undefined
    };
  }

  const rawProfiles = mapping(configuration.profiles, "profiles");
  const profiles: Record<string, ProfileDefinition> = {};
  for (const [id, rawValue] of Object.entries(rawProfiles)) {
    const raw = mapping(rawValue, `profile ${id}`);
    if (raw.enabled === false) continue;
    const provider = String(raw.provider ?? "");
    if (!providers[provider]) throw new Error(`Profile ${id} references unknown provider ${provider}.`);
    const modelEnvironment = String(raw.model_env ?? "");
    profiles[id] = {
      id,
      label: String(raw.label || id),
      provider,
      model: String((modelEnvironment && environment[modelEnvironment]) || raw.model || ""),
      parameters: mapping(raw.parameters ?? {}, `profile ${id} parameters`)
    };
  }

  let activeProfile = options.profileOverride
    || environment.TRACEPAD_PROFILE
    || environment.TRACEPAD_PROVIDER
    || String(configuration.default_profile || "");
  if (activeProfile && !profiles[activeProfile]) {
    activeProfile = Object.values(profiles).find(profile => profile.provider === activeProfile)?.id ?? activeProfile;
  }
  if (!activeProfile) {
    activeProfile = Object.values(profiles).find(profile => profileReady(profile, providers, environment))?.id
      ?? Object.keys(profiles)[0]
      ?? "";
  }
  if (!profiles[activeProfile]) throw new Error(`Unknown Tracepad profile ${activeProfile || "(empty)"}.`);

  return { providers, profiles, activeProfile, loadedFiles, environment };
}

export function discoverConfigurationRoot(startDirectory: string): string {
  const initial = resolve(startDirectory);
  let current = initial;
  while (true) {
    if (
      existsSync(join(current, "tracepad.yaml"))
      || existsSync(join(current, "tracepad.example.yaml"))
      || existsSync(join(current, "pyproject.toml"))
    ) return current;
    const parent = dirname(current);
    if (parent === current) return initial;
    current = parent;
  }
}

export function profileReady(
  profile: ProfileDefinition,
  providers: Record<string, ProviderDefinition>,
  environment: NodeJS.ProcessEnv
): boolean {
  const provider = providers[profile.provider];
  const hasKey = !provider.requiresApiKey || Boolean(provider.apiKeyEnv && environment[provider.apiKeyEnv]);
  const hasModel = Boolean(profile.model) || provider.driver === "ollama-chat";
  return Boolean(hasModel && hasKey);
}

function mapping(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Tracepad ${label} must be a mapping.`);
  }
  return value as Record<string, any>;
}

function stringMapping(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(mapping(value, "headers")).map(([key, item]) => [key, String(item)]));
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isMapping(value) && isMapping(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanBaseUrl(value: string): string {
  let url = value.trim().replace(/\/$/, "");
  if (!url.includes("://")) url = `http://${url}`;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return url;
  } catch {
    throw new Error(`Invalid Tracepad provider URL: ${value}`);
  }
}
