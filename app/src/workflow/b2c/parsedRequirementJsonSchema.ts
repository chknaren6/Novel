// A hand-written JSON Schema mirror of ParsedRequirementSchema (intake.ts), shaped for
// OpenAI structured outputs strict mode — same convention as
// src/gateway/roleModelOutputJsonSchema.ts.
export const PARSED_REQUIREMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemDescription: { type: "string" },
    quantity: { type: "integer" },
    unit: { type: "string" },
    deliveryDeadline: { type: "string" },
    location: { type: "string" },
    missingCriticalField: { type: ["string", "null"] },
  },
  required: ["itemDescription", "quantity", "unit", "deliveryDeadline", "location", "missingCriticalField"],
} as const;
