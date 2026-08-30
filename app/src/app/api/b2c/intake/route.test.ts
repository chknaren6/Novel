import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

const mockCreate = vi.fn();
vi.mock("@/lib/openaiClient", () => ({
  getOpenAIClient: () => ({ client: { chat: { completions: { create: mockCreate } } }, modelId: "gpt-5-nano", timeoutMs: 30_000 }),
}));

import { testDb, resetTestDb } from "@/lib/testDb";
import { POST } from "./route";

const PARSED = {
  itemDescription: "4mm copper wire", quantity: 500, unit: "metres",
  deliveryDeadline: "2026-09-15", location: "Bangalore", missingCriticalField: null,
};

describe("POST /api/b2c/intake", () => {
  beforeEach(async () => {
    await resetTestDb();
    mockCreate.mockReset();
  });

  it("returns the parsed requirement and ranked candidates for a valid request", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(PARSED) } }] });

    const request = new Request("http://localhost/api/b2c/intake", {
      method: "POST",
      body: JSON.stringify({ rawText: "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore", sku: "SKU-1" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.parsedRequirement).toEqual(PARSED);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].supplierId).toBe("VEND-A");
  });

  it("returns 400 when rawText is missing", async () => {
    const request = new Request("http://localhost/api/b2c/intake", { method: "POST", body: JSON.stringify({ sku: "SKU-1" }) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 502 when the LLM call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));
    const request = new Request("http://localhost/api/b2c/intake", { method: "POST", body: JSON.stringify({ rawText: "some text", sku: "SKU-1" }) });
    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
