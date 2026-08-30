import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "./createCase";
import { runB2CBuyerResponse } from "./buyerResponse";

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
});
