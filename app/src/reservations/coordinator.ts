import { Prisma, type PrismaClient } from "@prisma/client";
import { ToolError, type ReservationDomain, type ReservationStatus } from "@/lib/types";
import { certificateHash as computeCertificateHash } from "@/lib/hash";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { assertValidCertificateTransition } from "@/state/certificateLifecycle";
import { assertValidReservationTransition } from "@/state/reservationLifecycle";
import { runReceiptedAction } from "@/receipts/actionReceipt";
import { createSandboxOrder, updateCrmStage, markSandboxOrderRepairPending } from "@/adapters/sandboxErpAdapter";
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
  // Idempotency key deliberately includes caseVersion (unlike certificateHash, which
  // omits it): a legitimate repair re-issuance can share the same termsHash and
  // reservationIds as an earlier, already-consumed certificate but at a new
  // caseVersion, and must NOT be mistaken for a duplicate of that earlier attempt.
  // Reservation ids are sorted so a caller passing the same set in a different order
  // still hits the same key.
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "prepare_commit_certificate",
    resourceRef: [...input.reservationIds].sort().join(","),
  });
  const existing = await db.commitCertificate.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      // Re-check inside the transaction: see inventoryAdapter.ts for why (a concurrent
      // caller with the identical idempotency key may have committed between the
      // pre-check above and acquiring the lock here).
      const alreadyPrepared = await tx.commitCertificate.findUnique({ where: { idempotencyKey } });
      if (alreadyPrepared) return alreadyPrepared;

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
          idempotencyKey,
        },
      });
    });
  } catch (error) {
    // Belt-and-suspenders for true concurrent execution under weaker isolation (e.g. a
    // future Postgres swap, where two transactions could both pass the re-check above
    // before either commits): if the DB's own unique constraint on idempotencyKey
    // rejects a duplicate create, the whole transaction rolls back, and we return the
    // winner's row instead of surfacing a raw constraint error to the caller.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.commitCertificate.findUnique({ where: { idempotencyKey } });
      if (winner) return winner;
    }
    throw error;
  }
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
// receipts (05-TOOL-CONTRACTS.md "commit_order"). All three receipted actions
// (sandbox order + CRM, Stripe checkout, outbox) run first — each is independently
// idempotent via runReceiptedAction, so their relative order doesn't change their
// meaning and a crash between any two of them is safely retryable. Reservations move
// to `committed` only after all three receipts succeed, and the certificate becomes
// `consumed` last of all, via an atomic compare-and-swap, so a crash at any point
// before that leaves the top-of-function "must be valid" guard able to let a retry
// pick up where it left off.
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
  const consumedUpdate = await db.commitCertificate.updateMany({
    where: { id: input.certificateId, status: "valid" },
    data: { status: "consumed", consumedAt: new Date() },
  });
  if (consumedUpdate.count === 0) {
    // Lost the race to a concurrent or retried commitOrder call for the same
    // certificate. Every step above this point is itself idempotent (receipts keyed
    // by certificateId; the reservation-commit loop is a no-op once already
    // committed), so if the certificate really did land on "consumed", the winner
    // already produced the exact same outcome this call would have — treat that as
    // success rather than a conflict. Anything else is a genuine, unexpected state.
    const current = await db.commitCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
    if (current.status !== "consumed") {
      throw new ToolError("POLICY_VIOLATION", `Certificate ${input.certificateId} could not be marked consumed (status=${current.status})`, false);
    }
  }

  return { orderReceipt, checkoutReceipt, outboxReceipt };
}

export type AbortCommitmentResult =
  | { reservationId: string; status: "released"; reservation: unknown }
  | { reservationId: string; status: "failed"; error: unknown };

// Releases each given reservation via its domain-specific adapter. Repeated calls
// return the same outcome — each release function is itself a no-op once a reservation
// is no longer `held` (05-TOOL-CONTRACTS.md "abort_commitment"). A release that throws
// is caught per-item rather than aborting the loop: the caller needs to know which
// reservations were actually released even when one release fails, not lose that
// information to an unhandled rejection that discards every result gathered so far.
// Shared by abortCommitment below (which releases every held reservation for a
// case/version wholesale) and by evaluateAndRoute's certificate-preparation path in
// dealSubmitted.ts (which must release only the specific reservations that turned out
// not to be required, without touching the reservations about to be committed).
export async function releaseReservations(db: PrismaClient, reservations: Array<{ id: string; domain: string }>): Promise<AbortCommitmentResult[]> {
  const results: AbortCommitmentResult[] = [];
  for (const reservation of reservations) {
    try {
      let released;
      switch (reservation.domain as ReservationDomain) {
        case "inventory":
          released = await releaseInventoryHold(db, reservation.id);
          break;
        case "supplier":
          released = await cancelSupplierOptionHold(db, reservation.id);
          break;
        case "logistics":
          released = await releaseDeliverySlot(db, reservation.id);
          break;
        case "credit":
          released = await releaseCreditEnvelope(db, reservation.id);
          break;
        default:
          throw new ToolError("INVALID_INPUT", `Unknown reservation domain "${reservation.domain}"`, false);
      }
      results.push({ reservationId: reservation.id, status: "released", reservation: released });
    } catch (error) {
      results.push({ reservationId: reservation.id, status: "failed", error });
    }
  }
  return results;
}

// Releases every still-held reservation for a preparation attempt (all domains, for one
// case/version) — see releaseReservations above for the per-reservation release logic
// and its idempotency/error-handling notes.
export async function abortCommitment(db: PrismaClient, input: { caseId: string; caseVersion: number }): Promise<AbortCommitmentResult[]> {
  const reservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: input.caseVersion, status: "held" } });
  return releaseReservations(db, reservations);
}

// Requires a persisted disruption event and consumed certificate; marks the
// certificate broken without deleting committed history (05-TOOL-CONTRACTS.md
// "break_certificate"). Idempotent: breaking an already-broken certificate is a no-op.
export async function breakCertificate(db: PrismaClient, input: { certificateId: string }) {
  const certificate = await db.commitCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
  if (certificate.status === "broken") return certificate;
  if (certificate.status !== "consumed") {
    throw new ToolError("POLICY_VIOLATION", `Certificate ${input.certificateId} is not consumed (status=${certificate.status})`, false);
  }
  assertValidCertificateTransition("consumed", "broken");
  // Atomic guard, not a plain update: a concurrent caller could have already broken
  // (or otherwise transitioned) this certificate between the read above and this
  // write — see the fix history on commitOrder's consumed-transition and
  // stripeMockAdapter.ts's expireCheckout for why this codebase treats every
  // status-transition write this way, not just the read-then-branch above.
  const updated = await db.commitCertificate.updateMany({
    where: { id: input.certificateId, status: "consumed" },
    data: { status: "broken", brokenAt: new Date() },
  });
  const current = await db.commitCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
  if (updated.count === 0 && current.status !== "broken") {
    throw new ToolError("POLICY_VIOLATION", `Certificate ${input.certificateId} could not be marked broken (status=${current.status})`, false);
  }
  return current;
}

export interface CompensateCommitmentInput {
  caseId: string;
  caseVersion: number;
  brokenCertificateId: string;
  disruptedSupplierReservationId: string;
  affectedLogisticsReservationIds: string[];
}

// Executes the compensation matrix from 04-DATA-AND-STATE-SPEC.md. Every step is
// idempotency-keyed by case, version, action type, and resource, so calling this twice
// for the same disruption produces the same receipts, not duplicates. A disrupted
// supplier's own availability is never restored (disrupted, not reusable) — only a
// cancellation receipt is recorded for that domain. A logistics slot's capacity IS
// restored directly (not via releaseDeliverySlot, which would also try to flip the
// reservation's status — but a committed reservation is terminal per this file's
// design note, so this compensates the pool only, leaving the reservation row alone).
export async function compensateCommitment(db: PrismaClient, input: CompensateCommitmentInput) {
  const key = (actionType: string, resourceRef: string) =>
    deriveIdempotencyKey({ caseId: input.caseId, caseVersion: input.caseVersion, actionType, resourceRef });

  const supplierReservation = await db.reservation.findUniqueOrThrow({ where: { id: input.disruptedSupplierReservationId } });
  const supplierReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "supplier.cancel_option",
    resourceRef: supplierReservation.resourceRef,
    provider: "supplier",
    idempotencyKey: key("supplier.cancel_option", supplierReservation.resourceRef),
    requestHash: input.brokenCertificateId,
    execute: async () => ({ providerRef: supplierReservation.resourceRef, data: { cancelledReservationId: supplierReservation.id } }),
  });

  const logisticsReceipts = [];
  for (const reservationId of input.affectedLogisticsReservationIds) {
    const reservation = await db.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    const receipt = await runReceiptedAction(db, {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      actionType: "logistics.release_slot",
      resourceRef: reservation.resourceRef,
      provider: "logistics",
      // Unlike every other receipted action in this file (which key off a shared
      // resource like a certificate or case id, where true duplicates ARE meant to
      // collide and dedupe), each affected logistics RESERVATION here represents a
      // distinct compensation event even when multiple reservations share the same
      // underlying planId — keying off the shared plan resourceRef would silently
      // collapse two real compensations into one, permanently losing the second
      // reservation's capacity credit.
      idempotencyKey: key("logistics.release_slot", `RESERVATION:${reservation.id}`),
      requestHash: input.brokenCertificateId,
      execute: async () => {
        // resourceRef is "PLAN:<planId>" — 2 parts; other domains use 3, don't copy
        // this arity blind (see logisticsAdapter.ts's releaseDeliverySlot for the
        // identical comment on the same resourceRef shape).
        const [, planId] = reservation.resourceRef.split(":");
        await db.deliveryPlanOption.updateMany({ where: { planId }, data: { capacityRemaining: { increment: reservation.quantityMinor ?? 0 } } });
        return { providerRef: reservation.resourceRef, data: { releasedReservationId: reservation.id } };
      },
    });
    logisticsReceipts.push(receipt);
  }

  const orderReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "sandbox_order.repair_pending",
    resourceRef: input.caseId,
    provider: "sandbox_erp",
    idempotencyKey: key("sandbox_order.repair_pending", input.caseId),
    requestHash: input.brokenCertificateId,
    execute: async () => {
      await markSandboxOrderRepairPending(db, input.caseId);
      return { providerRef: null, data: {} };
    },
  });

  const crmReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "crm.stage_update",
    resourceRef: input.caseId,
    provider: "sandbox_crm",
    idempotencyKey: key("crm.stage_update", input.caseId),
    requestHash: input.brokenCertificateId,
    execute: async () => {
      const event = await updateCrmStage(db, { caseId: input.caseId, stage: "repair_needed", note: `Certificate ${input.brokenCertificateId} broken by supplier disruption` });
      return { providerRef: event.id, data: {} };
    },
  });

  return { supplierReceipt, logisticsReceipts, orderReceipt, crmReceipt };
}

export interface TerminalStateReport {
  caseId: string;
  caseStatus: string;
  certificates: Array<{ id: string; status: string }>;
  reservations: Array<{ id: string; domain: string; status: string }>;
  receipts: Array<{ id: string; actionType: string; status: string }>;
}

// Reads database state and returns a deterministic expected-versus-actual report. It
// never asks an LLM to judge correctness (05-TOOL-CONTRACTS.md "verify_terminal_state")
// — the evaluation runner (Task 31) compares this report's fields directly.
export async function verifyTerminalState(db: PrismaClient, caseId: string): Promise<TerminalStateReport> {
  const [dealCase, certificates, reservations, receipts] = await Promise.all([
    db.dealCase.findUniqueOrThrow({ where: { id: caseId } }),
    db.commitCertificate.findMany({ where: { caseId } }),
    db.reservation.findMany({ where: { caseId } }),
    db.actionReceipt.findMany({ where: { caseId } }),
  ]);
  return {
    caseId,
    caseStatus: dealCase.status,
    certificates: certificates.map((c) => ({ id: c.id, status: c.status })),
    reservations: reservations.map((r) => ({ id: r.id, domain: r.domain, status: r.status })),
    receipts: receipts.map((r) => ({ id: r.id, actionType: r.actionType, status: r.status })),
  };
}
