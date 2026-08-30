import type OpenAI from "openai";
import { z } from "zod";
import { ToolError } from "@/lib/types";
import { PARSED_REQUIREMENT_JSON_SCHEMA } from "./parsedRequirementJsonSchema";

export const ParsedRequirementSchema = z.object({
  itemDescription: z.string(),
  quantity: z.number().int().positive(),
  unit: z.string(),
  deliveryDeadline: z.string(),
  location: z.string(),
  missingCriticalField: z.string().nullable(),
});
export type ParsedRequirement = z.infer<typeof ParsedRequirementSchema>;

const INTAKE_SYSTEM_PROMPT =
  "You are the intake parser for a B2C industrial-goods marketplace. Extract a " +
  "structured requirement from the buyer's raw message: item description, quantity, " +
  "unit, delivery deadline, and location. If a critical field (item, quantity, or " +
  "delivery deadline) is missing or too vague to act on, set missingCriticalField to a " +
  "short description of what's missing rather than guessing; otherwise set it to null.";

// One bounded, tool-free structured-output call — not routed through ModelGateway.runRole,
// since that interface is typed around the six-role RoleModelOutput decision vocabulary
// (approve/counter/veto/unavailable), which doesn't fit "extract structured fields from
// free text" at all. Error handling mirrors OpenAIModelGateway's final-response handling
// (src/gateway/openaiGateway.ts) exactly, for the same reasons.
export async function parseB2CRequirement(
  client: OpenAI,
  modelId: string,
  rawText: string,
  timeoutMs: number,
): Promise<ParsedRequirement> {
  let response;
  try {
    response = await client.chat.completions.create(
      {
        model: modelId,
        messages: [
          { role: "system", content: INTAKE_SYSTEM_PROMPT },
          { role: "user", content: rawText },
        ],
        response_format: { type: "json_schema", json_schema: { name: "parsed_requirement", strict: true, schema: PARSED_REQUIREMENT_JSON_SCHEMA } },
      },
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new ToolError("PROVIDER_UNAVAILABLE", `Intake parse call failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  const raw = response.choices[0]!.message.content ?? "{}";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new ToolError("INVALID_INPUT", `Intake parse response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, false);
  }
  const parsed = ParsedRequirementSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ToolError("INVALID_INPUT", `Intake parse response failed validation: ${parsed.error.message}`, false);
  }
  return parsed.data;
}
