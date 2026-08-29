import type { PrismaClient } from "@prisma/client";
import { ToolError, type ReservationDomain, type ReservationStatus } from "@/lib/types";
import { certificateHash as computeCertificateHash } from "@/lib/hash";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { assertValidCertificateTransition } from "@/state/certificateLifecycle";
import { assertValidReservationTransition } from "@/state/reservationLifecycle";
import { runReceiptedAction } from "@/receipts/actionReceipt";
import { createSandboxOrder, updateCrmStage } from "@/adapters/sandboxErpAdapter";
import { createDepositCheckout } from "@/adapters/stripeMockAdapter";
import { sendBackedPromise } from "@/adapters/outboxAdapter";
import { releaseInventoryHold } from "@/adapters/inventoryAdapter";
import { cancelSupplierOptionHold } from "@/adapters/supplierAdapter";
import { releaseDeliverySlot } from "@/adapters/logisticsAdapter";
import { releaseCreditEnvelope } from "@/adapters/creditAdapter";
import { toJsonColumn, fromJsonColumn } from "@/lib/json-column";

export interface PrepareCertificateInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  reservationIds: string[];
  requiredDomains: ReservationDomain[];
}

// The coordinator may mark a certificate valid only when every listed invariant from
// 04-DATA-AND-STATE-SPEC.md "Certificate lifecycle" holds. This function checks all of
// them before creating the row at all, so an invalid attempt never becomes a `draft`
// certificate that has to be cleaned up.
export async function prepareCommitCertificate(db: PrismaClient, input: PrepareCertificateInput) {
  return db.$transaction(async (tx) => {
    const reservations = await tx.reservation.findMany({ where: { id: { in: input.reservationIds } } });
    if (reservations.length !== input.reservationIds.length) {
      throw new ToolError("INVALID_INPUT", "One or more reservation ids do not exist", false);
    }
    const now = new Date();
    for (const reservation of reservations) {
      if (reservation.caseId !== input.caseId || reservation.termsHash !== input.termsHash) {
        throw new ToolError("TERMS_HASH_MISMATCH", `Reservation ${reservation.id} does not match case ${input.caseId} / terms hash ${input.termsHash}`, false, [reservation.id]);
      }
      // A `held` reservation must belong to exactly this case version and be unexpired.
      // A `committed` reservation may belong to an *earlier* case version of the same
      // case: it already executed durably during a prior commit and does not need to
      // be re-verified or re-held during repair — 04-DATA-AND-STATE-SPEC.md "Inventory
      // and Finance decisions are reused only after freshness validation" (Case 3).
      // Re-holding it would double-count the resource, since the pool decrement from
      // the original hold is never restored for a committed reservation.
      if (reservation.status === "committed") continue;
      if (reservation.status !== "held") {
        throw new ToolError("RESERVATION_EXPIRED", `Reservation ${reservation.id} is not held (status=${reservation.status})`, true, [reservation.id]);
      }
      if (reservation.caseVersion !== input.caseVersion) {
        throw new ToolError("STALE_CASE_VERSION", `Held reservation ${reservation.id} belongs to a different case version than ${input.caseVersion}`, true, [reservation.id]);
      }
      if (reservation.expiresAt <= now) {
        throw new ToolError("RESERVATION_EXPIRED", `Reservation ${reservation.id} expired at ${reservation.expiresAt.toISOString()}`, true, [reservation.id]);
      }
    }
    const coveredDomains = new Set(reservations.map((r) => r.domain));
    for (const domain of input.requiredDomains) {
      if (!coveredDomains.has(domain)) {
        throw new ToolError("POLICY_VIOLATION", `No held reservation covers required domain "${domain}"`, false);
      }
    }
    // Only `held` reservations are still time-bound; a `committed` one (reused from an
    // earlier case version during repair) no longer has a meaningful expiry.
    const heldExpiries = reservations.filter((r) => r.status === "held").map((r) => r.expiresAt);
    const validUntil = heldExpiries.length > 0 ? heldExpiries.reduce((earliest, expiry) => (expiry < earliest ? expiry : earliest)) : new Date(Date.now() + 15 * 60 * 1000);
    const policyVersions = Object.fromEntries(reservations.map((r) => [r.domain, r.policyVersion]));
    const hash = computeCertificateHash({ caseId: input.caseId, termsHash: input.termsHash, reservationIds: input.reservationIds });

    assertValidCertificateTransition("draft", "valid");
    return tx.commitCertificate.create({
      data: {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        termsHash: input.termsHash,
        // reservationIds is a JSON-in-TEXT column (SQLite has no native Json type;
        // see prisma/schema.prisma and lib/json-column.ts) — must go through
        // toJsonColumn, never a bare cast.
        reservationIds: toJsonColumn(input.reservationIds),
        // policyVersions is likewise JSON-in-TEXT.
        policyVersions: toJsonColumn(policyVersions),
        validUntil,
        status: "valid",
        certificateHash: hash,
      },
    });
  });
}

export interface CommitOrderInput {
  caseId: string;
  caseVersion: number;
  certificateId: string;
  certificateHash: string;
  sku: string;
  quantity: number;
  totalValueMinor: number;
  depositMinor: number;
}

// Requires a valid certificate ID and certificate hash; commits sandbox order,
// allocation, CRM, Stripe checkout-release, and outbox actions through idempotent
// receipts (05-TOOL-CONTRACTS.md "commit_order"). Reservations move to `committed` and
// the certificate to `consumed` only after the required receipts succeed.
export async function commitOrder(db: PrismaClient, input: CommitOrderInput) {
  const certificate = await db.commitCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
  if (certificate.status !== "valid") {
    throw new ToolError("POLICY_VIOLATION", `Certificate ${input.certificateId} is not valid (status=${certificate.status})`, false);
  }
  if (certificate.certificateHash !== input.certificateHash) {
    throw new ToolError("TERMS_HASH_MISMATCH", "Supplied certificate hash does not match the stored certificate", false);
  }
  if (certificate.validUntil <= new Date()) {
    throw new ToolError("RESERVATION_EXPIRED", `Certificate ${input.certificateId} expired at ${certificate.validUntil.toISOString()}`, false);
  }

  const key = (actionType: string) =>
    deriveIdempotencyKey({ caseId: input.caseId, caseVersion: input.caseVersion, actionType, resourceRef: input.certificateId });

  const orderReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "sandbox_order.create",
    resourceRef: input.certificateId,
    provider: "sandbox_erp",
    idempotencyKey: key("sandbox_order.create"),
    requestHash: input.certificateHash,
    execute: async () => {
      const order = await createSandboxOrder(db, { caseId: input.caseId, certificateId: input.certificateId, sku: input.sku, quantity: input.quantity, totalValueMinor: input.totalValueMinor });
      await updateCrmStage(db, { caseId: input.caseId, stage: "committed", note: `Certificate ${input.certificateId} consumed` });
      return { providerRef: order.id, data: { orderId: order.id } };
    },
  });

  const checkoutReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "stripe.create_deposit_checkout",
    resourceRef: input.certificateId,
    provider: "stripe",
    idempotencyKey: key("stripe.create_deposit_checkout"),
    requestHash: input.certificateHash,
    execute: async () => {
      const checkout = await createDepositCheckout(db, { caseId: input.caseId, certificateId: input.certificateId, amountMinor: input.depositMinor });
      return { providerRef: checkout.stripeSessionId, data: { checkoutId: checkout.id, checkoutUrl: `https://checkout.stripe.test/mock/${checkout.stripeSessionId}` } };
    },
  });

  // reservationIds is a JSON-in-TEXT column — parse it through fromJsonColumn rather
  // than a bare cast, per this project's SQLite Json-as-TEXT convention.
  const reservationIds = fromJsonColumn<string[]>(certificate.reservationIds);
  for (const reservationId of reservationIds) {
    await db.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      if (reservation.status === "committed") return;
      assertValidReservationTransition(reservation.status as ReservationStatus, "committed");
      await tx.reservation.update({ where: { id: reservationId }, data: { status: "committed" } });
    });
  }

  assertValidCertificateTransition("valid", "consumed");
  await db.commitCertificate.update({ where: { id: input.certificateId }, data: { status: "consumed", consumedAt: new Date() } });

  const outboxReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "outbox.send_backed_promise",
    resourceRef: input.certificateId,
    provider: "outbox",
    idempotencyKey: key("outbox.send_backed_promise"),
    requestHash: input.certificateHash,
    execute: async () => {
      // checkoutReceipt.responsePayload is likewise JSON-in-TEXT — parse it through
      // fromJsonColumn rather than a bare cast.
      const checkoutData = fromJsonColumn<{ checkoutUrl: string }>(checkoutReceipt.responsePayload);
      const message = await sendBackedPromise(db, {
        caseId: input.caseId,
        certificateId: input.certificateId,
        payload: { sku: input.sku, quantity: input.quantity, depositMinor: input.depositMinor, checkoutUrl: checkoutData.checkoutUrl },
      });
      return { providerRef: message.id, data: {} };
    },
  });

  return { orderReceipt, checkoutReceipt, outboxReceipt };
}

// Releases every still-held reservation for a preparation attempt. Repeated calls
// return existing release results — each release function is itself a no-op once a
// reservation is no longer `held` (05-TOOL-CONTRACTS.md "abort_commitment").
export async function abortCommitment(db: PrismaClient, input: { caseId: string; caseVersion: number }) {
  const reservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: input.caseVersion, status: "held" } });
  const results = [];
  for (const reservation of reservations) {
    switch (reservation.domain as ReservationDomain) {
      case "inventory":
        results.push(await releaseInventoryHold(db, reservation.id));
        break;
      case "supplier":
        results.push(await cancelSupplierOptionHold(db, reservation.id));
        break;
      case "logistics":
        results.push(await releaseDeliverySlot(db, reservation.id));
        break;
      case "credit":
        results.push(await releaseCreditEnvelope(db, reservation.id));
        break;
    }
  }
  return results;
}
