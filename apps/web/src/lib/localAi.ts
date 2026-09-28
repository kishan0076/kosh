/**
 * On-device AI engine (browser side). Talks DIRECTLY to a local model server the user runs — Ollama,
 * LM Studio, llama.cpp, … — over its OpenAI-compatible `/v1` API. Nothing goes through the Kosh API, so
 * inference is free, private, and offline-capable. Config is per-DEVICE (the model lives on this machine),
 * so it's stored in localStorage, never on the account.
 *
 * The request/response shaping lives in `@kosh/shared` (pure + tested); this file adds fetch, timeouts,
 * and the localStorage config.
 */
import {
  buildChatRequest,
  normalizeLocalBaseUrl,
  parseChatResponse,
  parseModelList,
  DEFAULT_LOCAL_AI_URL,
  DEFAULT_LOCAL_AI_MODEL,
} from "@kosh/shared";

const ENABLED_KEY = "kosh.localAi.enabled";
const URL_KEY = "kosh.localAi.url";
const MODEL_KEY = "kosh.localAi.model";

export interface LocalAiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
}

const ls = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Read the per-device on-device AI config (normalized). */
export function localAiConfig(): LocalAiConfig {
  const store = ls();
  return {
    enabled: store?.getItem(ENABLED_KEY) === "1",
    baseUrl: normalizeLocalBaseUrl(store?.getItem(URL_KEY) ?? DEFAULT_LOCAL_AI_URL),
    model: store?.getItem(MODEL_KEY)?.trim() || DEFAULT_LOCAL_AI_MODEL,
  };
}

/** Persist a partial config change. A raw base URL is stored as-typed; readers normalize it. */
export function setLocalAiConfig(patch: Partial<{ enabled: boolean; baseUrl: string; model: string }>): void {
  const store = ls();
  if (!store) return;
  if (patch.enabled !== undefined) {
    if (patch.enabled) store.setItem(ENABLED_KEY, "1");
    else store.removeItem(ENABLED_KEY);
  }
  if (patch.baseUrl !== undefined) store.setItem(URL_KEY, patch.baseUrl.trim());
  if (patch.model !== undefined) store.setItem(MODEL_KEY, patch.model.trim());
}

export const localAiEnabled = (): boolean => localAiConfig().enabled;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // Compose an external abort signal (if any) with the timeout.
  const external = init.signal;
  if (external) external.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface ProbeResult {
  ok: boolean;
  models: string[];
  error?: string;
}

/** Check whether a local server is reachable and list its models. Tries the OpenAI `/v1/models` route,
 *  then falls back to Ollama's native `/api/tags`. Never throws — returns { ok:false, error }. */
export async function probeLocalAi(rawUrl?: string, timeoutMs = 4000): Promise<ProbeResult> {
  const base = normalizeLocalBaseUrl(rawUrl ?? localAiConfig().baseUrl);
  try {
    const res = await fetchWithTimeout(`${base}/models`, { method: "GET" }, timeoutMs);
    if (res.ok) return { ok: true, models: parseModelList(await res.json()) };
  } catch {
    /* try the native Ollama route next */
  }
  try {
    const nativeBase = base.replace(/\/v\d+$/, "");
    const res = await fetchWithTimeout(`${nativeBase}/api/tags`, { method: "GET" }, timeoutMs);
    if (res.ok) return { ok: true, models: parseModelList(await res.json()) };
  } catch {
    /* fall through */
  }
  return { ok: false, models: [], error: "Couldn't reach a local model server. Is it running and reachable at this address?" };
}

export interface LocalCompleteInput {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Run one completion on the local model. Throws a friendly error if the server is unreachable or replies
 * with an error — callers can then fall back to the server provider.
 */
export async function localComplete(input: LocalCompleteInput): Promise<string> {
  const cfg = localAiConfig();
  const base = cfg.baseUrl;
  const body = buildChatRequest({
    model: input.model ?? cfg.model,
    system: input.system,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  });
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/chat/completions`,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer local" }, body: JSON.stringify(body), signal: input.signal },
      input.timeoutMs ?? 120_000,
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("On-device request was cancelled or timed out.");
    throw new Error("Couldn't reach your local model server. Check it's running (see Settings → On-device AI).");
  }
  if (!res.ok) throw new Error(`Local model returned ${res.status}. Check the model name in Settings.`);
  const text = parseChatResponse(await res.json());
  if (!text) throw new Error("The local model returned an empty response.");
  return text;
}
