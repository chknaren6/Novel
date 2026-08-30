// A hand-written JSON Schema mirror of RoleModelOutputSchema (src/lib/types.ts),
// shaped for OpenAI structured outputs strict mode: every object sets
// additionalProperties:false and lists every property as required.
//
// Verified field-by-field against RoleModelOutputSchema (2026-08-30): every property,
// enum member, and required list here matches the Zod schema exactly. No drift found.
// One intentional gap: ReservationRequestSchema.ttlSeconds is `z.number().int().positive()`
// in Zod, but this schema only declares `{ type: "integer" }` — OpenAI's strict-mode JSON
// Schema subset does not reliably support numeric bounds like `minimum`, so the positivity
// refinement is not (and cannot be) mirrored here. That's fine: this schema only needs to
// get the model to emit the right *shape*; RoleModelOutputSchema.parse() downstream is the
// actual source of truth and will reject a non-positive ttlSeconds.
export const ROLE_MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approve", "counter", "veto", "unavailable"] },
    constraints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: { type: "string", enum: ["sales", "finance", "inventory", "procurement", "logistics", "risk"] },
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "blocking"] },
          message: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["domain", "code", "severity", "message", "evidenceRefs"],
      },
    },
    reservationRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: { type: "string", enum: ["credit", "inventory", "supplier", "logistics"] },
          resourceRef: { type: "string" },
          quantity: { type: ["integer", "null"] },
          limitMinor: { type: ["integer", "null"] },
          ttlSeconds: { type: "integer" },
        },
        required: ["domain", "resourceRef", "quantity", "limitMinor", "ttlSeconds"],
      },
    },
    counterterms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: ["payment_terms", "quantity", "delivery_deadline", "discount_bps"] },
          proposedValue: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["field", "proposedValue", "rationale"],
      },
    },
    evidenceRefs: { type: "array", items: { type: "string" } },
    explanation: { type: "string" },
  },
  required: ["decision", "constraints", "reservationRequests", "counterterms", "evidenceRefs", "explanation"],
} as const;
