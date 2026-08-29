import { describe, it, expect } from "vitest";
import { canonicalTermsHash, signBuyerToken, hashBuyerToken } from "./hash";

describe("canonicalTermsHash", () => {
  it("is stable for the same terms regardless of key order", () => {
    const a = canonicalTermsHash({
      sku: "MAT-10001",
      quantity: 350,
      totalValueMinor: 147_000_000,
      discountBps: 1000,
      paymentTerms: "NET_60",
      deliveryDeadline: "2026-09-12T00:00:00.000Z",
    });
    const b = canonicalTermsHash({
      deliveryDeadline: "2026-09-12T00:00:00.000Z",
      paymentTerms: "NET_60",
      discountBps: 1000,
      totalValueMinor: 147_000_000,
      quantity: 350,
      sku: "MAT-10001",
    });
    expect(a).toBe(b);
  });

  it("changes when a material field changes", () => {
    const base = { sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60" as const, deliveryDeadline: "2026-09-12T00:00:00.000Z" };
    const changed = canonicalTermsHash({ ...base, paymentTerms: "ADVANCE_30" });
    expect(canonicalTermsHash(base)).not.toBe(changed);
  });
});

describe("buyer token signing", () => {
  it("hashes a signed token deterministically for the same secret", () => {
    const secret = "test-secret";
    const token = signBuyerToken("offer-123", secret);
    expect(hashBuyerToken(token)).toBe(hashBuyerToken(token));
  });

  it("produces different tokens for different offers", () => {
    const secret = "test-secret";
    expect(signBuyerToken("offer-1", secret)).not.toBe(signBuyerToken("offer-2", secret));
  });
});
