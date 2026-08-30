import { beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { testDb, resetTestDb } from "@/lib/testDb";
import { generateNegotiationBrief } from "./negotiationBrief";
import { ToolError } from "@/lib/types";

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const LLM_REPLY = {
  marketPriceRangeNote: "Similar copper wire has traded 95-105 per unit recently.",
  suggestedOpeningUnitCostMinor: 85_00,
  negotiationLevers: ["Offer a repeat-order commitment", "Mention a competing quote at 90_00"],
};

describe("generateNegotiationBrief", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("computes BATNA from the other candidates and a walk-away price 8% below the listed price", async () => {
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] }]);
    const brief = await generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-1", itemDescription: "4mm copper wire", quantity: 500,
      deliveryDeadline: "2026-09-15", chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00,
      otherCandidates: [{ supplierId: "VEND-B", unitCostMinor: 95_00, leadDays: 12, availableQuantity: 500, freshnessTier: null, isStale: false }],
    });
    expect(brief.batna).toEqual([{ supplierId: "VEND-B", unitCostMinor: 95_00, leadDays: 12 }]);
    expect(brief.walkAwayUnitCostMinor).toBe(92_00);
    expect(brief.marketPriceRangeNote).toBe(LLM_REPLY.marketPriceRangeNote);
    expect(brief.suggestedOpeningUnitCostMinor).toBe(85_00);
    expect(brief.negotiationLevers).toEqual(LLM_REPLY.negotiationLevers);
  });

  it("returns null historical pricing when this supplier+sku has never been reserved before", async () => {
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] }]);
    const brief = await generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-NEW", itemDescription: "steel rod", quantity: 10,
      deliveryDeadline: "2026-09-15", chosenSupplierId: "VEND-NEW", chosenListedUnitCostMinor: 100_00,
      otherCandidates: [],
    });
    expect(brief.historicalPricing).toBeNull();
  });

  it("returns real historical pricing from a prior confirmed order with this exact supplier+sku", async () => {
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Old Buyer", phone: "+91-90000-00099" } });
    const priorCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "committed", createdBy: "test" } });
    await testDb.termsVersion.create({ data: { caseId: priorCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "SKU-HIST", quantity: 10, totalValueMinor: 200_00, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: new Date(), confirmedBuyPriceMinor: 88_00 } });
    await testDb.reservation.create({ data: { caseId: priorCase.id, caseVersion: 1, termsHash: "hash-1", domain: "supplier", resourceRef: "SUPPLIER:VEND-A:SKU-HIST", status: "committed", policyVersion: "supplier-policy-v1", expiresAt: new Date(Date.now() + 100_000), idempotencyKey: "hist-1" } });

    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] }]);
    const brief = await generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-HIST", itemDescription: "widget", quantity: 10,
      deliveryDeadline: "2026-09-15", chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00,
      otherCandidates: [],
    });
    expect(brief.historicalPricing).toEqual([{ unitCostMinor: 88_00, confirmedAt: expect.any(String) }]);
  });

  it("wraps a network failure as ToolError PROVIDER_UNAVAILABLE", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-1", itemDescription: "x", quantity: 1, deliveryDeadline: "2026-09-15",
      chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
    })).rejects.toThrow(ToolError);
  });

  it("wraps a non-JSON response as ToolError INVALID_INPUT", async () => {
    const client = fakeClient([{ choices: [{ message: { content: "not json" } }] }]);
    await expect(generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-1", itemDescription: "x", quantity: 1, deliveryDeadline: "2026-09-15",
      chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
    })).rejects.toThrow(ToolError);
  });
});
