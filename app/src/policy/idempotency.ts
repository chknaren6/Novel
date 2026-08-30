import { createHash } from "node:crypto";

export interface IdempotencyKeyInput {
  caseId: string;
  caseVersion: number;
  actionType: string;
  resourceRef: string;
}

// Deterministic idempotency key derived from case, version, action type, and resource
// (02-TECHNICAL-SPEC.md "Transaction strategy"). Retries pass the identical input and
// therefore reuse the identical key, which is what lets the receipt table dedupe them.
export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const canonical = `${input.caseId}:${input.caseVersion}:${input.actionType}:${input.resourceRef}`;
  return createHash("sha256").update(canonical).digest("hex");
}
