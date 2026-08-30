import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";

describe("B2C foundation schema additions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a MarketplaceBuyer independent of Customer/Company", async () => {
    const buyer = await testDb.marketplaceBuyer.create({
      data: { name: "Ramesh Traders", phone: "+91-90000-00000" },
    });
    expect(buyer.id).toBeTruthy();
    expect(buyer.email).toBeNull();
  });

  it("lets a DealCase.customerId point at a MarketplaceBuyer id with no FK conflict", async () => {
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: buyer.id, activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });
    expect(dealCase.customerId).toBe(buyer.id);
  });

  it("stores advanceBps and confirmedBuyPriceMinor on TermsVersion, nullable by default", async () => {
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: buyer.id, activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });
    const withoutAdvance = await testDb.termsVersion.create({
      data: {
        caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1",
        sku: "SKU-1", quantity: 1, totalValueMinor: 100_00, discountBps: 0,
        paymentTerms: "NET_60", deliveryDeadline: new Date(),
      },
    });
    expect(withoutAdvance.advanceBps).toBeNull();
    expect(withoutAdvance.confirmedBuyPriceMinor).toBeNull();

    const withAdvance = await testDb.termsVersion.create({
      data: {
        caseId: dealCase.id, version: 2, source: "buyer_request", termsHash: "hash-2",
        sku: "SKU-1", quantity: 1, totalValueMinor: 100_00, discountBps: 0,
        paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: new Date(),
        advanceBps: 7000, confirmedBuyPriceMinor: 85_00,
      },
    });
    expect(withAdvance.advanceBps).toBe(7000);
    expect(withAdvance.confirmedBuyPriceMinor).toBe(85_00);
  });

  it("stores freshnessTier and lastVerifiedAt on SupplierOption, nullable by default", async () => {
    const withoutFreshness = await testDb.supplierOption.create({
      data: { supplierId: "VEND-1", sku: "SKU-1", availableQuantity: 10, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available" },
    });
    expect(withoutFreshness.freshnessTier).toBeNull();

    const withFreshness = await testDb.supplierOption.create({
      data: {
        supplierId: "VEND-2", sku: "SKU-1", availableQuantity: 10, unitCostMinor: 100, leadDays: 5,
        optionTtlSeconds: 900, status: "available", freshnessTier: "tier2", lastVerifiedAt: new Date(),
      },
    });
    expect(withFreshness.freshnessTier).toBe("tier2");
    expect(withFreshness.lastVerifiedAt).toBeInstanceOf(Date);
  });
});
