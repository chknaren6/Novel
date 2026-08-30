import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "@/workflow/b2c/createCase";
import { POST } from "./route";

const SIGNING_SECRET = "test-secret";
const BASE_INPUT: CreateB2CCaseInput = {
  buyerName: "Ramesh Traders", buyerPhone: "+91-90000-00000", sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire", quantity: 10, unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore", missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A", listedUnitCostMinor: 100_00, listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00, operationalCostMinor: 1500_00, riskBufferBps: 500,
  buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-1",
};

describe("POST /api/b2c/cases/[id]/respond", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    process.env.BUYER_LINK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("accepts a quote and returns the committed result", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const request = new Request(`http://localhost/api/b2c/cases/${created.caseId}/respond`, {
      method: "POST",
      body: JSON.stringify({ buyerToken: created.buyerToken, response: "accept" }),
    });
    const response = await POST(request, { params: { id: created.caseId } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.status).toBe("committed");
  });

  it("returns 400 for an invalid response value", async () => {
    const request = new Request("http://localhost/api/b2c/cases/x/respond", { method: "POST", body: JSON.stringify({ buyerToken: "t", response: "maybe" }) });
    const response = await POST(request, { params: { id: "x" } });
    expect(response.status).toBe(400);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const request = new Request("http://localhost/api/b2c/cases/x/respond", { method: "POST", body: "not-json{{{" });
    const response = await POST(request, { params: { id: "x" } });
    expect(response.status).toBe(400);
  });
});
