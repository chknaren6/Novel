// A hand-written JSON Schema mirror of ParsedRequirementSchema (intake.ts), shaped for
// OpenAI structured outputs strict mode — same convention as
// src/gateway/roleModelOutputJsonSchema.ts.
//
// One intentional gap: ParsedRequirementSchema.quantity is `z.number().int().positive()`
// in Zod, but this schema only declares `{ type: "integer" }` — OpenAI's strict-mode JSON
// Schema subset does not reliably support numeric bounds like `minimum`, so the positivity
// refinement is not (and cannot be) mirrored here. That's fine: this schema only needs to
// get the model to emit the right *shape*; ParsedRequirementSchema.parse() downstream is the
// actual source of truth and will reject a non-positive quantity.
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
