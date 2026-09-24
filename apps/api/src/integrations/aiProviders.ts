import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getStore } from "../db/index.js";
import { decryptSecret } from "../auth/crypto.js";
import type { ServerUser } from "../db/types.js";

/* ── Multi-provider AI registry ──────────────────────────────────────────────
 * Almost every provider speaks the OpenAI /v1/chat/completions shape, so ONE "openai"
 * transport covers OpenRouter, Gemini, Groq, Cerebras, DeepSeek, OpenAI, Mistral and
 * local Ollama — differing only by baseURL + model + key. Anthropic keeps its native SDK.
 * Per model: inPerM/outPerM are $/1M tokens; 0 = a free tier, so the daily spend cap never blocks it. */

export interface ProviderDef {
  id: string;
  label: string;
  transport: "anthropic" | "openai";
  baseURL: string;
  defaultModel: string;
  free: boolean; // has a genuine free tier → priced at 0 for the cap
  inPerM: number;
  outPerM: number;
  needsKey: boolean; // Ollama runs locally and ignores the key
  hint: string; // where to get a key (shown in Settings)
}

export const AI_PROVIDERS: ProviderDef[] = [
  { id: "anthropic", label: "Anthropic (Claude)", transport: "anthropic", baseURL: "https://api.anthropic.com", defaultModel: "claude-haiku-4-5", free: false, inPerM: 1, outPerM: 5, needsKey: true, hint: "console.anthropic.com" },
  { id: "gemini", label: "Google Gemini — free tier", transport: "openai", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash-lite", free: true, inPerM: 0, outPerM: 0, needsKey: true, hint: "aistudio.google.com/apikey (no card)" },
  { id: "groq", label: "Groq — free, fast", transport: "openai", baseURL: "https://api.groq.com/openai/v1", defaultModel: "llama-3.1-8b-instant", free: true, inPerM: 0, outPerM: 0, needsKey: true, hint: "console.groq.com/keys (no card)" },
  { id: "cerebras", label: "Cerebras — free tier, fast", transport: "openai", baseURL: "https://api.cerebras.ai/v1", defaultModel: "llama-3.3-70b", free: true, inPerM: 0, outPerM: 0, needsKey: true, hint: "cloud.cerebras.ai (~1M tokens/day free)" },
  { id: "openrouter", label: "OpenRouter — many models", transport: "openai", baseURL: "https://openrouter.ai/api/v1", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", free: true, inPerM: 0, outPerM: 0, needsKey: true, hint: "openrouter.ai/keys" },
  { id: "mistral", label: "Mistral — free tier", transport: "openai", baseURL: "https://api.mistral.ai/v1", defaultModel: "ministral-3b-latest", free: true, inPerM: 0, outPerM: 0, needsKey: true, hint: "console.mistral.ai (free-tier inputs may train models)" },
  { id: "deepseek", label: "DeepSeek — very cheap", transport: "openai", baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", free: false, inPerM: 0.3, outPerM: 0.6, needsKey: true, hint: "platform.deepseek.com" },
  { id: "openai", label: "OpenAI", transport: "openai", baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", free: false, inPerM: 0.15, outPerM: 0.6, needsKey: true, hint: "platform.openai.com/api-keys" },
  { id: "ollama", label: "Ollama — local, private", transport: "openai", baseURL: "http://localhost:11434/v1", defaultModel: "llama3.2", free: true, inPerM: 0, outPerM: 0, needsKey: false, hint: "runs on your own machine" },
];

const BY_ID = new Map(AI_PROVIDERS.map((p) => [p.id, p]));
export const isProviderId = (id: string): boolean => BY_ID.has(id);

/** A fully-resolved provider ready to call: which transport, which key/URL/model, and its cost rates. */
export interface AiProviderCtx {
  id: string;
  transport: "anthropic" | "openai";
  apiKey: string;
  baseURL: string;
  model: string;
  inPerM: number;
  outPerM: number;
}

function serverKey(id: string): string | null {
  return config.ai.keys[id] ?? null;
}
function baseUrlFor(def: ProviderDef): string {
  if (def.id === "ollama") return config.ai.ollamaBaseUrl || def.baseURL;
  return def.baseURL;
}
function modelFor(def: ProviderDef, user: ServerUser | null): string {
  const override = user?.aiModel?.trim();
  if (override) return override;
  if (def.id === "anthropic" && config.ai.anthropicModel) return config.ai.anthropicModel;
  return def.defaultModel;
}

/** Whether the user (by their current provider choice) can run AI right now — a BYOK key, a server env
 *  key, or a keyless local provider. Sync so publicUser() can call it without an extra store read. */
export function aiAvailableForUser(user: ServerUser): boolean {
  const def = BY_ID.get(user.aiProvider ?? config.ai.defaultProvider);
  if (!def) return false;
  if (!def.needsKey) return true;
  return !!(decryptSecret(user.aiKeys?.[def.id]) || serverKey(def.id));
}

/** Resolve the provider context for a user (BYOK key → server env key), or null when none is usable. */
export async function resolveProvider(userId?: string): Promise<AiProviderCtx | null> {
  const user = userId ? await getStore().users.findById(userId) : null;
  const def = BY_ID.get(user?.aiProvider ?? config.ai.defaultProvider) ?? BY_ID.get("anthropic")!;
  const key = (user ? decryptSecret(user.aiKeys?.[def.id]) : undefined) || serverKey(def.id);
  if (def.needsKey && !key) return null;
  return { id: def.id, transport: def.transport, apiKey: key || "ollama", baseURL: baseUrlFor(def), model: modelFor(def, user ?? null), inPerM: def.inPerM, outPerM: def.outPerM };
}

/** One model call against a resolved provider. Returns the text, or null (all retries failed). */
export async function completeWith(ctx: AiProviderCtx, input: { system: string; prompt: string; maxTokens?: number }): Promise<string | null> {
  const maxTokens = input.maxTokens ?? 400;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (ctx.transport === "anthropic") {
        const c = new Anthropic({ apiKey: ctx.apiKey, baseURL: ctx.baseURL });
        const res = await c.messages.create({ model: ctx.model, max_tokens: maxTokens, system: input.system, messages: [{ role: "user", content: input.prompt }] });
        const text = res.content.find((b) => b.type === "text");
        if (text && "text" in text) return text.text;
      } else {
        const res = await fetch(`${ctx.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.apiKey}`,
            "HTTP-Referer": config.appUrl, // OpenRouter etiquette headers; harmless elsewhere
            "X-Title": "Kosh",
          },
          body: JSON.stringify({ model: ctx.model, max_tokens: maxTokens, messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }] }),
        });
        if (!res.ok) {
          logger.warn({ status: res.status, provider: ctx.id }, "ai completion failed");
          continue;
        }
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content;
        if (content) return content;
      }
    } catch (err) {
      logger.warn({ err, provider: ctx.id }, "ai completion failed");
    }
  }
  return null;
}

/** The catalog the Settings UI renders (no secrets — only whether a server key exists). */
export function providerCatalog(): { id: string; label: string; free: boolean; defaultModel: string; needsKey: boolean; hasServerKey: boolean; hint: string }[] {
  return AI_PROVIDERS.map((p) => ({ id: p.id, label: p.label, free: p.free, defaultModel: p.defaultModel, needsKey: p.needsKey, hasServerKey: !!serverKey(p.id), hint: p.hint }));
}
