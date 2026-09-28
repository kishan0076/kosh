/**
 * On-device AI — the browser talks DIRECTLY to a local model server (Ollama, LM Studio, llama.cpp, …),
 * never the Kosh API. That means zero marginal cost, zero server round-trip, and full privacy: prompts and
 * completions never leave the machine. Every local runtime exposes the OpenAI `/v1/chat/completions` shape,
 * so one transport covers them all — differing only by base URL + model.
 *
 * This module is the pure, tested core (URL normalization, request/response shaping, model-list parsing,
 * loose JSON extraction). The browser engine (`apps/web/src/lib/localAi.ts`) wires it to `fetch`.
 */

export const DEFAULT_LOCAL_AI_URL = "http://localhost:11434/v1"; // Ollama's default OpenAI-compatible endpoint
export const DEFAULT_LOCAL_AI_MODEL = "llama3.2";

/** Coerce whatever the user typed into a usable OpenAI-compatible base URL:
 *  add http:// if no scheme, drop a trailing slash, and ensure the /v1 path. */
export function normalizeLocalBaseUrl(url: string | undefined | null): string {
  let u = (url ?? "").trim();
  if (!u) return DEFAULT_LOCAL_AI_URL;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(u)) u = `${u}/v1`;
  return u;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  stream: boolean;
}

/** Build the OpenAI chat body a local server expects. */
export function buildChatRequest(input: { model: string; system?: string; prompt: string; maxTokens?: number; temperature?: number }): ChatRequest {
  const messages: ChatMessage[] = [];
  if (input.system?.trim()) messages.push({ role: "system", content: input.system });
  messages.push({ role: "user", content: input.prompt });
  return {
    model: input.model,
    messages,
    max_tokens: input.maxTokens ?? 512,
    temperature: input.temperature ?? 0.2,
    stream: false,
  };
}

/** Pull the assistant text out of an OpenAI chat-completions response (null if empty/malformed). */
export function parseChatResponse(json: unknown): string | null {
  const j = json as { choices?: { message?: { content?: unknown } }[] };
  const c = j?.choices?.[0]?.message?.content;
  return typeof c === "string" && c.trim() ? c : null;
}

/** Model ids from either the OpenAI `/v1/models` ({data:[{id}]}) or Ollama's `/api/tags` ({models:[{name}]}). */
export function parseModelList(json: unknown): string[] {
  const j = json as { data?: { id?: unknown }[]; models?: { name?: unknown }[] };
  const openai = Array.isArray(j?.data) ? j.data.map((d) => (typeof d?.id === "string" ? d.id : "")).filter(Boolean) : [];
  const ollama = Array.isArray(j?.models) ? j.models.map((m) => (typeof m?.name === "string" ? m.name : "")).filter(Boolean) : [];
  return [...new Set([...openai, ...ollama])];
}

/** Extract the first JSON object from a model's reply, tolerating ```json fences and surrounding prose. */
export function extractJsonObject<T>(text: string | null): T | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
