import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError, type PaymentTerms, type ReservationDomain, type RoleId } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { runRoleAgent } from "@/roles/roleRuntime";
import { calculateDealEconomics, SKU_UNIT_COST_MINOR, ADVANCE_DEPOSIT_BPS } from "@/policy/economics";
import { prepareCommitCertificate, abortCommitment, releaseReservations } from "@/reservations/coordinator";
import { createCounteroffer } from "./counteroffer";
import { fromJsonColumn } from "@/lib/json-column";

export interface RunDealSubmittedInput {
  caseId: string;
  modelId: string;
  timeoutMs: number;
  traceId: string;
  buyerLinkSigningSecret: string;
}

const DESTINATION_ID = "ZONE-SOUTH";
const REQUIRED_BASE_DOMAINS: ReservationDomain[] = ["credit", "inventory", "logistics"];

// B2C's required-domain set is deliberately different from B2B's REQUIRED_BASE_DOMAINS
// above: B2C never extends credit (commitos-b2c-product-spec.md §9, "does not extend
// credit to buyers") and doesn't hold its own inventory (it brokers a supplier order,
// it doesn't stock goods) — so "credit" and "inventory" never apply. Only "supplier"
// (the confirmed purchase order) is required; "logistics" is added by the future B2C
// workflow only when CommitOS books third-party freight itself, mirroring how
// REQUIRED_BASE_DOMAINS above conditionally adds "supplier" on a shortfall. Not yet
// consumed by any workflow — that's the next plan (the actual B2C evaluate/route flow).
export const B2C_REQUIRED_DOMAINS: ReservationDomain[] = ["supplier"];

// 1. Sales normalizes. 2. Finance/Inventory/Procurement/Logistics run concurrently.
// 3. Risk runs against their evidence. 4. Deterministic feasibility check. 5. Route to
// prepared, negotiating (30% advance counteroffer), or cannot_commit.
export async function runDealSubmitted(db: PrismaClient, gateway: ModelGateway, input: RunDealSubmittedInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "intake", expectedVersion: dealCase.activeTermsVersion, nextStatus: "evaluating" });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "deal.submitted", caseVersion: dealCase.activeTermsVersion, actorType: "operator", actorRef: "seed", payload: { termsHash: terms.termsHash }, traceId: input.traceId });

  return evaluateAndRoute(db, gateway, input);
}

// Shared by the initial evaluation above and buyer acceptance (a later task). Assumes
// the case is already in "evaluating" status (the caller does that transition, since
// the *previous* status differs — "intake" here, "negotiating" for buyer acceptance);
// runs all six roles against the active terms version and routes to prepared,
// negotiating, or cannot_commit.
export async function evaluateAndRoute(db: PrismaClient, gateway: ModelGateway, input: RunDealSubmittedInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: dealCase.customerId } });

  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: SKU_UNIT_COST_MINOR[terms.sku] ?? 0,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: ADVANCE_DEPOSIT_BPS,
  });

  const toolContext = { customerId: customer.id, sku: terms.sku, destinationId: DESTINATION_ID, paymentTerms: terms.paymentTerms as PaymentTerms };
  const runRole = (role: RoleId, contextSummary: Record<string, unknown>) =>
    runRoleAgent(
      db,
      gateway,
      { role, caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, contextSummary, toolContext, traceId: input.traceId, timeoutMs: input.timeoutMs },
      input.modelId,
    );

  const salesDecision = await runRole("sales", { currentTerms: { paymentTerms: terms.paymentTerms, quantity: terms.quantity }, requestedQuantity: terms.quantity });

  const [financeDecision, inventoryDecision, procurementDecision, logisticsDecision] = await Promise.all([
    runRole("finance", { requestedPaymentTerms: terms.paymentTerms, exposureIfApproved: economics.creditExposureMinor }),
    runRole("inventory", { sku: terms.sku, requestedQuantity: terms.quantity }),
    runRole("procurement", { sku: terms.sku, requestedQuantity: terms.quantity }),
    runRole("logistics", { destinationId: DESTINATION_ID, deadline: terms.deliveryDeadline.toISOString(), requestedQuantity: terms.quantity }),
  ]);

  const riskDecision = await runRole("risk", {
    financeDecision: { decision: financeDecision.decision, evidenceRefs: financeDecision.evidenceRefs },
    inventoryDecision: { decision: inventoryDecision.decision, evidenceRefs: inventoryDecision.evidenceRefs },
    procurementDecision: { decision: procurementDecision.decision, evidenceRefs: procurementDecision.evidenceRefs },
    logisticsDecision: { decision: logisticsDecision.decision, evidenceRefs: logisticsDecision.evidenceRefs },
  });

  const allHeldReservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, status: "held" } });
  const inventoryHeldQty = allHeldReservations.filter((r) => r.domain === "inventory").reduce((sum, r) => sum + (r.quantityMinor ?? 0), 0);
  const shortfall = terms.quantity - inventoryHeldQty;
  const requiredDomains: ReservationDomain[] = shortfall > 0 ? [...REQUIRED_BASE_DOMAINS, "supplier"] : REQUIRED_BASE_DOMAINS;
  // Procurement runs concurrently with inventory and decides whether to hold a
  // supplier option using only {sku, requestedQuantity} — not the shortfall computed
  // just above — so it can come back with a held supplier reservation even in a run
  // where inventory alone ends up covering the full requested quantity. Filter to only
  // the domains actually required before deriving coveredDomains/missingDomains (so an
  // unneeded hold can never mask a real gap) and before anything is handed to the
  // certificate; any reservation outside requiredDomains is released below rather than
  // silently swept into the certificate as an untracked, un-released hold.
  const heldReservations = allHeldReservations.filter((r) => requiredDomains.includes(r.domain as ReservationDomain));
  const extraReservations = allHeldReservations.filter((r) => !requiredDomains.includes(r.domain as ReservationDomain));
  const coveredDomains = new Set(heldReservations.map((r) => r.domain));
  const missingDomains = requiredDomains.filter((d) => !coveredDomains.has(d));

  if (riskDecision.decision === "veto" || missingDomains.length > 1 || (missingDomains.length === 1 && missingDomains[0] !== "credit")) {
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    const reason = riskDecision.decision === "veto" ? "risk_veto" : `unresolved_domains:${missingDomains.join(",")}`;
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.cannot_commit", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason }, traceId: input.traceId });
    return { status: "cannot_commit" as const, reason };
  }

  if (missingDomains.length === 0) {
    // Any reservation held for a domain not in requiredDomains (e.g. a speculative
    // supplier hold that inventory's own coverage made unnecessary) must not persist as
    // an orphaned, un-released hold — release it now, distinct from the reservations
    // below that are about to be certified and committed.
    if (extraReservations.length > 0) {
      await releaseReservations(db, extraReservations);
    }
    try {
      const certificate = await prepareCommitCertificate(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, reservationIds: heldReservations.map((r) => r.id), requiredDomains });
      await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "prepared" });
      return { status: "prepared" as const, certificateId: certificate.id, economics };
    } catch (error) {
      // A reservation set that looked complete a moment ago can still fail
      // certificate validation — e.g. a supplier option's TTL expired between the
      // hold and this check. The certificate never becomes valid or consumed, every
      // held resource is released, and the case fails closed with the exact blocking
      // reservation named. (This is exactly the scenario a later integration test,
      // "stale supplier hold", exercises end-to-end.)
      await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
      await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
      const reason = error instanceof ToolError ? `${error.code}: ${error.message}` : String(error);
      await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.cannot_commit", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason }, traceId: input.traceId });
      return { status: "cannot_commit" as const, reason };
    }
  }

  // Only credit is missing: Finance countered NET_60 and ADVANCE_30 is permitted — the
  // one approved counterterm this build supports (deliberate P0 scope cut: "keep the
  // one approved 30% advance term"). allowedPaymentTerms is a JSON-in-TEXT column
  // (SQLite has no native Json type; see prisma/schema.prisma and lib/json-column.ts),
  // so it must be deserialized via fromJsonColumn before checking membership — a bare
  // `(customer.allowedPaymentTerms as string[]).includes(...)` cast on the raw stored
  // string would check `.includes()` on a string, not a real array.
  const advanceAllowed = fromJsonColumn<string[]>(customer.allowedPaymentTerms).includes("ADVANCE_30");
  if (!advanceAllowed || terms.paymentTerms === "ADVANCE_30") {
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.cannot_commit", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason: "credit_policy_no_permitted_counterterm" }, traceId: input.traceId });
    return { status: "cannot_commit" as const, reason: "credit_policy_no_permitted_counterterm" };
  }

  await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
  const offer = await createCounteroffer(db, {
    caseId: input.caseId,
    sourceTermsVersion: dealCase.activeTermsVersion,
    sku: terms.sku,
    quantity: terms.quantity,
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    paymentTerms: "ADVANCE_30",
    deliveryDeadline: terms.deliveryDeadline,
    expiresInSeconds: 3600,
    buyerLinkSigningSecret: input.buyerLinkSigningSecret,
  });
  await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "negotiating" });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "counteroffer.created", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "sales", payload: { counterofferId: offer.counteroffer.id, proposedTermsVersion: offer.proposedVersion }, traceId: input.traceId });

  return { status: "negotiating" as const, counterofferId: offer.counteroffer.id, buyerToken: offer.buyerToken, salesExplanation: salesDecision.explanation };
}
