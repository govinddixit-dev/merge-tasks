/**
 * llm.ts — Provider-Agnostic LLM Invocation
 *
 * Public API: invokeLLM(params) → InvokeResult
 *
 * Internally dispatches to:
 *   - invokeOpenAICompatible() for OpenAI, Google, Together, Groq, Mistral
 *   - invokeAnthropic() for Anthropic (via anthropicAdapter.ts)
 *
 * Features:
 *   - Provider dispatch based on LLM_PROVIDER env var
 *   - Automatic fallback to LLM_FALLBACK_PROVIDER on primary failure
 *   - OpenAI Zero Data Retention header (Layer 4)
 *   - Per-call model override via params.model
 *   - Backward compatible — all callers use the same InvokeParams/InvokeResult
 */

import { ENV } from "./env";
import {
  loadLLMConfig,
  loadLLMConfigForTask,
  loadFallbackConfig,
  type LLMProviderConfig,
  type LLMTask,
} from "./llmConfig";
import { invokeAnthropic } from "./anthropicAdapter";
import { getLogger } from "../utils/logger";

const log = getLogger("llm");

/* ------------------------------------------------------------------ */
/*  Types (unchanged — backward compatible)                            */
/* ------------------------------------------------------------------ */

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type ImageBase64Content = {
  type: "image_base64";
  image_base64: {
    media_type: string;
    data: string;
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?:
      | "audio/mpeg"
      | "audio/wav"
      | "application/pdf"
      | "audio/mp4"
      | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | ImageBase64Content | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
  /**
   * Assistant-message tool calls. Required on assistant turns that request
   * tools so the subsequent `role: "tool"` results stay linked — OpenAI
   * rejects tool results whose preceding assistant message lacks tool_calls.
   */
  tool_calls?: ToolCall[];
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** Override the default model (e.g. 'gpt-4.1-mini', 'gpt-4o') */
  model?: string;
  /** Sampling temperature 0-2 */
  temperature?: number;
  /**
   * Route this call to the model configured for a specific task.
   * Takes precedence over global LLM_PROVIDER/LLM_MODEL env vars but
   * is still overridden by an explicit `model` field above.
   */
  task?: LLMTask;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

/* ------------------------------------------------------------------ */
/*  Message normalization helpers                                      */
/* ------------------------------------------------------------------ */

const ensureArray = (
  value: MessageContent | MessageContent[] | null | undefined
): MessageContent[] => {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | ImageBase64Content | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") return part;
  if (part.type === "image_url") return part;
  if (part.type === "image_base64") return part;
  if (part.type === "file_url") return part;
  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id, tool_calls } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
    return { role, name, tool_call_id, content };
  }

  // Preserve assistant tool_calls — OpenAI rejects subsequent tool-role
  // messages whose preceding assistant turn does not carry them.
  const toolCallsProp =
    role === "assistant" && tool_calls && tool_calls.length > 0
      ? { tool_calls }
      : {};

  const rawParts = ensureArray(message.content);
  // Assistant messages with only tool_calls have null/empty content
  if (rawParts.length === 0) {
    return { role, name, content: "", ...toolCallsProp };
  }
  const contentParts = rawParts.map(normalizeContentPart);

  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role, name, content: contentParts[0].text, ...toolCallsProp };
  }

  return { role, name, content: contentParts, ...toolCallsProp };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;
  if (toolChoice === "none" || toolChoice === "auto") return toolChoice;

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return { type: "function", function: { name: tools[0].function.name } };
  }

  if ("name" in toolChoice) {
    return { type: "function", function: { name: toolChoice.name } };
  }

  return toolChoice;
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

/* ------------------------------------------------------------------ */
/*  OpenAI-compatible invocation                                       */
/*  Works for: OpenAI, Google, Together, Groq, Mistral                 */
/* ------------------------------------------------------------------ */

async function invokeOpenAICompatible(
  params: InvokeParams,
  cfg: LLMProviderConfig
): Promise<InvokeResult> {
  const { messages, tools, toolChoice, tool_choice } = params;

  const payload: Record<string, unknown> = {
    model: params.model || cfg.model || "gpt-4.1-mini", // defensive fallback
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = params.maxTokens || params.max_tokens || cfg.maxTokens;
  // ── Model-aware max_tokens safety clamp ──────────────────────────────────
  // Prevent 400 errors from providers rejecting over-limit token counts.
  // These are conservative hard limits per model family; update as models evolve.
  const MODEL_MAX_COMPLETION_TOKENS: Record<string, number> = {
    // OpenAI
    "gpt-4.1":            32768,
    "gpt-4.1-mini":       16384,
    "gpt-4.1-nano":        8192,
    "gpt-4o":             16384,
    "gpt-4o-mini":        16384,
    "gpt-4-turbo":         4096,
    "gpt-3.5-turbo":       4096,
    // Anthropic
    "claude-3-5-sonnet":   8192,
    "claude-3-5-haiku":    8192,
    "claude-sonnet-4":    64000,
    "claude-haiku-4":     64000,
    "claude-opus-4":       8192,
    // Google
    "gemini-2.5-flash":   65536,
    "gemini-2.5-pro":     65536,
    "gemini-2.0-flash":    8192,
    "gemini-1.5-pro":      8192,
    // Groq / Together / Mistral — conservative defaults
    "llama-3.1-70b":       8192,
    "mistral-large":       8192,
  };
  const activeModel: string = (params.model || cfg.model || "").toLowerCase();
  const modelCap = Object.entries(MODEL_MAX_COMPLETION_TOKENS).find(
    ([key]) => activeModel.includes(key)
  )?.[1];
  if (modelCap && (payload.max_tokens as number) > modelCap) {
    log.warn(
      `max_tokens ${payload.max_tokens} exceeds model cap ${modelCap} for "${activeModel}" — clamping to ${modelCap}`
    );
    payload.max_tokens = modelCap;
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (params.temperature !== undefined) {
    payload.temperature = params.temperature;
  } else if (cfg.temperature !== undefined) {
    payload.temperature = cfg.temperature;
  }

  // OpenAI-specific: thinking parameter — only for reasoning models (o1/o3)
  // Safety net: even if config provides thinking, verify the model supports it.
  // gpt-4o, gpt-4o-mini, gpt-3.5-turbo etc. will 400 if 'thinking' is sent.
  const modelLower = (params.model || cfg.model || "gpt-4.1-mini").toLowerCase();
  const isReasoningModel = /^o[13]/.test(modelLower);
  if (cfg.provider === "openai" && cfg.providerOptions?.thinking && isReasoningModel) {
    payload.thinking = cfg.providerOptions.thinking;
  }

  const normalizedResponseFormat = normalizeResponseFormat(params);
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  // Build headers
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${cfg.apiKey}`,
  };

  // Layer 4: OpenAI Zero Data Retention header
  if (cfg.provider === "openai" && ENV.openaiZeroDataRetention) {
    headers["X-OpenAI-Data-Policy"] = "zdr";
  }

  const response = await fetch(cfg.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed (${cfg.provider}): ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}

/* ------------------------------------------------------------------ */
/*  Provider dispatch                                                  */
/* ------------------------------------------------------------------ */

async function invokeProvider(
  params: InvokeParams,
  cfg: LLMProviderConfig
): Promise<InvokeResult> {
  if (cfg.provider === "anthropic") {
    return invokeAnthropic(params, cfg);
  }
  return invokeOpenAICompatible(params, cfg);
}

/* ------------------------------------------------------------------ */
/*  Public API — with automatic fallback                               */
/* ------------------------------------------------------------------ */

/**
 * Invoke the configured LLM provider.
 *
 * - Dispatches to the correct provider based on LLM_PROVIDER env var
 * - Automatically falls back to LLM_FALLBACK_PROVIDER on primary failure
 * - Caller never knows which provider responded
 *
 * @param params  Standard InvokeParams (messages, tools, model override, etc.)
 * @returns       Standard InvokeResult (choices, usage, etc.)
 */
export async function invokeLLM(
  params: InvokeParams
): Promise<InvokeResult> {
  const primaryConfig = params.task
    ? loadLLMConfigForTask(params.task)
    : loadLLMConfig();

  if (!primaryConfig.apiKey) {
    throw new Error(
      `LLM API key is not configured for provider "${primaryConfig.provider}". ` +
        `Set the matching *_API_KEY in your .env file ` +
        `(ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY).`
    );
  }

  try {
    return await invokeProvider(params, primaryConfig);
  } catch (err) {
    const fallbackConfig = loadFallbackConfig();
    if (!fallbackConfig) throw err; // no fallback configured — re-throw
    // Skip fallback if it would just call the same provider again.
    if (fallbackConfig.provider === primaryConfig.provider) throw err;

    log.warn(
      `Primary LLM (${primaryConfig.provider}) failed, ` +
        `falling back to ${fallbackConfig.provider}: ${(err as Error).message}`
    );

    return invokeProvider(params, fallbackConfig);
  }
}
