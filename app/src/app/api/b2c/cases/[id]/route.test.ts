import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { GET } from "./route";

describe("GET /api/b2c/cases/[id]", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns the derived state and event list for an existing case", async () => {
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "evaluating", createdBy: "test" } });
    await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "SKU-1", quantity: 10, totalValueMinor: 1_325_000, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: new Date() } });
    await testDb.caseEvent.create({ data: { caseId: dealCase.id, sequence: 1, eventType: "b2c.requirement_parsed", caseVersion: 1, actorType: "operator", actorRef: "b2c-intake", payload: "{}", traceId: "t1" } });

    const response = await GET(new Request(`http://localhost/api/b2c/cases/${dealCase.id}`), { params: { id: dealCase.id } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.stage).toBe("awaiting_buyer_response");
    expect(body.eventTypes).toEqual(["b2c.requirement_parsed"]);
  });

  it("returns 404 for an unknown case id", async () => {
    const response = await GET(new Request("http://localhost/api/b2c/cases/nonexistent"), { params: { id: "nonexistent" } });
    expect(response.status).toBe(404);
  });
});
