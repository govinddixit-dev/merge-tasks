/**
 * llmConfig.ts — LLM Provider Configuration
 *
 * Loads provider settings from environment variables and provides
 * sensible defaults for each supported provider. The config is
 * consumed by llm.ts to dispatch requests to the correct endpoint.
 *
 * Supported providers:
 *   openai, anthropic, google, together, groq, mistral
 *
 * All providers except Anthropic use the OpenAI-compatible chat
 * completions format. Anthropic requires a dedicated adapter
 * (see anthropicAdapter.ts).
 */

import { ENV } from "./env";
import { getLogger } from "../utils/logger";

const log = getLogger("llmConfig");

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type LLMProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "together"
  | "groq"
  | "mistral";

/**
 * Task categories used for model routing. Callers pass a task to
 * loadLLMConfigForTask() to get the right provider+model for the workload,
 * instead of relying solely on the global LLM_PROVIDER env var.
 *
 *   copilot   — quick chat turns in the AI copilot (latency-sensitive)
 *   briefing  — scheduled daily briefings (latency-tolerant, high-volume)
 *   reasoning — multi-step analysis, tool chains, anything that benefits from Sonnet
 *   proposal  — proposal generation (long-form, structured output)
 *   bulk      — high-volume simple tasks (classification, summarization)
 */
export type LLMTask =
  | "copilot"
  | "briefing"
  | "reasoning"
  | "proposal"
  | "bulk";

export interface LLMProviderConfig {
  provider: LLMProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  /** Provider-specific options (e.g. OpenAI thinking parameter) */
  providerOptions: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Provider defaults                                                  */
/* ------------------------------------------------------------------ */

interface ProviderDefaults {
  apiUrl: string;
  model: string;
}

const PROVIDER_DEFAULTS: Record<LLMProvider, ProviderDefaults> = {
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini",
  },
  anthropic: {
    apiUrl: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
  },
  google: {
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
  },
  together: {
    apiUrl: "https://api.together.xyz/v1/chat/completions",
    model: "meta-llama/Llama-3.1-70B-Instruct-Turbo",
  },
  groq: {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-70b-versatile",
  },
  mistral: {
    apiUrl: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-large-latest",
  },
};

/* ------------------------------------------------------------------ */
/*  Config loaders                                                     */
/* ------------------------------------------------------------------ */

function resolveProvider(raw: string): LLMProvider {
  const normalized = raw.toLowerCase().trim();
  const valid: LLMProvider[] = [
    "openai",
    "anthropic",
    "google",
    "together",
    "groq",
    "mistral",
  ];
  if (valid.includes(normalized as LLMProvider)) {
    return normalized as LLMProvider;
  }
  log.warn(`Unknown LLM_PROVIDER "${raw}", falling back to "openai"`);
  return "openai";
}

function resolveApiKey(provider: LLMProvider, explicitKey: string): string {
  const ex = explicitKey.trim();
  if (ex) return ex;
  // Provider-specific env var fallbacks so each backend can be used
  // without having to set LLM_API_KEY explicitly.
  switch (provider) {
    case "anthropic":
      if (ENV.anthropicApiKey) return ENV.anthropicApiKey;
      break;
    case "google":
      if (ENV.geminiApiKey) return ENV.geminiApiKey;
      break;
    default:
      break;
  }
  // Backward-compatible default: the existing OpenAI key
  return (
    ENV.appOpenAiApiKey ||
    (process.env.OPENAI_API_KEY ?? "").trim() ||
    ""
  );
}

/**
 * Load the primary LLM provider configuration from environment variables.
 * Falls back to sensible defaults per provider.
 */

/**
 * Models that support the OpenAI `thinking` parameter.
 * Only reasoning-series models (o1, o3, etc.) accept this —
 * sending it to gpt-4o / gpt-4o-mini causes a 400 Bad Request.
 */
const THINKING_CAPABLE_MODELS = new Set([
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
]);

/**
 * Check if a model supports the `thinking` parameter.
 * Uses prefix matching so "o3-mini-2025-01-31" still matches.
 */
function supportsThinking(model: string): boolean {
  const lower = model.toLowerCase();
  // Array.from to stay TS-target compatible (no downlevelIteration needed).
  for (const prefix of Array.from(THINKING_CAPABLE_MODELS)) {
    if (lower === prefix || lower.startsWith(prefix + "-")) return true;
  }
  return false;
}

/**
 * Build provider-specific options safely based on model capabilities.
 */
function buildProviderOptions(
  provider: LLMProvider,
  model: string,
): Record<string, unknown> {
  if (provider === "openai" && supportsThinking(model)) {
    return { thinking: { budget_tokens: 128 } };
  }
  return {};
}

/* ------------------------------------------------------------------ */
/*  Task → model routing                                               */
/* ------------------------------------------------------------------ */

/**
 * Static routing table: which provider + model should serve each task.
 *
 *   Claude Haiku 4.5  — quick copilot + daily briefings (low latency, cheap)
 *   Claude Sonnet 4.5 — proposal generation + complex reasoning
 *   Gemini 2.5 Flash  — high-volume simple tasks (cheap, throughput-oriented)
 *                       Also used as the automatic fallback on primary failure.
 *
 * Model IDs are pinned here rather than in env vars so routing is explicit
 * in-repo. Operators who need to override can still set LLM_PROVIDER/LLM_MODEL
 * to force a single-provider setup via loadLLMConfig() (legacy path).
 */
const TASK_ROUTES: Record<LLMTask, { provider: LLMProvider; model: string }> = {
  copilot:   { provider: "anthropic", model: "claude-haiku-4-5" },
  briefing:  { provider: "anthropic", model: "claude-haiku-4-5" },
  reasoning: { provider: "anthropic", model: "claude-sonnet-4-5" },
  proposal:  { provider: "anthropic", model: "claude-sonnet-4-5" },
  bulk:      { provider: "google",    model: "gemini-2.5-flash" },
};

/**
 * Build a provider config for a specific task, ignoring LLM_PROVIDER/LLM_MODEL
 * env vars. Used by callers that know their workload (copilot, proposal, …)
 * and want deterministic routing.
 */
export function loadLLMConfigForTask(task: LLMTask): LLMProviderConfig {
  const route = TASK_ROUTES[task];
  const defaults = PROVIDER_DEFAULTS[route.provider];
  return {
    provider: route.provider,
    apiUrl: defaults.apiUrl,
    apiKey: resolveApiKey(route.provider, ""),
    model: route.model,
    maxTokens: ENV.llmMaxTokens,
    temperature: ENV.llmTemperature,
    providerOptions: buildProviderOptions(route.provider, route.model),
  };
}

export function loadLLMConfig(): LLMProviderConfig {
  const provider = resolveProvider(ENV.llmProvider);
  const defaults = PROVIDER_DEFAULTS[provider];
  const model = ENV.llmModel || defaults.model;

  return {
    provider,
    apiUrl: ENV.llmApiUrl || defaults.apiUrl,
    apiKey: resolveApiKey(provider, ENV.llmApiKey),
    model,
    maxTokens: ENV.llmMaxTokens,
    temperature: ENV.llmTemperature,
    providerOptions: buildProviderOptions(provider, model),
  };
}

/**
 * Load the fallback LLM provider configuration.
 *
 * Default fallback is Google Gemini 2.5 Flash — fast and cheap enough to
 * absorb primary-provider failures for simple / high-volume workloads.
 * Operators can override via LLM_FALLBACK_PROVIDER / LLM_FALLBACK_MODEL.
 *
 * Returns null only when the default fallback has no API key available
 * (so we don't claim a fallback we can't actually call).
 */
export function loadFallbackConfig(): LLMProviderConfig | null {
  const providerRaw = ENV.llmFallbackProvider || "google";
  const provider = resolveProvider(providerRaw);
  const defaults = PROVIDER_DEFAULTS[provider];

  const DEFAULT_FALLBACK_MODEL_BY_PROVIDER: Partial<Record<LLMProvider, string>> = {
    google: "gemini-2.5-flash",
  };
  const model =
    ENV.llmFallbackModel ||
    DEFAULT_FALLBACK_MODEL_BY_PROVIDER[provider] ||
    defaults.model;

  const apiKey = resolveApiKey(provider, ENV.llmFallbackApiKey);
  if (!apiKey) return null;

  return {
    provider,
    apiUrl: ENV.llmFallbackApiUrl || defaults.apiUrl,
    apiKey,
    model,
    maxTokens: ENV.llmMaxTokens,
    temperature: ENV.llmTemperature,
    providerOptions: buildProviderOptions(provider, model),
  };
}
