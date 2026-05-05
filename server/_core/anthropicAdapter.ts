/**
 * anthropicAdapter.ts — Anthropic Messages API Adapter
 *
 * Translates the internal OpenAI-compatible InvokeParams/InvokeResult
 * format to/from the Anthropic Messages API format.
 *
 * This allows the rest of the codebase to use a single interface
 * regardless of whether the backend is OpenAI, Anthropic, or anything else.
 *
 * Reference: https://docs.anthropic.com/en/api/messages
 */

import type { InvokeParams, InvokeResult, Message, Tool, ToolCall } from "./llm";
import type { LLMProviderConfig } from "./llmConfig";

/* ------------------------------------------------------------------ */
/*  Anthropic request types                                            */
/* ------------------------------------------------------------------ */

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  temperature?: number;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Translation: InvokeParams → AnthropicRequest                       */
/* ------------------------------------------------------------------ */

function extractSystemPrompt(messages: Message[]): {
  system: string | undefined;
  rest: Message[];
} {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const system = systemMsgs.length > 0
    ? systemMsgs.map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .map((p) => (typeof p === "string" ? p : "text" in p ? p.text : ""))
            .join("\n");
        }
        return typeof m.content === "object" && "text" in m.content
          ? m.content.text
          : "";
      }).join("\n\n")
    : undefined;
  return { system, rest };
}

function convertMessage(msg: Message): AnthropicMessage {
  const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";

  // Tool result messages → user message with tool_result block
  if (msg.role === "tool" || msg.role === "function") {
    const text = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("\n")
        : typeof msg.content === "object" && "text" in msg.content
          ? msg.content.text
          : "";
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: msg.tool_call_id || "unknown",
          content: text,
        },
      ],
    };
  }

  // Simple string content
  if (typeof msg.content === "string") {
    return { role, content: msg.content };
  }

  // Array content
  if (Array.isArray(msg.content)) {
    const blocks: AnthropicContentBlock[] = msg.content.map((part) => {
      if (typeof part === "string") return { type: "text" as const, text: part };
      if (part.type === "text") return { type: "text" as const, text: part.text };
      if (part.type === "image_url") {
        return {
          type: "image" as const,
          source: { type: "url" as const, url: part.image_url.url },
        };
      }
      if (part.type === "image_base64") {
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: part.image_base64.media_type,
            data: part.image_base64.data,
          },
        };
      }
      // file_url — treat as text reference
      return {
        type: "text" as const,
        text: `[File: ${part.type === "file_url" ? part.file_url.url : "unknown"}]`,
      };
    });
    return { role, content: blocks };
  }

  // Single content object
  if (typeof msg.content === "object" && "text" in msg.content) {
    return { role, content: msg.content.text };
  }

  return { role, content: "" };
}

function convertTools(tools: Tool[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: "object", properties: {} },
  }));
}

/* ------------------------------------------------------------------ */
/*  Translation: AnthropicResponse → InvokeResult                      */
/* ------------------------------------------------------------------ */

function convertResponse(resp: AnthropicResponse): InvokeResult {
  let textContent = "";
  const toolCalls: ToolCall[] = [];

  for (const block of resp.content) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const finishReason =
    resp.stop_reason === "tool_use"
      ? "tool_calls"
      : resp.stop_reason === "end_turn"
        ? "stop"
        : resp.stop_reason || "stop";

  return {
    id: resp.id,
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: resp.usage.input_tokens,
      completion_tokens: resp.usage.output_tokens,
      total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Invoke the Anthropic Messages API.
 *
 * Translates InvokeParams → Anthropic format, calls the API,
 * and translates the response back to InvokeResult format.
 */
export async function invokeAnthropic(
  params: InvokeParams,
  cfg: LLMProviderConfig
): Promise<InvokeResult> {
  const { system, rest } = extractSystemPrompt(params.messages);

  const body: AnthropicRequest = {
    model: params.model || cfg.model,
    max_tokens: params.maxTokens || params.max_tokens || cfg.maxTokens,
    messages: rest.map(convertMessage),
  };

  if (system) body.system = system;

  if (params.tools && params.tools.length > 0) {
    body.tools = convertTools(params.tools);
    body.tool_choice = { type: "auto" };
  }

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  } else if (cfg.temperature !== undefined) {
    body.temperature = cfg.temperature;
  }

  const response = await fetch(cfg.apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const anthropicResp = (await response.json()) as AnthropicResponse;
  return convertResponse(anthropicResp);
}
