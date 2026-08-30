import type { CaseStatus, Decision, DomainDecision, RoleId } from "@/lib/types";

export type DeskStage = "awaiting_submission" | "evaluating" | "negotiating" | "committed" | "cannot_commit" | "escalated";

export type RoleDecision = Decision | "pending";

export interface RoleStatus {
  role: RoleId;
  decision: RoleDecision;
  explanation: string | null;
  evidenceRefs: string[];
}

export interface DeskViewState {
  stage: DeskStage;
  label: string;
  roles: RoleStatus[];
  certificateId: string | null;
  reason: string | null;
  counterofferTerms: { paymentTerms: string; totalValueMinor: number } | null;
}

export interface DeriveDeskStateExtra {
  certificateId?: string | null;
  reason?: string | null;
  counterofferTerms?: { paymentTerms: string; totalValueMinor: number } | null;
}

const STAGE_LABELS: Record<DeskStage, string> = {
  awaiting_submission: "Waiting for this case to be submitted for evaluation.",
  evaluating: "Six-role evaluation in progress.",
  negotiating: "Counteroffer sent — waiting for the buyer to respond.",
  committed: "Committed — the buyer has a dated certificate.",
  cannot_commit: "Cannot commit — the case did not clear evaluation.",
  escalated: "Needs attention — the commit did not complete cleanly.",
};

// The same execution order dealSubmitted.ts actually runs the six roles in: sales
// normalizes first, then finance/inventory/procurement/logistics run concurrently, then
// risk runs last against their evidence. Fixed and sensible for a checklist regardless
// of decision arrival order.
const ROLE_ORDER: RoleId[] = ["sales", "finance", "inventory", "procurement", "logistics", "risk"];

function buildRoleStatuses(decisions: DomainDecision[]): RoleStatus[] {
  const byRole = new Map<RoleId, DomainDecision>();
  for (const decision of decisions) {
    // Last one wins if a role somehow has more than one decision row in the given
    // list — callers are expected to pass decisions already scoped to a single
    // caseId + caseVersion, so this should never actually matter in practice.
    byRole.set(decision.role, decision);
  }
  return ROLE_ORDER.map((role) => {
    const decision = byRole.get(role);
    if (!decision) return { role, decision: "pending", explanation: null, evidenceRefs: [] };
    return { role, decision: decision.decision, explanation: decision.explanation, evidenceRefs: decision.evidenceRefs };
  });
}

// Maps a B2B DealCase's current state to the Commitment Desk's live progress view: the
// six-role checklist plus overall outcome. The direct B2B analog of deriveMarketState.ts
// (src/workflow/b2c/deriveMarketState.ts) — same spirit, different domain: B2B has a
// real six-role checklist worth showing mid-evaluation, where B2C has none.
export function deriveDeskState(dealCase: { status: CaseStatus }, decisions: DomainDecision[], extra: DeriveDeskStateExtra = {}): DeskViewState {
  const roles = buildRoleStatuses(decisions);

  if (dealCase.status === "committed") {
    return { stage: "committed", label: STAGE_LABELS.committed, roles, certificateId: extra.certificateId ?? null, reason: null, counterofferTerms: null };
  }

  if (dealCase.status === "cannot_commit") {
    return { stage: "cannot_commit", label: STAGE_LABELS.cannot_commit, roles, certificateId: null, reason: extra.reason ?? null, counterofferTerms: null };
  }

  if (dealCase.status === "negotiating") {
    return { stage: "negotiating", label: STAGE_LABELS.negotiating, roles, certificateId: null, reason: null, counterofferTerms: extra.counterofferTerms ?? null };
  }

  if (dealCase.status === "aborting") {
    // commit.ts's prepared -> committing -> aborting -> escalated sequence never
    // records a reason until the case actually reaches "escalated" (the case.escalated
    // event, and its payload.reason, is the last thing written in that sequence) — so
    // there is nothing meaningful to read here yet. Any `extra.reason` passed in is
    // deliberately ignored, same as deriveMarketState.ts's own "aborting" branch.
    return { stage: "escalated", label: STAGE_LABELS.escalated, roles, certificateId: null, reason: "Rolling back after a failed commit attempt.", counterofferTerms: null };
  }

  if (dealCase.status === "escalated") {
    return { stage: "escalated", label: STAGE_LABELS.escalated, roles, certificateId: null, reason: extra.reason ?? "Unknown reason", counterofferTerms: null };
  }

  // "repair_needed", "compensating", and "repaired" are legal transitions out of
  // "committed" per transitions.ts's ALLOWED_TRANSITIONS, but no workflow file anywhere
  // in this codebase ever actually writes DealCase.status to any of the three (verified
  // by grep: the only "repaired" write touches SandboxOrder.status, an unrelated table,
  // and coordinator.ts's "repair_needed" CRM stage note never touches DealCase either).
  // They're real future surface, not a typo, but with no repair/compensation workflow
  // built yet there is no signal to show beyond "this needs an operator" — bucketed
  // under "escalated" rather than silently defaulting to "evaluating" below, since
  // showing a live six-role checklist for a case that already committed once and then
  // broke would be actively misleading.
  if (dealCase.status === "repair_needed" || dealCase.status === "compensating" || dealCase.status === "repaired") {
    return { stage: "escalated", label: STAGE_LABELS.escalated, roles, certificateId: null, reason: extra.reason ?? "Unknown reason", counterofferTerms: null };
  }

  if (dealCase.status === "intake") {
    return { stage: "awaiting_submission", label: STAGE_LABELS.awaiting_submission, roles, certificateId: null, reason: null, counterofferTerms: null };
  }

  // Reached by "evaluating" itself (the common live-poll case: some or all of the six
  // role decisions already exist for the active caseVersion, some don't yet — `roles`
  // above already reflects exactly that), and by "prepared"/"committing":
  //
  // - "prepared": dealSubmitted.ts's evaluateAndRoute transitions evaluating -> prepared
  //   with NO event emitted (unlike B2C's buyerResponse.ts, which emits case.prepared) —
  //   it just returns to its caller, which calls runCommit in the very same request
  //   (runB2BEvaluation.ts / runB2BCounterofferResponse.ts's evaluateAndAutoCommit). So
  //   "prepared" is only durably observable in the crash window between that transition
  //   and the commit call ever running. By definition every role has already decided by
  //   then (that's what made the case eligible for "prepared"), so the six-role
  //   checklist below is complete and accurate — just missing a dedicated label.
  // - "committing": commit.ts's prepared -> committing -> {committed | aborting}
  //   sequence also runs inside one function call with no intermediate event; durably
  //   reachable only for the instant between its own two transitionCase calls. Same
  //   situation as "prepared" — decisions are all in, nothing more specific to show.
  //
  // Both are imprecise (a dedicated "preparing"-style label would be nicer) but not
  // wrong, the same standard deriveMarketState.ts holds its own "intake"/"prepared"
  // crash-window fallback to.
  return { stage: "evaluating", label: STAGE_LABELS.evaluating, roles, certificateId: null, reason: null, counterofferTerms: null };
}
