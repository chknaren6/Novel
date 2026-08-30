// Hand-written JSON Schema mirror of the LLM-produced fields in NegotiationBrief
// (negotiationBrief.ts) — BATNA, walk-away price, and historical pricing are computed
// deterministically from real data and are never asked of the model. Same OpenAI
// structured-outputs strict-mode convention as
// src/workflow/b2c/parsedRequirementJsonSchema.ts.
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
