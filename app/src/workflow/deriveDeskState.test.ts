import { describe, expect, it } from "vitest";
import { deriveDeskState } from "./deriveDeskState";
import type { DomainDecision, RoleId } from "@/lib/types";

// Builds a minimal-but-schema-shaped DomainDecision for a given role/decision, the same
// fields runRoleAgent's persistDecision actually assigns (src/roles/roleRuntime.ts).
function decisionFor(role: RoleId, decision: DomainDecision["decision"], overrides: Partial<DomainDecision> = {}): DomainDecision {
  return {
    decisionId: `dec-${role}`,
    caseId: "case-1",
    caseVersion: 1,
    termsHash: "hash-1",
    role,
    decision,
    constraints: [],
    reservationRequests: [],
    counterterms: [],
    evidenceRefs: [`evidence-${role}`],
    explanation: `${role} explanation`,
    expiresAt: new Date().toISOString(),
    ...overrides,
  };
}

const ALL_ROLES: RoleId[] = ["sales", "finance", "inventory", "procurement", "logistics", "risk"];

describe("deriveDeskState", () => {
  it("is awaiting_submission at intake, with every role pending", () => {
    const state = deriveDeskState({ status: "intake" }, [], {});
    expect(state.stage).toBe("awaiting_submission");
    expect(state.roles).toHaveLength(6);
    expect(state.roles.map((r) => r.role)).toEqual(ALL_ROLES);
    expect(state.roles.every((r) => r.decision === "pending")).toBe(true);
    expect(state.certificateId).toBeNull();
    expect(state.reason).toBeNull();
    expect(state.counterofferTerms).toBeNull();
  });

  it("is evaluating with all roles pending before any DomainDecision row exists", () => {
    const state = deriveDeskState({ status: "evaluating" }, [], {});
    expect(state.stage).toBe("evaluating");
    expect(state.roles.every((r) => r.decision === "pending")).toBe(true);
  });

  it("surfaces partial progress mid-evaluation: sales/finance/inventory/procurement/logistics decided, risk still pending", () => {
    // Matches dealSubmitted.ts's real execution order: sales runs first, then
    // finance/inventory/procurement/logistics concurrently, then risk last against
    // their evidence — so a live poll mid-evaluation can genuinely see every role but
    // risk already decided.
    const decisions = [
      decisionFor("sales", "approve"),
      decisionFor("finance", "approve"),
      decisionFor("inventory", "approve"),
      decisionFor("procurement", "counter"),
      decisionFor("logistics", "approve"),
    ];
    const state = deriveDeskState({ status: "evaluating" }, decisions, {});
    expect(state.stage).toBe("evaluating");

    const byRole = new Map(state.roles.map((r) => [r.role, r]));
    expect(byRole.get("sales")?.decision).toBe("approve");
    expect(byRole.get("finance")?.decision).toBe("approve");
    expect(byRole.get("inventory")?.decision).toBe("approve");
    expect(byRole.get("procurement")?.decision).toBe("counter");
    expect(byRole.get("procurement")?.explanation).toBe("procurement explanation");
    expect(byRole.get("procurement")?.evidenceRefs).toEqual(["evidence-procurement"]);
    expect(byRole.get("logistics")?.decision).toBe("approve");
    expect(byRole.get("risk")?.decision).toBe("pending");
    expect(byRole.get("risk")?.explanation).toBeNull();
    expect(byRole.get("risk")?.evidenceRefs).toEqual([]);
  });

  it("surfaces a veto from one role without hiding the others' real decisions", () => {
    const decisions = ALL_ROLES.map((role) => decisionFor(role, role === "risk" ? "veto" : "approve"));
    const state = deriveDeskState({ status: "evaluating" }, decisions, {});
    const byRole = new Map(state.roles.map((r) => [r.role, r]));
    expect(byRole.get("risk")?.decision).toBe("veto");
    expect(byRole.get("sales")?.decision).toBe("approve");
  });

  it("is negotiating with the proposed (not original) counteroffer terms", () => {
    const state = deriveDeskState(
      { status: "negotiating" },
      [],
      { counterofferTerms: { paymentTerms: "ADVANCE_30", totalValueMinor: 14_700_000 } },
    );
    expect(state.stage).toBe("negotiating");
    expect(state.counterofferTerms).toEqual({ paymentTerms: "ADVANCE_30", totalValueMinor: 14_700_000 });
  });

  it("is committed with the certificate id populated", () => {
    const state = deriveDeskState({ status: "committed" }, [], { certificateId: "CERT-1" });
    expect(state.stage).toBe("committed");
    expect(state.certificateId).toBe("CERT-1");
    expect(state.reason).toBeNull();
  });

  it("is cannot_commit with the recorded reason", () => {
    const state = deriveDeskState({ status: "cannot_commit" }, [], { reason: "risk_veto" });
    expect(state.stage).toBe("cannot_commit");
    expect(state.reason).toBe("risk_veto");
    expect(state.certificateId).toBeNull();
  });

  it("is escalated and surfaces the recorded reason", () => {
    const state = deriveDeskState({ status: "escalated" }, [], { reason: "PARTIAL_COMMIT: sandbox order failed" });
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("PARTIAL_COMMIT: sandbox order failed");
  });

  it("falls back to a generic reason when an escalated case has no recorded reason", () => {
    const state = deriveDeskState({ status: "escalated" }, [], {});
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("Unknown reason");
  });

  it("is escalated (rolling back) when a commit attempt is actively being aborted, ignoring any reason passed in", () => {
    // commit.ts never records a reason before reaching "aborting" (the case.escalated
    // event, and its reason, is only emitted once the case actually reaches
    // "escalated") — same as deriveMarketState's own "aborting" branch.
    const state = deriveDeskState({ status: "aborting" }, [], { reason: "should be ignored" });
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("Rolling back after a failed commit attempt.");
  });

  it("is evaluating for a prepared case, because dealSubmitted.ts records no signal event on reaching prepared", () => {
    // Unlike B2C's buyerResponse.ts, dealSubmitted.ts never emits a case.prepared (or
    // any other) event when it transitions evaluating -> prepared; it just returns to
    // its caller, which immediately calls runCommit in the same request
    // (runB2BEvaluation.ts / runB2BCounterofferResponse.ts). So "prepared" is reachable
    // only in the crash window between that transition and the commit call ever
    // running — by which point every role has already decided (that's what made the
    // case eligible for "prepared" at all), so folding it into "evaluating" (where the
    // six-role checklist is exactly what a viewer needs to see) is imprecise but not
    // wrong, the same standard deriveMarketState.ts holds its own "intake"/"prepared"
    // crash-window fallback to.
    const decisions = ALL_ROLES.map((role) => decisionFor(role, "approve"));
    const state = deriveDeskState({ status: "prepared" }, decisions, {});
    expect(state.stage).toBe("evaluating");
    expect(state.roles.every((r) => r.decision === "approve")).toBe(true);
  });

  it("is evaluating for a committing case, for the same reason as prepared: no committing-specific signal to show instead", () => {
    // commit.ts's prepared -> committing -> {committed | aborting} sequence runs inside
    // one function call with no durable "still committing" signal in between (unlike
    // B2C, which has no analog either — see deriveMarketState.ts's own comment on why
    // "committing" is never actually reached there, for a structurally similar reason).
    // For B2B, "committing" IS reachable at the DB level (durable status write) but only
    // for the instant between commit.ts's own two transitionCase calls, so there's
    // nothing more specific to show than "evaluating"'s completed checklist.
    const decisions = ALL_ROLES.map((role) => decisionFor(role, "approve"));
    const state = deriveDeskState({ status: "committing" }, decisions, {});
    expect(state.stage).toBe("evaluating");
  });

  it("is escalated for the not-yet-implemented repair/compensation statuses, as a safe 'needs attention' fallback", () => {
    // No workflow file anywhere in the codebase ever writes DealCase.status to
    // "repair_needed", "compensating", or "repaired" (grepped: the only "repaired"
    // write is SandboxOrder.status in sandboxErpAdapter.ts, an unrelated table; CRM's
    // "repair_needed" stage note in coordinator.ts doesn't touch DealCase either).
    // ALLOWED_TRANSITIONS in transitions.ts still permits committed -> repair_needed
    // and beyond, so this is a real (if currently unreachable) part of the state
    // machine's future surface, not a typo — bucketed under "escalated" (needs an
    // operator's attention) rather than silently defaulting to "evaluating", since
    // showing a live six-role checklist for a case that already committed and then
    // broke would be actively misleading.
    for (const status of ["repair_needed", "compensating", "repaired"] as const) {
      const state = deriveDeskState({ status }, [], {});
      expect(state.stage).toBe("escalated");
    }
  });
});
