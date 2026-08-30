import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "./createCase";

const BASE_INPUT: CreateB2CCaseInput = {
  buyerName: "Ramesh Traders",
  buyerPhone: "+91-90000-00000",
  sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire",
    quantity: 500,
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
  buyerLinkSigningSecret: "test-secret",
  traceId: "trace-1",
};

describe("createB2CCase", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
  });

  it("creates a priced case, holds the supplier reservation, and returns a signed buyer token", async () => {
    const result = await createB2CCase(testDb, BASE_INPUT);

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: result.caseId } });
    expect(dealCase.channel).toBe("b2c");
    expect(dealCase.status).toBe("evaluating");

    const terms = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: result.caseId, version: 1 } });
    expect(terms.paymentTerms).toBe("ADVANCE_VARIABLE");
    expect(terms.confirmedBuyPriceMinor).toBe(90_00);
    expect(terms.totalValueMinor).toBe(result.sellPriceMinor);

    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: result.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("held");

    const option = await testDb.supplierOption.findFirstOrThrow({ where: { supplierId: "VEND-A", sku: "SKU-1" } });
    expect(option.availableQuantity).toBe(500);

    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: result.caseId } });
    expect(counteroffer.status).toBe("sent");
  });

  it("reuses an existing MarketplaceBuyer by phone instead of creating a duplicate", async () => {
    await createB2CCase(testDb, BASE_INPUT);
    await testDb.supplierOption.updateMany({ where: { supplierId: "VEND-A" }, data: { availableQuantity: 1000 } });
    await createB2CCase(testDb, { ...BASE_INPUT, traceId: "trace-2" });
    const buyers = await testDb.marketplaceBuyer.findMany({ where: { phone: BASE_INPUT.buyerPhone } });
    expect(buyers).toHaveLength(1);
  });

  it("holds the reservation using the listed price as the ceiling, even when the negotiated price is lower", async () => {
    const result = await createB2CCase(testDb, { ...BASE_INPUT, listedUnitCostMinor: 100_00, negotiatedBuyPriceMinor: 80_00 });
    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: result.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("held");
  });

  it("leaves the case in cannot_commit with a case.cannot_commit event when the supplier hold fails", async () => {
    await testDb.supplierOption.updateMany({ where: { supplierId: "VEND-A", sku: "SKU-1" }, data: { unitCostMinor: 150_00 } });

    await expect(createB2CCase(testDb, { ...BASE_INPUT, listedUnitCostMinor: 100_00 })).rejects.toThrow();

    const dealCase = await testDb.dealCase.findFirstOrThrow();
    expect(dealCase.status).toBe("cannot_commit");

    const events = await testDb.caseEvent.findMany({ where: { caseId: dealCase.id } });
    expect(events.map((e) => e.eventType)).toContain("case.cannot_commit");
  });
});
