import OpenAI from "openai";

// Single place that reads the OpenAI env vars and constructs a client — every route
// handler that needs a real LLM call (intake parsing, negotiation briefs) goes through
// this instead of constructing its own client, so a missing env var fails loudly here,
// once, instead of surfacing as a confusing downstream SDK error.
export function getOpenAIClient(): { client: OpenAI; modelId: string; timeoutMs: number } {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelId = process.env.OPENAI_MODEL_ID;
  if (!apiKey) throw new Error("getOpenAIClient: OPENAI_API_KEY is not set");
  if (!modelId) throw new Error("getOpenAIClient: OPENAI_MODEL_ID is not set");
  const timeoutMsRaw = process.env.OPENAI_REQUEST_TIMEOUT_MS;
  let timeoutMs = 30_000;
  if (timeoutMsRaw) {
    const parsed = Number(timeoutMsRaw);
    if (!Number.isFinite(parsed)) throw new Error(`getOpenAIClient: OPENAI_REQUEST_TIMEOUT_MS is not a valid number: "${timeoutMsRaw}"`);
    timeoutMs = parsed;
  }
  // timeoutMs is returned as data, not applied here — every caller threads it into its
  // own per-request `{ timeout: timeoutMs }` option (see src/workflow/b2c/intake.ts's
  // parseB2CRequirement for the established pattern), not a client-level default. Two
  // sources of timeout enforcement (constructor + per-call) would be redundant and could
  // silently disagree.
  return { client: new OpenAI({ apiKey }), modelId, timeoutMs };
}
