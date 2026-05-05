/**
 * Canary — verify the Anthropic adapter responds before pointing the
 * Phase 6 analyzer at it. Trivial text prompt, no vision, low tokens.
 */

import "dotenv/config";
import { invokeAnthropic } from "../../server/_core/anthropicAdapter";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("✗ ANTHROPIC_API_KEY not set in process env");
    process.exit(1);
  }

  const cfg = {
    provider: "anthropic" as const,
    apiUrl: "https://api.anthropic.com/v1/messages",
    apiKey,
    model: "claude-sonnet-4-6",
    maxTokens: 16,
    temperature: 0,
    providerOptions: {},
  };

  const t0 = Date.now();
  try {
    const res = await invokeAnthropic(
      {
        messages: [{ role: "user", content: "Reply with exactly the word: pong" }],
        maxTokens: 16,
        temperature: 0,
      } as any,
      cfg as any,
    );
    const ms = Date.now() - t0;
    const text = (res as any)?.choices?.[0]?.message?.content?.trim?.() ?? JSON.stringify(res);
    console.log(`✓ Anthropic canary OK in ${ms}ms`);
    console.log(`  reply: ${text}`);
    console.log(`  usage: ${JSON.stringify((res as any)?.usage)}`);
    process.exit(0);
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`✗ Anthropic canary FAILED in ${ms}ms`);
    console.error(err);
    process.exit(1);
  }
}

main();
