import { beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { testDb, resetTestDb } from "@/lib/testDb";
import { parseB2CRequirement } from "./intake";
import { findSupplierCandidates } from "./check";
import { createB2CCase } from "./createCase";
import { runB2CBuyerResponse } from "./buyerResponse";

const SIGNING_SECRET = "test-secret";

function fakeIntakeClient(parsed: object) {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(parsed) } }] });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe("B2C end-to-end: intake -> check -> create -> accept -> commit", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("takes a raw requirement all the way to a committed case", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-COPPER-4MM", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });

    const client = fakeIntakeClient({
      itemDescription: "4mm copper wire", quantity: 500, unit: "metres",
      deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      location: "Bangalore", missingCriticalField: null,
    });
    const parsed = await parseB2CRequirement(client, "gpt-5-nano", "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore", 30_000);
    expect(parsed.missingCriticalField).toBeNull();

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-COPPER-4MM", quantity: parsed.quantity });
    expect(candidates).toHaveLength(1);
    const chosen = candidates[0]!;

    // Simulates a human negotiator getting a 10% discount off the listed price.
    const negotiatedBuyPriceMinor = Math.round(chosen.unitCostMinor * 0.9);

    const created = await createB2CCase(testDb, {
      buyerName: "Ramesh Traders", buyerPhone: "+91-90000-00000",
      sku: "SKU-COPPER-4MM", parsedRequirement: parsed,
      chosenSupplierId: chosen.supplierId,
      listedUnitCostMinor: chosen.unitCostMinor, listedLeadDays: chosen.leadDays,
      negotiatedBuyPriceMinor,
      operationalCostMinor: 1500_00, riskBufferBps: 500,
      buyerLinkSigningSecret: SIGNING_SECRET, traceId: "e2e-trace",
    });

    const result = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "e2e-trace" });
    expect(result.status).toBe("committed");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("committed");
    expect(dealCase.channel).toBe("b2c");

    const events = await testDb.caseEvent.findMany({ where: { caseId: created.caseId }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual([
      "b2c.requirement_parsed",
      "b2c.quote_accepted",
      "case.prepared",
      "commit.requested",
      "case.committed",
    ]);

    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: created.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("committed");

    const certificate = await testDb.commitCertificate.findFirstOrThrow({ where: { caseId: created.caseId, caseVersion: 1 } });
    expect(certificate.status).toBe("consumed");
  });
});
