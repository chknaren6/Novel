import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runCommit } from "./commit";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { prepareCommitCertificate } from "@/reservations/coordinator";
import { transitionCase } from "@/state/transitions";
import { toJsonColumn, fromJsonColumn } from "@/lib/json-column";

async function seedPreparedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" } });
  const customer = await testDb.customer.create({ data: { companyId: company.id, name: "Beacon", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: toJsonColumn(["ADVANCE_30"]), policyVersion: "credit-policy-v1" } });
  await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_acceptance", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "ADVANCE_30", deliveryDeadline: new Date("2026-09-12") } });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 350 } });

  const inventoryReservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 350, ttlSeconds: 900 });
  const creditReservation = await holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 102_900_000, ttlSeconds: 900 });
  await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds: [inventoryReservation.id, creditReservation.id], requiredDomains: ["inventory", "credit"] });
  await transitionCase(testDb, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: 1, nextStatus: "prepared" });

  return dealCase;
}

describe("runCommit", () => {
  beforeEach(resetTestDb);

  it("commits a prepared case and reaches committed with required receipts", async () => {
    const dealCase = await seedPreparedCase();
    const result = await runCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("committed");
    if (result.status === "committed") {
      expect(result.depositMinor).toBe(44_100_000);
    }

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");

    const order = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(order.status).toBe("accepted");
    const checkout = await testDb.stripeCheckoutMock.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(checkout.amountMinor).toBe(44_100_000);
    const outboxMessage = await testDb.outboxMessage.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(outboxMessage.messageType).toBe("backed_promise");
  });

  it("carries correct case-specific values into the order and outbox receipts (not just present, but right)", async () => {
    const dealCase = await seedPreparedCase();
    await runCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });

    const order = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(order.quantity).toBe(350);
    expect(order.totalValueMinor).toBe(147_000_000);

    const outboxMessage = await testDb.outboxMessage.findFirstOrThrow({ where: { caseId: dealCase.id } });
    const payload = fromJsonColumn<{ sku: string; quantity: number; depositMinor: number }>(outboxMessage.payload);
    expect(payload.sku).toBe("MAT-10001");
    expect(payload.depositMinor).toBe(44_100_000);
  });

  it("escalates instead of committing when the certificate has already expired", async () => {
    const dealCase = await seedPreparedCase();
    await testDb.commitCertificate.updateMany({ where: { caseId: dealCase.id }, data: { validUntil: new Date(Date.now() - 1000) } });

    const result = await runCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("escalated");
    if (result.status !== "escalated") throw new Error("expected escalated");
    // Class A: nothing irreversible happened (commitOrder's top-of-function validity
    // guard threw before any receipt or reservation-commit work ran) — these fields
    // must read as the safe, empty case, unlike the Class B test below.
    expect(result.partialCommit).toBe(false);
    expect(result.committedReservationIds).toEqual([]);
    expect(result.receiptedActionsExecuted).toEqual([]);
    expect(result.reason).not.toMatch(/^PARTIAL_COMMIT:/);

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("escalated");

    // Nothing should have run at all for this case: no reservation was ever committed
    // (abortCommitment releases whatever was still held, so they end up "released", not
    // "held" — the key thing is none of them passed through "committed").
    const reservations = await testDb.reservation.findMany({ where: { caseId: dealCase.id } });
    expect(reservations.some((r) => r.status === "committed")).toBe(false);
    const order = await testDb.sandboxOrder.findFirst({ where: { caseId: dealCase.id } });
    expect(order).toBeNull();
  });

  it("escalates with partial-commit diagnostics when the reservation-commit loop fails after receipts ran and after another reservation already committed", async () => {
    const dealCase = await seedPreparedCase();
    const reservations = await testDb.reservation.findMany({ where: { caseId: dealCase.id } });
    const inventoryReservation = reservations.find((r) => r.domain === "inventory")!;
    const creditReservation = reservations.find((r) => r.domain === "credit")!;
    // The certificate lists inventory before credit (seedPreparedCase's
    // reservationIds order), so commitOrder's per-reservation loop commits the
    // inventory reservation first and only then reaches the credit reservation — which
    // we invalidate here so assertValidReservationTransition throws on it. By the time
    // that throw happens, all three receipted actions have already run and the
    // inventory reservation is already permanently `committed`.
    await testDb.reservation.update({ where: { id: creditReservation.id }, data: { status: "expired" } });

    const result = await runCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("escalated");
    if (result.status !== "escalated") throw new Error("expected escalated");
    // Class B: real, irreversible side effects already happened — this must be
    // trivially distinguishable from the Class A test above.
    expect(result.partialCommit).toBe(true);
    expect(result.committedReservationIds).toEqual([inventoryReservation.id]);
    expect(result.receiptedActionsExecuted.length).toBeGreaterThan(0);
    expect(result.reason).toMatch(/^PARTIAL_COMMIT:/);

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("escalated");

    // The inventory reservation really is stuck `committed` (no transition back to
    // released/expired exists) — the diagnostic detail names it correctly.
    const committedReservation = await testDb.reservation.findUniqueOrThrow({ where: { id: inventoryReservation.id } });
    expect(committedReservation.status).toBe("committed");

    // The receipted side effects really did run before the failure.
    const order = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(order.status).toBe("accepted");

    // The escalation event itself carries the Class B diagnostics, not just the return value.
    const escalationEvent = await testDb.caseEvent.findFirstOrThrow({ where: { caseId: dealCase.id, eventType: "case.escalated" } });
    const payload = fromJsonColumn<{ partialCommit: boolean; committedReservationIds: string[]; reason: string }>(escalationEvent.payload);
    expect(payload.partialCommit).toBe(true);
    expect(payload.committedReservationIds).toEqual([inventoryReservation.id]);
    expect(payload.reason).toMatch(/^PARTIAL_COMMIT:/);
  });
});
