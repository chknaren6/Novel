# CommitOS Agent Architecture

## Decision

CommitOS uses six logical role agents instantiated from one shared runtime. It does not use one omniscient agent and does not implement six conversational agents.

The same underlying model may serve every role. An agent is distinguished by its isolated context, objective, tool permissions, memory namespace, decision authority, and persisted output—not by requiring a separate model deployment.

## Why multiple logical agents are necessary

The core problem contains genuinely parallel business authorities:

- Finance can veto credit terms but cannot allocate stock.
- Inventory can hold current stock but cannot assume supplier supply.
- Procurement can option future supply but cannot override margin.
- Logistics can reserve delivery capacity but cannot create inventory.
- Risk can challenge stale evidence but cannot mutate business state.
- Sales can propose customer terms but cannot manufacture another role’s approval.

A single agent with every tool would have excessive context and authority. Six bespoke conversational agents would add cost and coordination failure without improving terminal-state correctness. Config-driven role instances preserve independent authority with one implementation.

## Shared runtime

```typescript
type RoleId =
  | "sales"
  | "finance"
  | "inventory"
  | "procurement"
  | "logistics"
  | "risk";

interface RoleConfig {
  role: RoleId;
  objective: string;
  visibleContextSelectors: string[];
  allowedReadTools: string[];
  allowedMutationTools: string[];
  authority: string[];
  memoryNamespace: string;
}

async function runRoleAgent(
  config: RoleConfig,
  snapshot: RoleCaseSnapshot,
): Promise<DomainDecision>;
```

The runtime:

1. Loads only the context permitted by the role configuration.
2. Constructs the role system prompt.
3. Exposes only allowed tools.
4. Calls the ApplyBee/Hive gateway with structured output enabled.
5. Validates the returned `DomainDecision`.
6. Persists the decision with trace and case-version metadata.

## Shared decision contract

```typescript
interface DomainDecision {
  decisionId: string;
  caseId: string;
  caseVersion: number;
  termsHash: string;
  role: RoleId;
  decision: "approve" | "counter" | "veto" | "unavailable";
  constraints: ConstraintFinding[];
  reservationRequests: ReservationRequest[];
  counterterms: Counterterm[];
  evidenceRefs: string[];
  expiresAt: string;
  explanation: string;
}
```

The explanation is operator-facing. Every other field is machine-validated. An explanation can never substitute for a missing reservation request, evidence reference, or typed decision.

## Role definitions

### Sales

**Objective:** maximize acceptable account value while proposing only bounded terms supported by other domains.

**Visible context:** buyer request, CRM relationship summary, current terms, permitted commercial levers, and verified constraint summaries returned by the workflow.

**Tools:** read CRM summary, normalize buyer request, create non-binding counteroffer draft, write operator explanation.

**Authority:** propose terms and counterterms. Sales cannot hold resources, approve credit, mint certificates, commit orders, or send a binding quote.

### Finance

**Objective:** protect contribution margin, credit exposure, and working-capital policy.

**Visible context:** price, cost components, customer receivables, credit limit, payment history summary, margin floor, and permitted payment-term policies.

**Tools:** read credit context, calculate exposure through deterministic tool, request credit-envelope hold.

**Authority:** approve, counter, or veto credit and payment terms. Finance cannot change quantity, stock, supplier, or logistics state.

### Inventory

**Objective:** allocate currently available stock without violating existing commitments.

**Visible context:** SKU, warehouse quantities, committed allocation, lot status, and hold TTL policy.

**Tools:** read inventory positions, request expiring inventory hold, release its own uncommitted hold through coordinator request.

**Authority:** approve or veto current-stock allocation. Inventory cannot assume incoming supply.

### Procurement

**Objective:** cover supply shortfall at permitted cost and lead time.

**Visible context:** shortfall, approved suppliers, quote price, MOQ, lead time, option TTL, and supplier status.

**Tools:** read supplier options, request supplier-option hold.

**Authority:** approve, counter, or veto external-supply coverage. Procurement cannot approve final margin or delivery promise.

### Logistics

**Objective:** produce a deliverable shipment plan using only backed quantities.

**Visible context:** inventory and supplier availability references, origin, destination, lane, carrier/service options, cutoff, slot capacity, delivery policy, and cost.

**Tools:** read delivery options, request delivery-slot hold.

**Authority:** approve, counter, or veto delivery dates and split plan. Logistics cannot create stock.

### Risk

**Objective:** falsify unsafe commitments and expose stale or unsupported evidence.

**Visible context:** decision metadata, evidence timestamps, concentration rules, policy versions, reservation coverage, and terms hash.

**Tools:** read-only evidence and policy tools.

**Authority:** challenge or veto through a typed finding. Risk has no mutation tools and cannot mint a certificate.

## Call topology

### Initial request

1. Sales normalizes the buyer request.
2. Finance, Inventory, Procurement, and Logistics run concurrently against the same case version.
3. Risk runs after those four decisions exist, using their evidence metadata and reservation coverage without gaining access to private source data.
4. The deterministic workflow validates and combines all six role outputs.
5. If the request is infeasible but a permitted change can repair it, Sales receives typed constraint summaries and creates bounded counterterms.

### Buyer response

The workflow computes which fields changed and reruns only affected roles. Changing Net-60 to a 30% advance must rerun Finance and Risk. It must not rerun Inventory unless quantity, SKU, warehouse, or hold freshness changed.

### Supplier disruption

The workflow creates a new case version and reruns Procurement, Logistics, and Risk. Finance and Inventory decisions remain usable only when their evidence and reservations are still current and bound to unchanged terms.

## No conversational group chat

Agents do not exchange prose. They publish typed decisions to case state. This prevents one agent from persuading another to ignore policy, silently changing a shared narrative, or fabricating consensus.

The UI may show concise explanations in chronological order, but those explanations are a rendering of independent decisions and receipts—not an execution channel.

## Context and memory

- Current task state lives in Postgres, not the model transcript.
- Each role receives a fresh bounded snapshot for each run.
- Role memory contains only references relevant to the current authenticated company and case.
- Buyer responses and prior decisions are loaded by case ID and version.
- Sensitive raw data is replaced by minimum required fields or references.
- No role may read another role’s private source data unless the workflow exposes a typed derived result.

This makes reloads and handoffs reliable and avoids depending on one long conversation history.

## Prompt requirements

Every role system prompt must state:

- its objective;
- visible facts and their source timestamps;
- allowed tools and forbidden actions;
- required output schema;
- that missing evidence produces `unavailable` or `veto`;
- that it must never invent a receipt, identifier, balance, quantity, price, or date;
- that deterministic tool results override its reasoning;
- that it may not claim another role approved anything.

Prompts must be short, role-specific, and stored in versioned source code. Do not dynamically rewrite prompts based on agent output.

## Tool-call policy

- Tool authorization is enforced on the server.
- Read tools return typed facts with timestamps and evidence IDs.
- Hold tools enforce quantity, TTL, ownership, policy, and idempotency before mutation.
- Roles may request or invoke only their scoped hold tools.
- Only the deterministic coordinator can commit, abort, compensate, mint, consume, or break a certificate.

## Failure behavior

- Timeout produces `unavailable`, not an assumed approval.
- Invalid structured output receives one schema-repair retry.
- A second invalid output blocks the case and records the validation error.
- A stale decision is discarded and rerun.
- A forbidden tool attempt is denied, traced, and fails the role run.
- Conflicting counterterms are passed to deterministic feasibility checks before Sales sees them.
- No fallback combines all roles into one omniscient prompt.

## Cost and latency controls

- Run Finance, Inventory, Procurement, and Logistics concurrently; run Risk once their typed decisions exist.
- Supply each role only its scoped context.
- Use one model selected at kickoff unless the Hive platform requires otherwise.
- Limit each role to one bounded reasoning/tool round plus one schema-repair retry.
- Rerun only affected roles after an event.
- Cache immutable fixture reads within a workflow run, never across changed case versions.

## Acceptance tests

- Changing only payment terms changes Finance and Risk decisions while unrelated role decisions remain unchanged.
- Reducing available stock changes Inventory, Procurement, Logistics, and Risk outcomes without granting Sales new authority.
- A role cannot call another role’s mutation tool.
- Six decisions against different terms hashes cannot mint a certificate.
- One unavailable required role blocks commitment.
- Repeated runs against the same state do not create duplicate holds.
