import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { listCases, getCaseDetail, sendQuote } from "./casesService";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE, FIXTURE_POST_COMMIT_DISRUPTION } from "@/fixtures/definitions";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { runBuyerResponse } from "@/workflow/buyerResponse";
import { runSupplierDisruption } from "@/workflow/supplierDisrupted";
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

// Same script as supplierDisrupted.test.ts: also covers the repair round's
// procurement/logistics rerun (excludedSupplierId / requestedQuantity branches), needed
// to drive FIXTURE_POST_COMMIT_DISRUPTION through a real disruption + partial-repair
// failure for the Bug 1 regression test below.
function disruptionScript(input: RoleRunInput) {
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
      if (input.contextSummary.excludedSupplierId) {
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2005", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2005 replaces the disrupted option.") };
      }
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      if (input.contextSummary.requestedQuantity === 151) {
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-CHE", quantity: 151, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Repair plan covers VEND-2005's leg.") };
      }
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
    // createCounteroffer only writes the Counteroffer row (see workflow/counteroffer.ts);
    // dealSubmitted.ts's real call site transitions dealCase.status to "negotiating"
    // separately right after creating the offer. Do the same here so this fixture
    // actually represents a live, pending counteroffer per the sendQuote status guard,
    // rather than leaving the case at seedFixture's "intake".
    await testDb.dealCase.update({ where: { id: dealCase.id }, data: { status: "negotiating" } });

    const result = await sendQuote(testDb, dealCase.id, "non_binding_counteroffer");
    expect(result).toEqual({ ok: true, mode: "non_binding_counteroffer", counterofferId: counteroffer.id, binding: false });
  });

  it("sendQuote returns INVALID_INPUT for an unrecognized mode", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const result = await sendQuote(testDb, dealCase.id, "something_else");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
  });

  // Bug 1 regression (Critical, live-reproduced): sendQuote's backed_commitment branch
  // previously validated only CommitCertificate.status, never dealCase.status. The
  // documented "partial repair" scenario in supplierDisrupted.ts can leave a `consumed`
  // certificate at the new caseVersion on the books even though the case itself fails
  // closed to "cannot_commit" (its catch block re-reads DB state after a later receipted
  // action fails, but does not roll back the certificate consumption that already
  // happened). Reproduces supplierDisrupted.test.ts's "partial-repair diagnostics" test
  // exactly, then asserts sendQuote denies rather than approving a backed commitment for
  // a deal the system has already declared dead.
  it("sendQuote denies backed_commitment for a case that failed closed to cannot_commit after a partial repair", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_POST_COMMIT_DISRUPTION);
    const gateway = new FakeModelGateway(disruptionScript);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");
    const accepted = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t2", buyerLinkSigningSecret: SECRET });
    if (accepted.status !== "committed") throw new Error("fixture setup expected committed");

    // Force the second repair receipted action (outbox.send_correction) to fail after
    // the reservation-commit loop and sandbox_order.repair have already succeeded —
    // same forcing mechanism as supplierDisrupted.test.ts's partial-repair test.
    await testDb.outboxMessage.deleteMany({ where: { caseId: dealCase.id, messageType: "backed_promise" } });

    const disruption = await runSupplierDisruption(testDb, gateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t3" });
    expect(disruption.status).toBe("cannot_commit");
    if (disruption.status !== "cannot_commit") throw new Error("expected cannot_commit");
    expect(disruption.partialRepair).toBe(true);

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
    const consumedCertificate = await testDb.commitCertificate.findFirst({ where: { caseId: dealCase.id, caseVersion: reloaded.activeTermsVersion, status: "consumed" } });
    expect(consumedCertificate).not.toBeNull();

    const result = await sendQuote(testDb, dealCase.id, "backed_commitment");
    expect(result).toMatchObject({ ok: false, code: "POLICY_VIOLATION" });
  });

  // Bug 2 regression (live-reproduced): sendQuote's non_binding_counteroffer branch had
  // no status filter at all. A buyer-rejected counteroffer still matches
  // sourceTermsVersion (buyerResponse.ts's reject path deliberately leaves
  // activeTermsVersion unchanged), so it was still the only row sendQuote would find —
  // returning ok:true for an offer the buyer already rejected.
  it("sendQuote denies non_binding_counteroffer for a counteroffer the buyer already rejected", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const rejected = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "reject", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    expect(rejected.status).toBe("cannot_commit");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
    const rejectedCounteroffer = await testDb.counteroffer.findFirst({ where: { caseId: dealCase.id, sourceTermsVersion: reloaded.activeTermsVersion, status: "rejected" } });
    expect(rejectedCounteroffer).not.toBeNull();

    const result = await sendQuote(testDb, dealCase.id, "non_binding_counteroffer");
    expect(result).toMatchObject({ ok: false, code: "POLICY_VIOLATION" });
  });
});
