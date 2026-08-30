import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { POST } from "./route";

const BASE_BODY = {
  buyerName: "Ramesh Traders", buyerPhone: "+91-90000-00000", sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire", quantity: 10, unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore", missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A", listedUnitCostMinor: 100_00, listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00, operationalCostMinor: 1500_00, riskBufferBps: 500,
};

describe("POST /api/b2c/cases", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    process.env.BUYER_LINK_SIGNING_SECRET = "test-secret";
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  it("creates a case and returns a buyer link", async () => {
    const request = new Request("http://localhost/api/b2c/cases", { method: "POST", body: JSON.stringify(BASE_BODY) });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.caseId).toBeTruthy();
    expect(body.buyerLink).toContain("/market/");
    expect(body.buyerLink).toContain("/accept?token=");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: body.caseId } });
    expect(dealCase.channel).toBe("b2c");
  });

  it("returns 400 when the supplier hold fails (price moved)", async () => {
    const request = new Request("http://localhost/api/b2c/cases", { method: "POST", body: JSON.stringify({ ...BASE_BODY, listedUnitCostMinor: 10_00 }) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const request = new Request("http://localhost/api/b2c/cases", { method: "POST", body: "not-json{{{" });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when a required field is missing", async () => {
    const { buyerName, ...withoutBuyerName } = BASE_BODY;
    const request = new Request("http://localhost/api/b2c/cases", { method: "POST", body: JSON.stringify(withoutBuyerName) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
