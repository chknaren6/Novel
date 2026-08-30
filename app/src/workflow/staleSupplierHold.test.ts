import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse } from "./buyerResponse";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_STALE_SUPPLIER_HOLD } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const SECRET = "test-secret";
const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

function script(input: RoleRunInput) {
  switch (input.role) {
    case "finance":
      if (input.contextSummary.requestedPaymentTerms === "NET_60") {
        return {
          toolCall: null,
          output: {
            decision: "counter" as const,
            constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
            reservationRequests: [],
            counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
            evidenceRefs: ["EVID-FIN"],
            explanation: "Net-60 breaches policy.",
          },
        };
      }
      return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "OK") };
    case "inventory":
      return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
    case "procurement":
      // ttlSeconds: 0 — this hold is already expired by the time prepareCommitCertificate checks it.
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 0 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

describe("CASE-STALE-SUPPLIER-HOLD", () => {
  beforeEach(resetTestDb);

  it("never mints or consumes a certificate and fails closed to cannot_commit", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_STALE_SUPPLIER_HOLD);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t2", buyerLinkSigningSecret: SECRET });
    expect(result.status).toBe("cannot_commit");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");

    const certificates = await testDb.commitCertificate.findMany({ where: { caseId: dealCase.id } });
    expect(certificates).toHaveLength(0); // never minted, let alone consumed

    const reservations = await testDb.reservation.findMany({ where: { caseId: dealCase.id, caseVersion: 2 } });
    expect(reservations.length).toBeGreaterThan(0);
    expect(reservations.every((r) => r.status === "released")).toBe(true); // inventory, credit, and logistics holds all released exactly once

    expect(await testDb.stripeCheckoutMock.count({ where: { caseId: dealCase.id } })).toBe(0);
    expect(await testDb.outboxMessage.count({ where: { caseId: dealCase.id, messageType: "backed_promise" } })).toBe(0);

    const events = await testDb.caseEvent.findMany({ where: { caseId: dealCase.id, eventType: "case.cannot_commit" } });
    expect(events).toHaveLength(1);
    expect(String(events[0]!.payload)).toMatch(/RESERVATION_EXPIRED/);
  });
});
