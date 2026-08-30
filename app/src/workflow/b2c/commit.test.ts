import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runB2CCommit } from "./commit";
import { prepareCommitCertificate } from "@/reservations/coordinator";
import { createHeldReservation } from "@/reservations/reservationStore";
import { canonicalTermsHash } from "@/lib/hash";
import { B2C_REQUIRED_DOMAINS } from "./constants";

async function seedPreparedB2CCase() {
  const company = await testDb.company.create({ data: { name: "CommitOS" } });
  const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "prepared", createdBy: "test" },
  });
  const deliveryDeadline = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const termsHash = canonicalTermsHash({ sku: "SKU-1", quantity: 10, totalValueMinor: 1_325_000, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: deliveryDeadline.toISOString() });
  await testDb.termsVersion.create({
    data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash, sku: "SKU-1", quantity: 10, totalValueMinor: 1_325_000, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline, advanceBps: 10_000, confirmedBuyPriceMinor: 100_000 },
  });
  const reservation = await createHeldReservation(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash, domain: "supplier", resourceRef: "SUPPLIER:VEND-A:SKU-1", quantityMinor: 10, limitMinor: null, policyVersion: "supplier-policy-v1", ttlSeconds: 43_200, idempotencyKey: `test-${dealCase.id}` });
  const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash, reservationIds: [reservation.id], requiredDomains: B2C_REQUIRED_DOMAINS });
  return { dealCase, certificate };
}

describe("runB2CCommit", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("commits a prepared B2C case using the terms row's own negotiated buy price and advance", async () => {
    const { dealCase } = await seedPreparedB2CCase();
    const result = await runB2CCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("expected committed");
    // advanceBps 10_000 (100%) of totalValueMinor 1_325_000 -> full amount as deposit
    expect(result.depositMinor).toBe(1_325_000);

    const updatedCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(updatedCase.status).toBe("committed");
  });

  it("escalates instead of committing when the certificate has already expired", async () => {
    const { dealCase, certificate } = await seedPreparedB2CCase();
    await testDb.commitCertificate.update({ where: { id: certificate.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    const result = await runB2CCommit(testDb, { caseId: dealCase.id, traceId: "trace-2" });
    expect(result.status).toBe("escalated");

    const updatedCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(updatedCase.status).toBe("escalated");
  });
});
