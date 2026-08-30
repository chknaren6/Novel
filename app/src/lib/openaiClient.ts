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
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 30_000;
  return { client: new OpenAI({ apiKey }), modelId, timeoutMs };
}
