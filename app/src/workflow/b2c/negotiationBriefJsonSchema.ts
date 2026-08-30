// Hand-written JSON Schema mirror of the LLM-produced fields in NegotiationBrief
// (negotiationBrief.ts) — BATNA, walk-away price, and historical pricing are computed
// deterministically from real data and are never asked of the model. Same OpenAI
// structured-outputs strict-mode convention as
// src/workflow/b2c/parsedRequirementJsonSchema.ts.
//
// One intentional gap: NegotiationBriefLlmSchema.suggestedOpeningUnitCostMinor is
// `z.number().int().positive()` in Zod, but this schema only declares
// `{ type: "integer" }` — OpenAI's strict-mode JSON Schema subset does not reliably
// support numeric bounds like `minimum`, so the positivity refinement is not (and cannot
// be) mirrored here. NegotiationBriefLlmSchema.safeParse() downstream is the actual
// source of truth and will reject a non-positive value.
export const NEGOTIATION_BRIEF_LLM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marketPriceRangeNote: { type: "string" },
    suggestedOpeningUnitCostMinor: { type: "integer" },
    negotiationLevers: { type: "array", items: { type: "string" } },
  },
  required: ["marketPriceRangeNote", "suggestedOpeningUnitCostMinor", "negotiationLevers"],
} as const;
