/**
 * Probe API keys from `.env`: validity + rate-limit / quota hints where providers
 * expose them (without printing secret values).
 *
 * Usage (from repo root):
 *   pnpm check:api-quotas
 *   pnpm exec tsx scripts/check-api-key-quotas.ts
 *
 * Uses lightweight read-only or list endpoints where possible to minimise cost.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(): void {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    console.error(`No .env at ${envPath}`);
    process.exit(1);
  }
  dotenv.config({ path: envPath });
  const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    const cur = process.env[key];
    if (cur === undefined || cur === "") {
      process.env[key] = value;
    }
  }
}

function maskKey(k: string): string {
  const t = k.trim();
  if (t.length <= 8) return "(too short to mask)";
  return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} chars)`;
}

function pickRateHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, name) => {
    const n = name.toLowerCase();
    if (
      n.includes("ratelimit") ||
      n.includes("rate-limit") ||
      n.includes("x-ratelimit") ||
      n.includes("anthropic-ratelimit") ||
      n.includes("retry-after") ||
      n.includes("quota")
    ) {
      out[name] = value;
    }
  });
  return out;
}

async function checkOpenAI(key: string): Promise<void> {
  const label = "OPENAI_API_KEY / APP_OPENAI_API_KEY";
  if (!key) {
    console.log(`\n[openai] SKIP — no key set (${label})`);
    return;
  }
  console.log(`\n[openai] ${maskKey(key)}`);
  const res = await fetch("https://api.openai.com/v1/models?limit=5", {
    headers: { Authorization: `Bearer ${key.trim()}` },
  });
  const rate = pickRateHeaders(res.headers);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    console.log(`  status: ${res.status} ${res.statusText}`);
    console.log(`  body: ${body}`);
    return;
  }
  console.log(`  status: ${res.status} OK (models list — no token charge)`);
  if (Object.keys(rate).length) {
    console.log("  rate / quota headers:");
    for (const [k, v] of Object.entries(rate)) console.log(`    ${k}: ${v}`);
  } else {
    console.log("  (no rate-limit headers on this response — normal for /v1/models)");
  }
}

async function checkAnthropic(key: string): Promise<void> {
  if (!key) {
    console.log("\n[anthropic] SKIP — no ANTHROPIC_API_KEY");
    return;
  }
  console.log(`\n[anthropic] ${maskKey(key)}`);
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": key.trim(),
      "anthropic-version": "2023-06-01",
    },
  });
  const rate = pickRateHeaders(res.headers);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    console.log(`  status: ${res.status} ${res.statusText}`);
    console.log(`  body: ${body}`);
    return;
  }
  console.log(`  status: ${res.status} OK (models list — no token charge)`);
  if (Object.keys(rate).length) {
    console.log("  rate / quota headers:");
    for (const [k, v] of Object.entries(rate)) console.log(`    ${k}: ${v}`);
  } else {
    console.log("  (no rate-limit headers on this response)");
  }
}

async function checkGemini(key: string): Promise<void> {
  if (!key) {
    console.log("\n[gemini] SKIP — no GEMINI_API_KEY");
    return;
  }
  const k = key.trim();
  console.log(`\n[gemini] ${maskKey(k)}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=3&key=${encodeURIComponent(k)}`;
  const res = await fetch(url);
  const rate = pickRateHeaders(res.headers);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    console.log(`  status: ${res.status} ${res.statusText}`);
    console.log(`  body: ${body}`);
    return;
  }
  console.log(`  status: ${res.status} OK (models list — no token charge)`);
  if (Object.keys(rate).length) {
    console.log("  rate / quota headers:");
    for (const [k2, v] of Object.entries(rate)) console.log(`    ${k2}: ${v}`);
  } else {
    console.log("  (Google often returns quota details only on generateContent errors)");
  }
}

async function checkResend(key: string): Promise<void> {
  if (!key) {
    console.log("\n[resend] SKIP — no RESEND_API_KEY");
    return;
  }
  console.log(`\n[resend] ${maskKey(key)}`);
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${key.trim()}` },
  });
  const rate = pickRateHeaders(res.headers);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    console.log(`  status: ${res.status} ${res.statusText}`);
    console.log(`  body: ${body}`);
    return;
  }
  console.log(`  status: ${res.status} OK (domains list)`);
  if (Object.keys(rate).length) {
    for (const [k, v] of Object.entries(rate)) console.log(`    ${k}: ${v}`);
  }
}

async function checkGroq(key: string): Promise<void> {
  if (!key) return;
  console.log(`\n[groq] ${maskKey(key)} (LLM_API_KEY when provider is groq)`);
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key.trim()}` },
  });
  if (!res.ok) {
    console.log(`  status: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return;
  }
  console.log(`  status: ${res.status} OK`);
  const rate = pickRateHeaders(res.headers);
  for (const [k, v] of Object.entries(rate)) console.log(`    ${k}: ${v}`);
}

async function main(): Promise<void> {
  loadEnv();

  const openai =
    (process.env.APP_OPENAI_API_KEY ?? "").trim() ||
    (process.env.OPENAI_API_KEY ?? "").trim();
  const anthropic = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  const gemini = (process.env.GEMINI_API_KEY ?? "").trim();
  const resend = (process.env.RESEND_API_KEY ?? "").trim();
  const llmProvider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  const llmKey = (process.env.LLM_API_KEY ?? "").trim();

  console.log("MergeTasks — API key / quota probe (keys from .env, values masked)\n");
  console.log("─".repeat(60));

  await checkOpenAI(openai);
  await checkAnthropic(anthropic);
  await checkGemini(gemini);
  await checkResend(resend);

  if (llmKey && llmProvider === "groq") {
    await checkGroq(llmKey);
  } else if (llmKey) {
    console.log(
      `\n[llm] LLM_API_KEY is set (provider=${llmProvider || "openai"}) — run provider-specific checks manually if needed.`,
    );
  }

  console.log("\n" + "─".repeat(60));
  console.log(
    "Note: Remaining *token* quota for billable calls is usually in your provider dashboard;",
    "HTTP headers here are mostly per-minute rate limits.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
