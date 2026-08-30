import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { listCases, getCaseDetail, sendQuote } from "./casesService";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { runBuyerResponse } from "@/workflow/buyerResponse";
import { createCounteroffer } from "@/workflow/counteroffer";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const SECRET = "test-secret";
const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

// Same script as buyerResponse.test.ts: drives the fixture to a real "negotiating"
// state (finance counters Net-60 with a 30% advance), then buyer acceptance commits.
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
      return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
    case "inventory":
      return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
    case "procurement":
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

describe("casesService", () => {
  beforeEach(resetTestDb);

  it("listCases returns every seeded case", async () => {
    await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const cases = await listCases(testDb);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.fixtureId).toBe("CASE-FEASIBLE-AFTER-ADVANCE");
  });

  it("getCaseDetail returns the terms, decisions, reservations, certificates, receipts, and timeline", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const detail = await getCaseDetail(testDb, dealCase.id);
    expect(detail?.case.id).toBe(dealCase.id);
    expect(detail?.termsVersions).toHaveLength(1);
    expect(detail?.decisions).toEqual([]);
  });

  it("getCaseDetail returns null for an unknown case", async () => {
    expect(await getCaseDetail(testDb, "missing")).toBeNull();
  });

  it("sendQuote denies backed_commitment when no consumed certificate exists for the current version", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const result = await sendQuote(testDb, dealCase.id, "backed_commitment");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("POLICY_VIOLATION");
  });

  it("sendQuote returns ok:true with mode:backed_commitment once a real commit produces a consumed certificate", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const accepted = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    if (accepted.status !== "committed") throw new Error("fixture setup expected committed");

    const result = await sendQuote(testDb, dealCase.id, "backed_commitment");
    expect(result.ok).toBe(true);
    if (result.ok && result.mode === "backed_commitment") {
      expect(result.certificateId).toBe(accepted.certificateId);
      // commitOrder already sends a real "backed_promise" outbox message as part of the
      // commit sequence, so this comes back populated rather than null.
      expect(typeof result.outboxMessageId).toBe("string");
    } else {
      throw new Error("expected ok:true mode:backed_commitment");
    }
  });

  it("sendQuote returns ok:true with mode:non_binding_counteroffer when a current counteroffer exists", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const { counteroffer } = await createCounteroffer(testDb, {
      caseId: dealCase.id,
      sourceTermsVersion: 1,
      sku: "MAT-10001",
      quantity: 350,
      totalValueMinor: 100_000_000,
      discountBps: 0,
      paymentTerms: "ADVANCE_30",
      deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      expiresInSeconds: 900,
      buyerLinkSigningSecret: SECRET,
    });

    const result = await sendQuote(testDb, dealCase.id, "non_binding_counteroffer");
    expect(result).toEqual({ ok: true, mode: "non_binding_counteroffer", counterofferId: counteroffer.id, binding: false });
  });

  it("sendQuote returns INVALID_INPUT for an unrecognized mode", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const result = await sendQuote(testDb, dealCase.id, "something_else");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
  });
});
