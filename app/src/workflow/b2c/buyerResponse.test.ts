import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "./createCase";
import { runB2CBuyerResponse } from "./buyerResponse";
import { signBuyerToken, hashBuyerToken } from "@/lib/hash";

const SIGNING_SECRET = "test-secret";

const BASE_INPUT: CreateB2CCaseInput = {
  buyerName: "Ramesh Traders",
  buyerPhone: "+91-90000-00000",
  sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire",
    quantity: 10,
    unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore",
    missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A",
  listedUnitCostMinor: 100_00,
  listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00,
  operationalCostMinor: 1500_00,
  riskBufferBps: 500,
  buyerLinkSigningSecret: SIGNING_SECRET,
  traceId: "trace-1",
};

describe("runB2CBuyerResponse", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
  });

  it("accepting a quote prepares a certificate and commits the case", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const result = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result.status).toBe("committed");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("committed");
  });

  it("rejecting a quote fails the case closed and releases the held reservation", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const result = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "reject", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result.status).toBe("cannot_commit");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("cannot_commit");
    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: created.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("released");
  });

  it("a tampered token is rejected as invalid_or_expired with no mutation", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const result = await runB2CBuyerResponse(testDb, { buyerToken: `${created.buyerToken}-tampered`, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result.status).toBe("invalid_or_expired");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("evaluating");
  });

  it("replaying an already-accepted token returns the same committed result instead of re-mutating", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const first = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    const second = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-3" });
    expect(second).toEqual(first);
  });

  it("replaying an accept token after escalation returns the escalated result instead of re-mutating", async () => {
    // Manually construct an already-escalated case with an already-accepted counteroffer
    // (mirroring commit.test.ts's seedPreparedB2CCase-style construction), rather than
    // trying to force runB2CCommit's internal commitOrder call to fail from behind the
    // buyer-response entry point — that would require reaching into reservation/adapter
    // internals just to reproduce a state this test can construct directly and reliably.
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00002" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "escalated", createdBy: "test" },
    });
    const buyerToken = signBuyerToken(`${dealCase.id}:1`, SIGNING_SECRET);
    await testDb.counteroffer.create({
      data: {
        caseId: dealCase.id,
        sourceTermsVersion: 1,
        proposedTermsVersion: 1,
        tokenHash: hashBuyerToken(buyerToken),
        status: "accepted",
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        respondedAt: new Date(),
      },
    });

    const result = await runB2CBuyerResponse(testDb, { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result).toEqual({ status: "escalated", reason: "duplicate_accept_after_escalation" });

    const replay = await runB2CBuyerResponse(testDb, { buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-3" });
    expect(replay).toEqual(result);
  });
});
