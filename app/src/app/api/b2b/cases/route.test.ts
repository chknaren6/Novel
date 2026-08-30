import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_DESK_COMMITTED, FIXTURE_DESK_NEGOTIATING } from "@/fixtures/deskDemoDefinitions";
import { GET } from "./route";

describe("GET /api/b2b/cases", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("lists every b2b case still at intake, with inbox summary fields", async () => {
    await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    await seedFixture(testDb, FIXTURE_DESK_NEGOTIATING);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.cases).toHaveLength(2);
    type CaseSummary = {
      caseId: string;
      customerName: string;
      companyName: string;
      sku: string;
      quantity: number;
      totalValueMinor: number;
      paymentTerms: string;
      deliveryDeadline: string;
    };
    const bySku = new Map<string, CaseSummary>(body.cases.map((c: CaseSummary) => [c.sku, c]));

    const committed = bySku.get(FIXTURE_DESK_COMMITTED.initialTerms.sku);
    expect(committed).toMatchObject({
      customerName: FIXTURE_DESK_COMMITTED.customer.name,
      companyName: FIXTURE_DESK_COMMITTED.companyName,
      sku: FIXTURE_DESK_COMMITTED.initialTerms.sku,
      quantity: FIXTURE_DESK_COMMITTED.initialTerms.quantity,
      totalValueMinor: FIXTURE_DESK_COMMITTED.initialTerms.totalValueMinor,
      paymentTerms: FIXTURE_DESK_COMMITTED.initialTerms.paymentTerms,
    });
    expect(committed?.caseId).toBeTruthy();
    expect(committed?.deliveryDeadline).toBeTruthy();

    const negotiating = bySku.get(FIXTURE_DESK_NEGOTIATING.initialTerms.sku);
    expect(negotiating).toMatchObject({
      customerName: FIXTURE_DESK_NEGOTIATING.customer.name,
      companyName: FIXTURE_DESK_NEGOTIATING.companyName,
      sku: FIXTURE_DESK_NEGOTIATING.initialTerms.sku,
      quantity: FIXTURE_DESK_NEGOTIATING.initialTerms.quantity,
      totalValueMinor: FIXTURE_DESK_NEGOTIATING.initialTerms.totalValueMinor,
      paymentTerms: FIXTURE_DESK_NEGOTIATING.initialTerms.paymentTerms,
    });
  });

  it("excludes a case that has moved past intake", async () => {
    await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    await seedFixture(testDb, FIXTURE_DESK_NEGOTIATING);

    const movedOn = await testDb.dealCase.findFirstOrThrow({
      where: { fixtureId: FIXTURE_DESK_NEGOTIATING.fixtureId },
    });
    await testDb.dealCase.update({ where: { id: movedOn.id }, data: { status: "evaluating" } });

    const response = await GET();
    const body = await response.json();

    expect(body.cases).toHaveLength(1);
    expect(body.cases[0].sku).toBe(FIXTURE_DESK_COMMITTED.initialTerms.sku);
  });
});
