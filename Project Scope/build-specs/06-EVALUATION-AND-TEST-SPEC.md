# CommitOS Evaluation and Test Specification

## Evaluation objective

Prove that CommitOS reaches correct, independently verifiable terminal states across repeated cases. The evaluation does not score persuasive explanations. It scores state, receipts, policy compliance, idempotency, recovery, and absence of unauthorized effects.

## Test layers

### Deterministic unit tests

Cover:

- deal economics and contribution margin;
- credit exposure and payment-term policy;
- inventory and shortfall arithmetic;
- reservation TTL and freshness;
- terms-hash canonicalization;
- complete reservation-set validation;
- state transition guards;
- idempotency-key generation;
- compensation selection;
- terminal-state verification.

These tests must not call a model or external service.

### Agent contract tests

For each role:

- output validates against `DomainDecision`;
- output uses the supplied case version and terms hash;
- evidence references come from available tools;
- forbidden tools are absent and denied if attempted;
- missing evidence produces `unavailable` or `veto`;
- repeated fixture input remains inside permitted decision bounds;
- explanations do not introduce trusted values absent from typed fields.

### Integration tests

Cover:

- model gateway adapter with recorded organizer-compatible responses or a local fake;
- Supabase persistence and optimistic concurrency;
- reservation and receipt creation;
- signed buyer link and replay protection;
- Stripe test checkout and idempotency;
- outbox writes;
- disruption and compensation;
- page reload and case resumption.

### End-to-end evaluation

Run the three known-answer fixtures through the deployed UI or public API. Each case runs three consecutive times after a fixture reset.

## Known-answer cases

### Case 1: Feasible after advance payment

**Fixture:** `CASE-FEASIBLE-AFTER-ADVANCE`

Initial request:

- 25,000 units;
- ₹74 lakh order value;
- 12% discount;
- Net-60;
- delivery within 14 days.

Initial evidence:

- 14,200 units available in current inventory;
- 10,800-unit supplier option available;
- delivery capacity available for a split plan;
- Net-60 breaches credit policy;
- 30% advance satisfies credit and margin policy.

Expected sequence:

1. Finance returns `counter` for Net-60.
2. Inventory and supplier/logistics holds are created or prepared within policy.
3. Sales produces only the permitted 30% advance counterterm.
4. Buyer accepts.
5. Finance and Risk rerun against the new terms.
6. Certificate becomes valid and is consumed once.
7. Sandbox order and CRM state commit.
8. Inventory totals 25,000 backed units across inventory and supplier option.
9. Stripe test checkout amount is ₹22.2 lakh.
10. Backed promise appears in the outbox.

Expected terminal state: `committed`.

### Case 2: Supplier hold expires before commit

**Fixture:** `CASE-STALE-SUPPLIER-HOLD`

The supplier-option TTL expires after domain evaluation and before certificate consumption.

Expected sequence:

1. Coordinator detects the expired reservation.
2. Certificate remains draft or becomes superseded; it is never consumed.
3. Inventory, credit, and logistics holds release exactly once.
4. No committed order exists.
5. No backed customer promise is sent.
6. No deposit checkout is released to the buyer.
7. Timeline identifies the exact supplier reservation and expiry.

Expected terminal state: `cannot_commit`.

### Case 3: Supplier disruption after commit

**Fixture:** `CASE-POST-COMMIT-DISRUPTION`

The initial request commits using Supplier B. A persisted event then marks Supplier B unavailable. The fixture contains Supplier C as a valid replacement for 10,800 units with a contribution margin above the 14% floor and a delivery plan inside the accepted deadline.

Expected sequence:

1. Original certificate becomes `broken` and remains in history.
2. Supplier B and affected logistics effects receive compensation receipts exactly once.
3. Procurement, Logistics, and Risk rerun against a new case version.
4. Inventory and Finance decisions are reused only after freshness validation.
5. Supplier C and revised logistics reservations are created.
6. A new certificate references the broken certificate and is consumed once.
7. Sandbox order and CRM show repaired status.
8. Customer correction links the original and repaired commitments.

Expected terminal state: `repaired`.

## Adversarial checks

- Send duplicate buyer acceptance requests.
- Deliver the same supplier-disruption event twice.
- Return a Finance decision with the Inventory tool call.
- Return valid prose but omit the typed reservation request.
- Mix a Finance decision from terms v1 with Inventory from terms v2.
- Expire one hold one second before certificate validation.
- Retry Stripe checkout creation after a simulated timeout.
- Reload the operator UI during `committing`.
- Tamper with a buyer token or use it after expiry.
- Force the model gateway to time out for one required role.

Every adversarial check must fail closed and leave no unauthorized terminal state.

## Evaluation metrics

For each run capture:

- expected terminal state;
- actual terminal state;
- exact-state pass/fail;
- required receipts present;
- unexpected receipts count;
- duplicate effects count;
- policy violations count;
- total workflow time;
- model calls by role;
- tool calls by role;
- retry count;
- compensation completion time;
- ApplyBee/Hive request IDs when available.

## Pass criteria

- Three consecutive passing runs for each known-answer case.
- At least 85% exact task success across the full recorded run set.
- Zero unauthorized or duplicate mutations.
- Zero certificates with incomplete, stale, or cross-version reservations.
- All committed or repaired outcomes have independently verifiable receipts.
- All failed outcomes expose the exact blocking dependency.
- Main demo case completes within 90 seconds under event conditions.

## Rubric evidence

### Novelty

- Protected Promise API rejects unbacked actions.
- Six roles have distinct context and authority.
- Commit Certificate binds cross-domain reservations.
- Broken certificate triggers receipted compensation and repair.

### Job completion

- Cases end in `committed`, `cannot_commit`, or `repaired` with verified state.
- No case ends at a recommendation.

### Memory and context

- Identity, case, terms, policies, decisions, buyer response, reservations, and repair history persist across sessions.

### Creativity

- A board meeting is replaced with a transaction protocol.
- The primary UI is a commitment graph and evidence timeline, not chat.

### Impact

- Deterministic fixture calculations show exposure, protected margin, and elapsed time.
- Claims remain staged until validated with real users.

### Delight

- Red constraints visibly become a green backed certificate.
- A judge-triggered disruption repairs the state without losing context.

## Evidence package

Generate or capture:

```text
submission/
  three-case-results.csv
  before-after-state.json
  action-receipts/
  architecture.png
  roi-calculation.md
  validation-notes.md
  live-demo-script.md
  demo-backup.mp4
```

This package is a build output and should be created during the hackathon, not pre-populated with fabricated results.
