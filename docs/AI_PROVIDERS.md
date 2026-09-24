# AI providers (multi-provider backend)

Kosh's AI features — link/skill **summaries + auto-tagging**, Drive **file summaries**, **natural-language
search**, and the **cleanup wizard** — run through a pluggable, multi-provider backend. You are no longer
locked to one vendor: pick any supported provider in **Settings → AI provider**, optionally **bring your own
key** (encrypted at rest), and Kosh routes every AI call to it.

The design goal is **cheap-or-free by default**: several providers have genuine free tiers (some with no
credit card), and free tiers are priced at `$0` so they never count against your daily spend cap.

---

## 1. How it works

```
  AI feature (summary / tags / NL search / cleanup)
        │
        ▼
  beginAiCall(userId)                      apps/api/src/integrations/claude.ts
        │  ├─ resolveProvider(userId)      apps/api/src/integrations/aiProviders.ts
        │  │     user's chosen provider → user BYOK key → server env key → keyless local
        │  ├─ estimateCostUsd(... provider rates)
        │  └─ reserveBudget(userId)        (per-user daily USD cap; free tiers price at 0)
        ▼
  completeWith(ctx, { system, prompt })    one call, provider-appropriate transport
        ├─ transport "anthropic"  → native @anthropic-ai/sdk
        └─ transport "openai"     → fetch {baseURL}/chat/completions   (everyone else)
        ▼
  refundBudget(...) if the model returned nothing usable
```

**Two transports, one adapter.** Almost every provider speaks the OpenAI `/v1/chat/completions` shape, so a
single `fetch` adapter covers Gemini, Groq, Cerebras, OpenRouter, Mistral, DeepSeek, OpenAI and local Ollama —
they differ only by `baseURL` + `defaultModel` + key. Anthropic keeps its native SDK.

**Provider resolution precedence** (`resolveProvider`):

1. The user's **chosen provider** (`user.aiProvider`, default `AI_DEFAULT_PROVIDER`).
2. The user's **own key** for that provider (BYOK, decrypted from `user.aiKeys`).
3. The **server env key** for that provider (fallback).
4. **Keyless local** providers (Ollama) need no key at all.

If a provider needs a key and none is found, AI resolves to *unavailable* (HTTP `503` with a "add an API key in
Settings" message) — Kosh never calls a paid endpoint with an empty/garbage key.

---

## 2. Supported providers

| Provider | Free tier? | Card needed? | Default model | Cost (in/out per 1M) | Notes |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ Yes | ❌ No | `gemini-2.5-flash-lite` | free | ~1,000–1,500 req/day, 15 RPM. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Groq** | ✅ Yes | ❌ No | `llama-3.1-8b-instant` | free | ~1,000 req/day, extremely fast (LPU). [console.groq.com/keys](https://console.groq.com/keys) |
| **Cerebras** | ✅ Yes | ⚠️ Now yes | `llama-3.3-70b` | free | ~1M tokens/day, very fast. Card required since mid-2026. [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| **SambaNova** | ✅ Yes | ❌ No | `Meta-Llama-3.3-70B-Instruct` | free | Permanent free tier of real models, very fast; low RPM + per-model daily caps. [cloud.sambanova.ai](https://cloud.sambanova.ai) |
| **Together AI** | ✅ `-Free` models | ❌ No | `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free` | free | Free `-Free`-suffixed endpoints (~60 RPM); a small deposit may be needed to unlock them. [together.ai](https://api.together.xyz/settings/api-keys) |
| **Z.ai (GLM)** | ✅ Yes | ❌ No | `glm-4.5-flash` | free | Permanently free "flash" models; ~1 concurrent request. Use `api.z.ai` (not bigmodel.cn). [z.ai](https://z.ai) |
| **OpenRouter** | ✅ `:free` models | ❌ No | `meta-llama/llama-3.3-70b-instruct:free` | free\* | One key → hundreds of models; `:free` variants cost nothing. [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Mistral** | ✅ Yes | ❌ No | `ministral-3b-latest` | free | Free-tier inputs **may be used for training** — don't send sensitive text. [console.mistral.ai](https://console.mistral.ai) |
| **DeepSeek** | ❌ Paid | ✅ Yes | `deepseek-chat` | ~$0.30 / $0.60 | Very cheap, strong quality. [platform.deepseek.com](https://platform.deepseek.com) |
| **DeepInfra** | ❌ Paid | ❌ To start | `…Meta-Llama-3.1-8B-Instruct-Turbo` | ~$0.02 / $0.04 | Among the cheapest anywhere; ~$5 one-time trial then PAYG. [deepinfra.com](https://deepinfra.com) |
| **Fireworks AI** | ❌ Paid | ❌ To start | `accounts/fireworks/models/llama-v3p1-8b-instruct` | ~$0.10 / $0.20 | Fast; model ids **must be fully qualified**; ~$1 trial then PAYG. [fireworks.ai](https://fireworks.ai) |
| **NVIDIA NIM** | ⚠️ Trial credits | ❌ No | `meta/llama-3.1-8b-instruct` | ~$0.10 / $0.20 | Free starter credits, 80+ hosted models; credits are finite. [build.nvidia.com](https://build.nvidia.com) |
| **Hugging Face router** | ⚠️ Tiny credit | ❌ No | `openai/gpt-oss-20b:cheapest` | ~$0.05 / $0.20 | Aggregator — one key fans out to Groq/Cerebras/Together/etc.; only ~$0.10/mo free credit. [huggingface.co](https://huggingface.co/settings/tokens) |
| **OpenAI** | ❌ Paid | ✅ Yes | `gpt-4o-mini` | ~$0.15 / $0.60 | Ubiquitous, reliable. [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic (Claude)** | ❌ Paid | ✅ Yes | `claude-haiku-4-5` | ~$1 / $5 | Highest quality for the summarization/JSON tasks here. [console.anthropic.com](https://console.anthropic.com) |
| **Ollama** | ✅ Local | ❌ No key | `llama3.2` | free | Runs **entirely on your machine** — fully private, no data leaves. Set `OLLAMA_BASE_URL`. |

\* OpenRouter `:free` models are rate-limited but cost $0; paid models on OpenRouter bill per its own pricing.

> **Not included (and why):** **GitHub Models** was retired 30 Jul 2026 (no live endpoint). **Cloudflare Workers AI** has a real free tier and is OpenAI-compatible, but its base URL embeds a per-account id (`…/accounts/{id}/ai/v1`), which the flat registry can't express — it'd need a templated base URL + an account-id field.

> Free-tier rate limits and pricing move often. Kosh only stores a sensible **default model** per provider —
> override it in Settings to track the latest. The `free` flag prices a provider at `$0` for the daily cap; it is
> not a promise the vendor's free tier is unlimited.

### Recommended picks

- **Best free, no card, good quality:** Google **Gemini** (`gemini-2.5-flash-lite`) — **the default**.
- **Best free + fastest:** **Groq** or **Cerebras**.
- **Most flexible:** **OpenRouter** (one key, many models, `:free` options).
- **Fully private:** **Ollama** (local, nothing leaves your machine).
- **Cheapest paid with great quality:** **DeepSeek**.
- **Highest quality:** **Anthropic Claude Haiku**.

---

## 3. Bring your own key (BYOK)

Each user can store their own key per provider in **Settings → AI provider → Your API key**:

- Keys are **encrypted at rest** (AES-256-GCM, the same `encryptSecret` used for GitHub/Drive tokens).
- The API **never returns a key** to the client — `publicUser` exposes only a per-provider **boolean**
  (`aiKeys: { gemini: true, ... }`) so the UI can show "saved" without ever handling the secret.
- A stored user key takes precedence over the server env key; removing it falls back to the server key (if any).

Routes (all `requireWrite`, so read-only API keys are rejected):

| Method | Route | Body | Effect |
|---|---|---|---|
| `PATCH` | `/api/settings/ai` | `{ provider?, model?, spendCap? }` | Select provider / override model (`""` clears) / set daily cap. Switching provider drops a stale model override. |
| `PUT` | `/api/settings/ai/keys/:provider` | `{ key }` | Store an encrypted BYOK key. |
| `DELETE` | `/api/settings/ai/keys/:provider` | — | Remove the stored key. |

All three return the refreshed `publicUser`.

---

## 4. Spend cap

The per-user **daily USD cap** (`aiSpendCap`, default from `AI_DAILY_CAP_USD`) applies to **paid** providers only.
Cost is estimated (~4 chars/token in + a fixed output budget) at the resolved provider's rates, **reserved before**
the call, and **refunded** if the model returns nothing usable (with a cross-day-boundary guard so a refund can
never subtract from a new day's fresh spend). Free-tier and local providers price at `$0`, so they never block.

---

## 5. Configuration (env)

```bash
# The provider new users start on (any id from the table above). Defaults to gemini
# (free tier, no credit card) — provide GEMINI_API_KEY, or switch this to a provider whose key you set.
AI_DEFAULT_PROVIDER=gemini
AI_DAILY_CAP_USD=2                 # per-user USD/day cap for PAID providers

# Optional SERVER FALLBACK keys (used when a user hasn't added their own):
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-4-5   # optional model override for the anthropic default
GEMINI_API_KEY=
GROQ_API_KEY=
CEREBRAS_API_KEY=
SAMBANOVA_API_KEY=
TOGETHER_API_KEY=
ZAI_API_KEY=
OPENROUTER_API_KEY=
MISTRAL_API_KEY=
DEEPSEEK_API_KEY=
DEEPINFRA_API_KEY=
FIREWORKS_API_KEY=
NVIDIA_API_KEY=
HUGGINGFACE_API_KEY=
OPENAI_API_KEY=
# OLLAMA_BASE_URL=http://localhost:11434/v1   # local, keyless
```

You can run **entirely on free providers**: set `AI_DEFAULT_PROVIDER=gemini` and provide `GEMINI_API_KEY`
(or leave server keys empty and let each user bring their own).

---

## 6. Adding a new provider

Add one row to `AI_PROVIDERS` in `apps/api/src/integrations/aiProviders.ts`:

```ts
{ id: "yourprovider", label: "Your Provider", transport: "openai",
  baseURL: "https://api.example.com/v1", defaultModel: "some-model",
  free: false, inPerM: 0.2, outPerM: 0.4, needsKey: true, hint: "where to get a key" }
```

If it's OpenAI-compatible, that's all — the `openai` transport handles it. Add the matching `env.X_API_KEY`
to `config.ai.keys` in `config.ts` and to `.env.example`. No other code changes are needed; the Settings
picker, BYOK routes, budget, and resolution all read from the registry.

---

## 7. Beyond LLMs — useful free API tools to consider next

Research into **free, low-friction APIs** that would complement Kosh (not yet integrated — candidates for
follow-up work):

- **Embeddings for semantic search.** Gemini (`text-embedding-004`) and Mistral both offer **free** embedding
  endpoints; Cloudflare Workers AI has a free allowance too. These would let Kosh do *meaning-based* search over
  saved items/skills, not just keyword search — a natural upgrade to the existing search.
- **OCR (image/PDF → text).** [OCR.space](https://ocr.space/ocrapi) (free, ~500 req/day),
  [Optiic](https://optiic.dev/) (free key, no card), and API Ninjas image-to-text. Useful for summarizing/tagging
  **image and scanned-PDF** uploads that currently have no text source.
- **Link preview / Open Graph unfurl.** [microlink.io](https://microlink.io/link-preview) (free, ~25 req/day),
  [opengraph.io](https://www.opengraph.io/link-preview-api) (100 free/mo). Richer link cards (title, image,
  favicon, site name) for saved links without writing our own scraper — enrichment stays a non-blocking follow-up
  patch, per the "link is saved first" rule.
- **Readability/article extraction.** Jina AI `r.jina.ai` (free reader that returns clean markdown for a URL) —
  a cheap way to get high-quality article text to feed the summarizer.
- **Safe-browsing / URL reputation.** Google Safe Browsing (free) to flag risky saved links, complementing the
  existing security scan on copied skills.

> Every server-side fetch of a user-supplied URL must still go through `safeFetch` (SSRF guard), per the build
> plan §5.3. External LLM/OCR endpoints in the registry use fixed base URLs (never user input), so the only
> user-controlled fields reaching a provider are the model string and the key.

Sources for the free-tier figures above:
[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) ·
[Groq models](https://console.groq.com/docs/models) ·
[Cerebras free tier](https://www.getaiperks.com/en/ai/cerebras-free-tier-guide) ·
[Free LLM APIs 2026](https://klymentiev.com/blog/free-llm-api) ·
[OCR.space](https://ocr.space/ocrapi) ·
[microlink](https://microlink.io/link-preview)
