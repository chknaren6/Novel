import { describe, it, expect, beforeEach, vi } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { getBuyerOffer } from "./buyerService";
import { createCounteroffer } from "@/workflow/counteroffer";

const SECRET = "test-secret";

async function seedOffer() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "negotiating", createdBy: "seed" } });
  await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
  return createCounteroffer(testDb, { caseId: dealCase.id, sourceTermsVersion: 1, sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "ADVANCE_30", deliveryDeadline: new Date("2026-09-12"), expiresInSeconds: 3600, buyerLinkSigningSecret: SECRET });
}

describe("getBuyerOffer", () => {
  beforeEach(resetTestDb);

  it("returns the source and proposed terms for a valid token", async () => {
    const { buyerToken } = await seedOffer();
    const offer = await getBuyerOffer(testDb, buyerToken, SECRET);
    expect(offer?.sourceTerms.paymentTerms).toBe("NET_60");
    expect(offer?.proposedTerms.paymentTerms).toBe("ADVANCE_30");
    expect(offer?.status).toBe("sent");
  });

  it("returns null for a token signed with the wrong secret", async () => {
    const { buyerToken } = await seedOffer();
    expect(await getBuyerOffer(testDb, buyerToken, "wrong-secret")).toBeNull();
  });

  it("returns null for a well-formed but unknown token", async () => {
    const { signBuyerToken } = await import("@/lib/hash");
    const unknownToken = signBuyerToken("case-does-not-exist:1", SECRET);
    expect(await getBuyerOffer(testDb, unknownToken, SECRET)).toBeNull();
  });

  it("does not pick up an unrelated TermsVersion row at a different version", async () => {
    const { buyerToken, counteroffer } = await seedOffer();
    // A third, unrelated version on the same case — neither the source nor the
    // proposed version for this counteroffer.
    await testDb.termsVersion.create({ data: { caseId: counteroffer.caseId, version: 99, source: "counteroffer", termsHash: "hash-decoy", sku: "MAT-99999", quantity: 1, totalValueMinor: 1, discountBps: 0, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
    const offer = await getBuyerOffer(testDb, buyerToken, SECRET);
    expect(offer?.sourceTerms.sku).toBe("MAT-10001");
    expect(offer?.proposedTerms.sku).toBe("MAT-10001");
  });

  it("returns null for a malformed token without throwing", async () => {
    await expect(getBuyerOffer(testDb, "not-a-real-token", SECRET)).resolves.toBeNull();
  });

  it("rethrows (and logs) a genuine DB failure instead of masking it as null", async () => {
    const { buyerToken } = await seedOffer();
    const dbError = new Error("connection reset");
    const findUniqueSpy = vi.spyOn(testDb.counteroffer, "findUnique").mockRejectedValueOnce(dbError);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getBuyerOffer(testDb, buyerToken, SECRET)).rejects.toThrow("connection reset");
    expect(consoleErrorSpy).toHaveBeenCalled();

    findUniqueSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
