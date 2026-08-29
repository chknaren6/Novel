# CommitOS Data and State Specification

## State ownership

Postgres is the source of truth. Model transcripts, browser state, console logs, and UI animations are not authoritative.

All timestamps are stored in UTC. Money is stored as integer minor units with an explicit currency. Quantities are integers for the MVP SKU. Every mutable aggregate has a monotonically increasing version.

## Core entities

### `deal_case`

```yaml
id: uuid
company_id: uuid
customer_id: string
active_terms_version: integer
status: intake | evaluating | negotiating | prepared | committing | committed | cannot_commit | aborting | repair_needed | compensating | repaired | escalated
created_by: uuid
created_at: timestamp
updated_at: timestamp
```

### `terms_version`

```yaml
id: uuid
case_id: uuid
version: integer
parent_version: integer | null
source: buyer_request | sales_normalization | counteroffer | buyer_acceptance | repair
terms_hash: string
sku: string
quantity: integer
currency: INR
total_value_minor: integer
discount_bps: integer
payment_terms: NET_60 | ADVANCE_30 | OTHER_BOUNDED
delivery_deadline: timestamp
created_at: timestamp
```

`terms_hash` is a canonical hash of all fields that affect a promise. A certificate and every included reservation must reference the same hash.

### `domain_decision`

```yaml
id: uuid
case_id: uuid
case_version: integer
terms_hash: string
role: sales | finance | inventory | procurement | logistics | risk
decision: approve | counter | veto | unavailable
payload: jsonb
evidence_refs: jsonb
expires_at: timestamp
model_id: string
gateway_request_id: string | null
trace_id: string
created_at: timestamp
```

### `reservation`

```yaml
id: uuid
case_id: uuid
case_version: integer
terms_hash: string
domain: credit | inventory | supplier | logistics
resource_ref: string
quantity_minor: integer
limit_minor: integer | null
status: requested | held | committed | released | expired | failed
policy_version: string
expires_at: timestamp
idempotency_key: string
receipt_id: uuid
created_at: timestamp
updated_at: timestamp
```

Only one of `quantity_minor` or `limit_minor` is meaningful for a given reservation type. Application validation enforces the correct shape.

### `commit_certificate`

```yaml
id: uuid
case_id: uuid
case_version: integer
terms_hash: string
reservation_ids: uuid[]
policy_versions: jsonb
valid_until: timestamp
status: draft | valid | consumed | broken | compensated | superseded
supersedes_certificate_id: uuid | null
certificate_hash: string
created_at: timestamp
consumed_at: timestamp | null
broken_at: timestamp | null
```

### `action_receipt`

```yaml
id: uuid
case_id: uuid
case_version: integer
action_type: string
resource_ref: string
idempotency_key: string
request_hash: string
status: pending | succeeded | failed | compensation_pending | compensated
provider: sandbox_erp | sandbox_crm | inventory | supplier | logistics | stripe | outbox
provider_receipt_ref: string | null
response_payload: jsonb
attempt_count: integer
created_at: timestamp
updated_at: timestamp
```

### `case_event`

```yaml
id: uuid
case_id: uuid
sequence: integer
event_type: string
case_version: integer
actor_type: operator | buyer | agent | coordinator | adapter | scheduler
actor_ref: string
payload: jsonb
trace_id: string
created_at: timestamp
```

`sequence` is unique per case and provides a stable evidence timeline.

### `counteroffer`

```yaml
id: uuid
case_id: uuid
source_terms_version: integer
proposed_terms_version: integer
token_hash: string
status: draft | sent | accepted | rejected | expired
expires_at: timestamp
responded_at: timestamp | null
created_at: timestamp
```

## Case transitions

Allowed transitions:

```text
intake → evaluating
evaluating → negotiating | prepared | cannot_commit
negotiating → evaluating | cannot_commit
prepared → committing | aborting
committing → committed | aborting
aborting → cannot_commit | escalated
committed → repair_needed
repair_needed → compensating | escalated
compensating → evaluating | repaired | escalated
evaluating → repaired when processing a repair version
```

Every transition is executed by one server function that verifies the expected current state and case version. Arbitrary status updates are forbidden.

## Reservation lifecycle

```text
requested → held → committed
requested → failed
held → released
held → expired
held → failed
```

- A held reservation is tentative and has a TTL.
- A committed reservation backs a consumed certificate.
- Release and expiry are terminal for that reservation row.
- Repair creates new reservation rows. It does not resurrect expired or released rows.

## Certificate lifecycle

```text
draft → valid → consumed
valid → superseded
consumed → broken → compensated
```

A repaired certificate references the broken or compensated certificate through `supersedes_certificate_id`; it does not overwrite the original certificate's audit state.

The coordinator may mark a draft certificate valid only when:

- every required domain is covered;
- every reservation is `held`;
- every reservation has the same case ID, case version, and terms hash;
- every reservation is unexpired;
- required policy versions match the current policy set;
- the deterministic rule set passes;
- the certificate validity does not exceed the earliest reservation expiry.

## Commit boundary

Before commit, terms and reservations are tentative. Abort releases held resources and no binding customer promise is sent.

The commit boundary occurs when the coordinator consumes a valid certificate and completes all required protected actions:

- sandbox order accepted;
- inventory allocation committed;
- supplier and logistics holds committed;
- CRM stage updated;
- Stripe test checkout released;
- backed customer message placed in the outbox.

The case becomes `committed` only after the required action receipts are `succeeded`.

## Compensation behavior

Post-commit effects are not deleted. They are compensated through new receipted actions.

| Effect | Compensation in MVP |
|---|---|
| Inventory allocation | Release affected allocation or create adjustment receipt |
| Supplier option | Cancel option and record cancellation receipt |
| Logistics slot | Release slot and record release receipt |
| Stripe checkout not paid | Expire the test checkout session |
| Sandbox order | Mark `repair_pending`, then `repaired` or `cancelled` |
| CRM stage | Move to `repair_needed` or `escalated` with history |
| Customer message | Send correction; never delete the original message |

Real-money refunds are outside the MVP. If a Stripe test payment is completed in an adversarial run, the case escalates unless the implemented test adapter supports an idempotent test refund.

## Invariants

1. One active terms version per case.
2. No certificate spans terms hashes or case versions.
3. No certificate includes an expired, released, failed, or already-consumed reservation.
4. No binding quote or order commit occurs without a valid certificate.
5. No LLM call directly writes a case terminal state.
6. Every external-style mutation has one stable idempotency key.
7. Replaying the same event cannot create a second successful effect.
8. Historical terms, certificates, receipts, and customer messages are immutable.
9. Repair creates a new version and references the broken certificate.
10. Missing evidence fails closed.

## Concurrency control

- Case updates use optimistic version checks.
- Reservation creation uses unique idempotency keys.
- Certificate minting locks the case row for the duration of local validation and insert.
- Buyer responses require the exact active counteroffer and source case version.
- Duplicate webhooks return the existing event and receipt result.
- Expiry processing checks current reservation status before transition.

## Data retention and privacy

- Use synthetic fixture data only during the hackathon.
- Do not store raw model secrets, access tokens, or full third-party credentials in events.
- Store organizer gateway request IDs when available, not raw authorization headers.
- Buyer tokens are stored as hashes.
- Receipt payloads are allow-listed before persistence and display.
- Company and user IDs scope every query.

## Seeded evaluation cases

The seed operation inserts three isolated companies/cases or resets one fixture namespace transactionally. It must never delete non-fixture records.

- `CASE-FEASIBLE-AFTER-ADVANCE`
- `CASE-STALE-SUPPLIER-HOLD`
- `CASE-POST-COMMIT-DISRUPTION`
