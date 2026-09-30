import { beginAiCall, refundBudget, AiBudgetError, AiNotConfiguredError } from "../integrations/claude.js";
import { completeWith } from "../integrations/aiProviders.js";

/**
 * Run an arbitrary prompt against the user's selected provider — the primitive behind the Prompt
 * Playground (single run, A/B, batch test). Budget-metered like every other AI call; degrades to a
 * structured "not available / cap reached" result rather than throwing so the UI can explain it.
 */

export interface CompletionResult {
  output: string | null;
  aiAvailable: boolean;
  capReached?: boolean;
}

// The prompt body is the user's own text, but treat it as data for a safe default system framing.
const DEFAULT_SYSTEM = "You are a helpful assistant. Follow the user's prompt directly and concisely.";

export async function runCompletion(userId: string, prompt: string, system?: string, maxTokens = 800): Promise<CompletionResult> {
  const sys = (system ?? DEFAULT_SYSTEM).slice(0, 4000);
  let ctx, reservedDate: string, estCost: number;
  try {
    ({ ctx, reservedDate, estCost } = await beginAiCall(userId, sys.length + prompt.length, maxTokens));
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return { output: null, aiAvailable: false };
    if (e instanceof AiBudgetError) return { output: null, aiAvailable: true, capReached: true };
    throw e;
  }
  const output = await completeWith(ctx, { system: sys, prompt, maxTokens });
  if (!output) {
    await refundBudget(userId, estCost, reservedDate, ctx.byok);
    return { output: null, aiAvailable: true };
  }
  return { output, aiAvailable: true };
}
