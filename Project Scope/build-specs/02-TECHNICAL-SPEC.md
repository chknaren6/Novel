# CommitOS Technical Specification

## Architecture objective

Build one production-shaped, event-driven workflow that turns ambiguous commercial input into deterministic, receipted business state. Optimize for correctness, observability, and demo reliability rather than breadth.

## Logical architecture

```text
Operator UI                Buyer counteroffer page
      \                             /
       \                           /
        Protected Promise API + Case API
                       |
              Deterministic workflow
            /          |           \
   Hive role calls  Policy core  Reservation coordinator
          |             |           |
  ApplyBee/Hive      Postgres     Sandbox adapters
  model gateway       state       + Stripe test mode
                       |
                Receipt/event timeline
```

## Recommended implementation stack

Use the simplest Emergent-generated full-stack scaffold that supports typed server code, authenticated routes, and deployment. Prefer Next.js with TypeScript when Emergent offers a choice. If Emergent generates a React frontend plus a separate API service, preserve that scaffold and implement the interfaces in this specification rather than migrating frameworks during the hackathon.

Required infrastructure:

- React-based web UI generated through Emergent.
- Typed server-side API.
- Supabase Postgres for durable state and authentication.
- ApplyBee/Hive gateway for all role-agent model calls.
- Stripe test mode for deposit and optional paid-pilot checkout.
- Sandbox ERP/CRM, supplier, and logistics adapters backed by Postgres tables.
- Hosted deployment produced through Emergent or its generated deployment path.

Do not add a multi-agent framework merely to coordinate six fixed role calls. A small deterministic workflow using native concurrency is sufficient.

## Components

### Operator application

- Deal intake and fixture selector.
- Normalized terms view.
- Six role decision cards.
- Reservation and certificate graph.
- Buyer-response status.
- Receipt and event timeline.
- Judge-triggered supplier disruption control.
- Final-state and evidence export.

### Buyer application

- Signed token lookup.
- Original and proposed terms comparison.
- Accept, reject, and bounded-counterterm actions.
- Expiration and honest status communication.
- Backed commitment and Stripe test checkout link.

### Case API

- Creates and reads versioned cases.
- Accepts buyer responses.
- Emits persisted domain events.
- Returns current state and chronological timeline.
- Requires authenticated operator access except signed buyer routes.

### Deterministic workflow

- Invokes the Sales role to normalize intent.
- Invokes Finance, Inventory, Procurement, and Logistics concurrently, then invokes Risk against their typed decisions and evidence metadata.
- Validates every `DomainDecision` against a schema and case version.
- Runs deterministic feasibility rules.
- Requests reservations through scoped tools.
- Routes to counteroffer, prepare, commit, abort, repair, or escalation.
- Never delegates terminal-state choice to an LLM.

### Policy core

- Computes totals, contribution margin, credit exposure, and quantity coverage.
- Verifies dates, TTLs, permissions, policy versions, and evidence freshness.
- Rejects cross-version reservation sets.
- Produces typed rule results with machine-readable reason codes.

### Reservation coordinator

- Creates idempotent holds.
- Verifies a complete reservation set.
- Mints and consumes certificates.
- Commits protected mutations.
- Releases holds on abort.
- Runs permitted compensations after disruption.
- Records one receipt per attempted effect.

### Model gateway

```typescript
interface ModelGateway {
  runRole(input: RoleRunInput): Promise<DomainDecision>;
}
```

The gateway maps the internal request to the organizer-provided ApplyBee/Hive API. No product component imports an unverified organizer SDK directly.

Required runtime configuration:

```text
APPLYBEE_API_KEY
APPLYBEE_BASE_URL
APPLYBEE_MODEL_ID
APPLYBEE_REQUEST_TIMEOUT_MS
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
APP_BASE_URL
BUYER_LINK_SIGNING_SECRET
```

The application must fail startup validation when required variables are absent. The repository contains an example environment file with variable names only after implementation begins; it must never contain credentials.

## Event-driven execution

CommitOS does not run a continuous reasoning loop. It starts a bounded workflow in response to one of these events:

- `deal.submitted`
- `buyer.counterterm_accepted`
- `buyer.counterterm_rejected`
- `reservation.expired`
- `supplier.disrupted`
- `commit.requested`
- `repair.requested`

Each handler loads the current case version, performs permitted transitions, persists its result, and stops. Production integrations may deliver webhooks or scheduled expiry events. The hackathon supplier event is triggered by a judge-visible control.

## Request flow

### Initial evaluation

1. Persist raw request and create terms version 1.
2. Run Sales to normalize or clarify bounded ambiguity.
3. Run Finance, Inventory, Procurement, and Logistics concurrently.
4. Validate their typed outputs, then run Risk against their decisions and evidence metadata.
5. Execute deterministic feasibility checks.
6. If feasible, create or retain valid holds and prepare a certificate.
7. If infeasible but repairable by permitted terms, create terms version 2 and a buyer counteroffer.
8. Otherwise finish as `cannot_commit`.

### Buyer acceptance

1. Verify signed buyer token, expiry, offer status, and case version.
2. Persist the accepted terms as the active version.
3. Rerun only roles affected by the changed fields.
4. Create or refresh reservations.
5. Verify the complete set and mint a valid certificate.
6. Commit protected actions through the outbox.
7. Mark the certificate consumed and the case committed only after receipt verification.

### Disruption and repair

1. Persist the supplier disruption event.
2. Mark the consumed certificate broken without deleting it.
3. Run affected compensations exactly once.
4. Rerun Procurement, Logistics, and Risk against a new case version.
5. Issue a repaired certificate only if all current dependencies are backed.
6. Otherwise finish as `escalated` with the exact unresolved dependency.

## Transaction strategy

Use a local database transaction for state owned by Postgres and an outbox/saga pattern for external-style effects.

- Create one `action_receipt` row before attempting an effect.
- Use a deterministic idempotency key derived from case, version, action type, and resource.
- Mark the receipt `succeeded`, `failed`, or `compensated` after the adapter returns.
- Retries reuse the same idempotency key.
- Terminal state changes only after required receipts reach the expected status.

## Authentication and authorization

- Operators authenticate through Supabase Auth.
- Buyer links use random signed tokens stored only as hashes.
- Buyer tokens are scoped to one offer and expire.
- Role tool permissions are enforced by server-side policy, not prompts.
- Service-role database credentials never reach the browser.
- Mutation endpoints require current case version and idempotency key.
- Risk has read-only tools.
- Only the coordinator may mint or consume certificates.

## Observability

Every workflow run records:

- trace ID;
- case and terms version;
- role ID;
- ApplyBee/Hive request ID when available;
- model ID supplied at runtime;
- input context references, not raw secrets;
- structured output validation result;
- tool calls and receipts;
- rule checks and reason codes;
- transition from and to state;
- elapsed time and token usage when provided.

The operator timeline renders from persisted events. It is not reconstructed from console logs or LLM prose.

## Reliability behavior

- Model timeout: mark role `unavailable`; block certificate; allow explicit retry.
- Invalid model output: store validation failure; retry once with the same case version; block after second failure.
- Stale case version: discard the decision and rerun the affected role.
- Expired hold: abort preparation and release remaining holds.
- Duplicate event: return the existing receipt and state.
- Stripe failure: do not mark the case committed; compensate or retain prepared state according to receipt status.
- Unknown disruption: escalate without inventing a repair.

## Deployment acceptance

- Public HTTPS deployment loads without local dependencies.
- Operator and buyer routes work in separate browser sessions.
- Database migrations are reproducible.
- Startup checks reject missing secrets.
- Health endpoint verifies database access and reports Hive/Stripe configuration presence without exposing values.
- Seed command loads exactly the three evaluation fixtures.
- Demo can recover from a page reload at every persisted state.
