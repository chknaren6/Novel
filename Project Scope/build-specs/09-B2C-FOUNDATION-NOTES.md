# B2C Foundation Notes

Two findings from validating `commitos-b2c-product-spec.md` against the existing
B2B architecture that required no schema or code change, but do need to be honored
by whichever plan builds the actual B2C workflow next.

## 1. The async human-negotiation pause point already exists as a pattern

`evaluateAndRoute` (B2B) runs all six roles synchronously start-to-finish with no
pause point. B2C's Step 3 ("The AI does not negotiate autonomously in Phase 1" — a
human negotiator must act, which can take hours or days) needs a workflow that can
sit indefinitely and resume later.

That pattern already exists: `transitionCase` (`src/state/transitions.ts`) and
`emitCaseEvent` are domain-agnostic — they don't assume the B2B six-role fanout. The
existing buyer-accept/reject flow (resumes from `negotiating` after an arbitrary-delay
human action) is the model to mirror for B2C's supplier-side negotiation — but on the
supplier side, which has no equivalent code yet. No schema change needed; the primitive
is already generic. The next plan should reuse `transitionCase`/`emitCaseEvent`
directly rather than inventing new state-transition machinery.

## 2. B2C's "Negotiation" step must not reuse the `negotiating` CaseStatus

The existing `negotiating` status means specifically "buyer-facing counteroffer sent,
awaiting buyer response," with only `negotiating → evaluating | cannot_commit` as legal
transitions (`04-DATA-AND-STATE-SPEC.md`) — no path to `prepared`. B2C's own spec calls
its supplier-negotiation step "Negotiation" (§3), but that step happens *before* a buyer
quote exists and must lead into `prepared`, which the current `negotiating` status
cannot do without breaking the documented transition table.

**Decision:** B2C's supplier-negotiation step stays inside the `evaluating` status.
Do not introduce a case transition out of `negotiating` into `prepared`, and do not
name any B2C case-status value "negotiating" — pick a different name (e.g. `sourcing`)
only if a distinct, observable status is later found to be worth the transition-table
change; until then, no new status is needed at all.
