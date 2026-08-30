import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { fromJsonColumn } from "@/lib/json-column";
import { seedFixture } from "./seedFixture";
import { ALL_FIXTURES, FIXTURE_FEASIBLE_AFTER_ADVANCE } from "./definitions";

describe("seedFixture", () => {
  beforeEach(resetTestDb);

  it("creates a case tagged with the fixture id and its world-state rows", async () => {
    const { dealCase, customer } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    expect(dealCase.fixtureId).toBe("CASE-FEASIBLE-AFTER-ADVANCE");
    expect(dealCase.status).toBe("intake");

    const terms = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: 1 } });
    expect(terms.quantity).toBe(350);
    expect(terms.paymentTerms).toBe("NET_60");

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199);
    expect(customer.creditLimitMinor).toBe(200_000_000);
  });

  it("is re-runnable: seeding the same fixture twice resets it instead of duplicating it", async () => {
    const first = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.dealCase.update({ where: { id: first.dealCase.id }, data: { status: "committed" } });
    const second = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);

    expect(second.dealCase.status).toBe("intake"); // reset, not left as "committed"
    const cases = await testDb.dealCase.findMany({ where: { fixtureId: "CASE-FEASIBLE-AFTER-ADVANCE" } });
    expect(cases).toHaveLength(1); // no duplicate row
  });

  it("round-trips allowedPaymentTerms through the JSON-string column, not just without throwing", async () => {
    const { customer } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const stored = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(fromJsonColumn<string[]>(stored.allowedPaymentTerms)).toEqual(["ADVANCE_30", "OTHER_BOUNDED"]);
  });

  it("seeds all three fixtures in one run without colliding, even though CASE-STALE-SUPPLIER-HOLD shares its sku/supplierId/planId with CASE-FEASIBLE-AFTER-ADVANCE", async () => {
    for (const fixture of ALL_FIXTURES) {
      const { dealCase } = await seedFixture(testDb, fixture);
      expect(dealCase.fixtureId).toBe(fixture.fixtureId);
    }
    const cases = await testDb.dealCase.findMany();
    expect(cases).toHaveLength(3);
    const plans = await testDb.deliveryPlanOption.findMany({ where: { planId: "RT-BLR-HYD" } });
    expect(plans).toHaveLength(1); // shared plan reset in place, not duplicated
  });
});
