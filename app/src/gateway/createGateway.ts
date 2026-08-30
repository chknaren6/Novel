import OpenAI from "openai";
import { OpenAIModelGateway } from "./openaiGateway";
import type { ModelGateway } from "./modelGateway";

// Fails fast when the required secret is missing rather than silently degrading.
// Called on first use of a role-agent route rather than at server boot, since
// Next.js route handlers have no single startup hook in this stack.
export function createModelGateway(): ModelGateway {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const modelId = process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini";
  return new OpenAIModelGateway(new OpenAI({ apiKey }), modelId);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
