import { describe, it, expect } from "vitest";
import { deriveIdempotencyKey } from "./idempotency";

describe("deriveIdempotencyKey", () => {
  const base = { caseId: "CASE-1", caseVersion: 1, actionType: "hold_inventory", resourceRef: "SKU:MAT-10001:WH-BLR" };

  it("is stable for identical input (a retry reuses the same key)", () => {
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey({ ...base }));
  });

  it("changes when the case version changes", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, caseVersion: 2 }));
  });

  it("changes when the action type changes", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, actionType: "hold_supplier_option" }));
  });

  it("changes when the resource reference changes", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, resourceRef: "SKU:MAT-10001:WH-MUM" }));
  });
});
