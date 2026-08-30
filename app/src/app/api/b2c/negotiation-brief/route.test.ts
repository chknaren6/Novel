import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

const mockCreate = vi.fn();
vi.mock("@/lib/openaiClient", () => ({
  getOpenAIClient: () => ({ client: { chat: { completions: { create: mockCreate } } }, modelId: "gpt-5-nano", timeoutMs: 30_000 }),
}));

import { resetTestDb } from "@/lib/testDb";
import { POST } from "./route";

const LLM_REPLY = { marketPriceRangeNote: "note", suggestedOpeningUnitCostMinor: 85_00, negotiationLevers: ["lever one"] };

describe("POST /api/b2c/negotiation-brief", () => {
  beforeEach(async () => {
    await resetTestDb();
    mockCreate.mockReset();
  });

  it("returns a brief for a valid request", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] });
    const request = new Request("http://localhost/api/b2c/negotiation-brief", {
      method: "POST",
      body: JSON.stringify({
        sku: "SKU-1", itemDescription: "4mm copper wire", quantity: 500, deliveryDeadline: "2026-09-15",
        chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.brief.walkAwayUnitCostMinor).toBe(92_00);
    expect(body.brief.marketPriceRangeNote).toBe("note");
  });

  it("returns 400 when a required field is missing", async () => {
    const request = new Request("http://localhost/api/b2c/negotiation-brief", { method: "POST", body: JSON.stringify({ sku: "SKU-1" }) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const request = new Request("http://localhost/api/b2c/negotiation-brief", { method: "POST", body: "not-json{{{" });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 502 when the LLM call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));
    const request = new Request("http://localhost/api/b2c/negotiation-brief", {
      method: "POST",
      body: JSON.stringify({
        sku: "SKU-1", itemDescription: "x", quantity: 1, deliveryDeadline: "2026-09-15",
        chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
