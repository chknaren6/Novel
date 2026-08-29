# CommitOS — Detailed Project Scope

## A Universal, Agent-Orchestrated Commitment Control Plane

**Document status:** Product and architecture scope  
**Primary objective:** Define an industry-agnostic system that converts business requests into evidence-backed, executable commitments  
**Primary users:** Operations, commercial, finance, supply, capacity, risk, and fulfillment teams  
**Product category:** Commitment control plane / system of commitment  
**Research date:** August 29, 2026

---

## 1. Executive Summary

CommitOS is a cross-system commitment control plane that prevents an organization from promising an outcome unless every required operational domain can support it.

Organizations make promises before all of the supporting facts have been coordinated. A sales team promises a delivery date before production confirms capacity. A hotel promises a group event before rooms, catering, staff, and transport have been secured. A service provider promises a start date without reserving qualified people. A smaller custom-order business accepts an order through a message without knowing whether its materials and equipment can support it.

Existing systems usually hold fragments of the truth:

- CRM holds the commercial request;
- ERP holds inventory and purchasing information;
- MES holds production and machine state;
- PMS holds property or room availability;
- finance systems hold exposure, credit, and cash policy;
- workforce systems hold people and shift capacity;
- supplier and logistics systems hold external capacity;
- email, messaging, and spreadsheets hold the exception context that never reached a formal system.

CommitOS does not replace these systems. It coordinates them before the promise is released.

The product introduces a new operational object: the **Commit Certificate**. A certificate is issued only after every required domain has returned a current, authorized, machine-verifiable reservation or approval receipt. The certificate is time-bound, tied to the exact proposed terms, and required by downstream execution tools. If a dependency expires or fails, the certificate breaks and CommitOS either repairs the promise, compensates completed actions, or returns a truthful inability to fulfill.

The product combines:

1. AI-based interpretation of unstructured business requests;
2. dynamic selection of domain-specific agents;
3. privacy-preserving, permissioned access to operational context;
4. deterministic feasibility and policy validation;
5. expiring resource reservations;
6. a prepare/commit/abort transaction coordinator;
7. saga-style compensation across systems that cannot share an atomic transaction;
8. live monitoring and agentic repair after a commitment becomes invalid.

The product is industry-agnostic at its core. Industry and company adaptation occurs through **Commitment Packs**, which define resource types, dependency rules, policies, counterterm operators, user-facing terminology, and connector mappings without changing the central commitment protocol.

---

## 2. Project Definition

### 2.1 One-line product

> CommitOS turns a business request into a resource-backed commitment by making every relevant domain reserve or approve its dependency before the organization is allowed to promise the outcome.

### 2.2 Category definition

CommitOS is not intended to be:

- a replacement ERP;
- a generic workflow builder;
- a collection of departmental chatbots;
- an inventory forecasting application;
- a CRM plugin;
- a system-integration marketplace;
- a digital twin whose final output is only a forecast;
- an AI approval recommendation layer.

CommitOS is a **system of commitment** positioned above systems of record.

Systems of record answer:

> What does the organization currently believe or record?

CommitOS answers:

> Given the requested terms, what can the organization safely promise now, which resources back that promise, how long is the evidence valid, and what happens if a dependency changes?

### 2.3 Core product outcome

Every processed request must end in one of a small number of deterministic terminal outcomes:

- `committed` — every required dependency is valid and all required commit actions succeeded;
- `committed_after_counterterm` — the original request failed but a revised set of terms was backed and accepted;
- `cannot_commit` — one or more dependencies cannot be satisfied and no permitted counterterm works;
- `awaiting_authorized_exception` — an explicitly identified human authority is required;
- `repair_needed` — a previously valid certificate has broken and cannot yet be repaired automatically;
- `compensated` — previously executed actions were reversed or otherwise resolved according to policy.

The terminal outcome must never be a vague state such as `AI recommends approval`.

---

## 3. Problem Statement

### 3.1 The operational failure

Business commitments are cross-domain, but business systems and authority are fragmented.

A request can be commercially attractive and still be operationally impossible because:

- inventory is already allocated elsewhere;
- a supplier quotation has expired;
- a machine or room is unavailable;
- qualified labor is not scheduled;
- the delivery lane cannot meet the requested date;
- the customer exceeds credit policy;
- the requested discount destroys the required margin;
- a regulatory, quality, security, or legal approval is missing;
- the source evidence is stale;
- another team changed the resource after the original check;
- a partial write succeeded while another system failed.

Today, exception requests are commonly resolved through calls, meetings, messages, spreadsheets, and manual approvals. The final customer-facing promise may be made before all dependencies are secured, or it may be based on facts that were accurate when checked but no longer valid when the order was confirmed.

### 3.2 Why existing approval workflows are insufficient

An approval is not the same as a reservation.

A manager may approve a deal because the margin is acceptable, but that approval does not hold inventory. An operations manager may say a date appears feasible, but that statement does not reserve machine time. A finance team may approve credit, but the approval may become unsafe after another order consumes the same credit envelope.

CommitOS distinguishes four different concepts:

| Concept | Meaning |
|---|---|
| Observation | A fact was read from a source at a particular time |
| Approval | An authorized domain accepts the terms under a policy |
| Reservation | A resource or limit is held for this request until an expiry |
| Commitment | All required approvals and reservations are bound to the same terms and executed |

### 3.3 Why system integration alone is insufficient

Moving data between systems does not establish whether a promise is safe.

Integration platforms can synchronize customer, order, inventory, and invoice records. They generally do not provide a universal semantic protocol for:

- asking each domain whether it can support a promise;
- placing expiring reservations;
- negotiating bounded alternatives;
- invalidating an already-issued cross-domain certificate;
- compensating partial actions;
- proving which policy version and evidence supported the decision.

The integration layer is necessary infrastructure, but it is not the product's core value.

### 3.4 Why one centralized AI agent is insufficient

A single AI agent with access to all company data creates four problems:

1. **Authority ambiguity:** reading a fact does not grant authority to reserve or approve it.
2. **Privacy exposure:** sales should not receive unrestricted access to finance, supplier, payroll, or customer-risk information.
3. **Goal collapse:** one agent tends to blend conflicting objectives rather than preserve legitimate vetoes.
4. **Unverifiable state:** conversational agreement does not prove that a resource was actually held.

CommitOS therefore models agents as permissioned operational actors, not personas in a group chat.

---

## 4. Market Gap

### 4.1 Existing product categories

The market already contains valuable products in adjacent categories:

| Category | What it does well | Remaining gap addressed by CommitOS |
|---|---|---|
| ERP | Records and executes business transactions | Usually becomes authoritative after a decision or within one suite |
| CRM and CPQ | Manages opportunities, configuration, pricing, and quotes | Does not universally reserve operational dependencies across domains |
| Available-to-promise | Confirms product quantities and delivery dates | Often centered on supply, inventory, or production rather than the full commercial promise |
| MRP and production planning | Plans material and production requirements | Does not bind finance, customer terms, external logistics, and other domains into one customer authorization object |
| PMS and hospitality systems | Manages rooms, rates, reservations, and property operations | Complex events and promises may span departments and external providers beyond the PMS boundary |
| BPM and approval workflow | Routes tasks and decisions | An approval is not necessarily a resource hold or executable transaction |
| Integration platforms | Moves and transforms data | Does not define the commitment semantics or decide whether a promise is valid |
| Agent copilots | Interpret, summarize, recommend, and draft | Recommendations may be based on stale data and may not change operational state |
| Digital twins and optimizers | Simulate outcomes and compare plans | Simulation alone does not reserve resources or complete the business action |

### 4.2 Specific unmet need

The market gap is a reusable, enforceable layer that coordinates a promise across independent operational domains before the promise becomes externally binding.

The missing object is not another quote, workflow, approval, or forecast. It is a cross-domain authorization artifact that proves:

- the exact terms being promised;
- the resources and limits supporting those terms;
- the authorities that approved them;
- the policies under which they were approved;
- the time until which the evidence remains valid;
- the actions that must execute at commit;
- the compensations available if execution partially fails;
- the repair path if a dependency later breaks.

### 4.3 Initial market wedge

CommitOS should initially enter through high-value, non-standard promises where manual coordination is already painful.

Examples include:

- exception orders;
- expedited delivery requests;
- group and event commitments;
- custom manufacturing orders;
- orders requiring external supplier capacity;
- large discounts combined with credit terms;
- service start dates dependent on scarce staff;
- renewals containing operational or service guarantees.

The wedge is deliberately narrower than enterprise-wide transformation. Once CommitOS proves one promise type, the same control plane can add further dependency domains and promise types.

---

## 5. Product Thesis

### 5.1 Fundamental thesis

> A business promise should be treated as a distributed transaction over resources, policies, authorities, and external dependencies.

### 5.2 Consequences of the thesis

If the thesis is accepted, then:

1. every promise must be decomposed into explicit dependencies;
2. every dependency must have an owning authority;
3. volatile dependencies must be reserved or assigned an expiry;
4. approvals must be tied to exact terms and policy versions;
5. the customer must not receive committed terms until all required dependencies are prepared;
6. partial execution must be recoverable or escalated;
7. a material fact change must invalidate the affected certificate;
8. agent reasoning must remain subordinate to deterministic state and policy enforcement.

### 5.3 Product invariant

The primary invariant is:

> CommitOS cannot issue or consume a valid Commit Certificate unless every required dependency is satisfied by current, authorized evidence tied to the same terms.

---

## 6. Industry-Abstraction Model

CommitOS adapts to industries by translating industry-specific resources into a small universal model.

### 6.1 Universal objects

| Object | Definition |
|---|---|
| Promise Request | The outcome, terms, time, price, quantity, and conditions requested by a counterparty |
| Resource | Anything scarce or controlled that is required to fulfill the request |
| Capability | An ability to perform an activity within a quantity, quality, time, or policy boundary |
| Policy | A deterministic or authorized constraint governing the commitment |
| Dependency | A condition that must be satisfied for the promise to be valid |
| Evidence | A time-stamped observation supporting a decision |
| Reservation | A temporary or committed claim on a resource, limit, or capacity |
| Approval | An authorized acceptance that may not itself reserve a resource |
| Counterterm | A bounded change to the requested terms that may restore feasibility |
| Commit Certificate | The signed collection of all required dependency receipts for one exact terms hash |
| Compensation | An idempotent action that resolves or reverses a partial or failed commitment |

### 6.2 Resource taxonomy

Resources should be modeled generically:

- physical inventory;
- raw materials and components;
- rooms, spaces, seats, and facilities;
- machines, tools, production lines, and work centers;
- employee time, skills, and shifts;
- supplier options and external capacity;
- transport, delivery, and fulfillment slots;
- customer credit and organizational cash exposure;
- price and margin allowance;
- payment authorization or deposit;
- quality, regulatory, safety, legal, privacy, and security authority;
- entitlements, quotas, compute capacity, or service limits;
- evidence freshness and risk tolerance.

### 6.3 Commitment Packs

A Commitment Pack is a declarative package that adapts the core engine without creating a separate product.

Each pack defines:

- supported promise types;
- resource vocabulary and labels;
- default dependency templates;
- standard agent roles;
- triggers for conditional agents;
- required policy rules;
- permitted counterterms;
- evidence requirements;
- reservation and compensation actions;
- UI presentation rules;
- common adapter mappings;
- reference test fixtures.

An organization can extend a pack using configuration and approved custom policies. Core state transitions and certificate rules remain unchanged.

### 6.4 Illustrative mapping

| Abstract dependency | Hospitality example | Manufacturing example | Print-production example |
|---|---|---|---|
| Unit inventory | Room block | Finished goods | Blank items or paper |
| Input material | Food and event supplies | Components and raw material | Ink, film, paper, substrate |
| Facility capacity | Banquet space | Production line | Press and finishing machine |
| Workforce capacity | Housekeeping and event staff | Skilled shift labor | Operators and designers |
| External capacity | Transport or caterer | Supplier or subcontractor | Outsourced finishing or courier |
| Financial authority | Deposit and cancellation exposure | Margin and customer credit | Deposit and job margin |
| Quality or policy | Safety and service policy | Inspection and traceability | Artwork and print-quality approval |
| Delivery capability | Guest transport and event timing | Dispatch and freight | Packaging and courier slot |

### 6.5 Adaptation by company scale

The same protocol supports different organizational maturity:

| Capability | Smaller organization | Large organization |
|---|---|---|
| Source data | Built-in records, forms, spreadsheets, human confirmation | ERP, MES, PMS, CRM, data platforms, APIs |
| Agent ownership | Combined roles | Separate departments and authorities |
| Reservation quality | Internal soft hold or human attestation | Source-system-backed reservation |
| Deployment | Hosted or local-first application | Hybrid, private cloud, or on-premise Edge runtime |
| Policy complexity | Guided templates | Versioned enterprise policies and delegated limits |
| Orchestration depth | Two to five agents | Five to fifteen agents, potentially hierarchical |
| Integration | Manual, file, or simple API | Event-driven and transactional adapters |

Scale should primarily increase transaction volume, policy depth, and authority separation. It should not create unnecessary agents for simple requests.

---

## 7. System Architecture

### 7.1 High-level architecture

```text
Request Channels
CRM | ERP | PMS | MES | Email | Messaging | Form | API
                         |
                         v
              Intake and Interpretation Layer
                         |
                         v
               Commitment Graph Compiler
                         |
                         v
             Policy and Agent Selection Engine
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
     Domain Agent   Domain Agent   Domain Agent
          |              |              |
          v              v              v
     Edge Adapter   Edge Adapter   Human Portal
          |              |              |
          +--------------+--------------+
                         |
                         v
            Deterministic Coordinator
              prepare | commit | abort
                         |
                         v
                 Commit Certificate
                         |
                         v
              Execution and Monitoring
                         |
             repair | compensate | close
```

### 7.2 Logical components

#### A. Request Gateway

Accepts structured and unstructured requests from:

- APIs;
- forms;
- CRM or ERP events;
- emails and documents;
- messages copied or forwarded into the system;
- human operators;
- external agent protocols.

Responsibilities:

- authentication and tenancy;
- request identity and deduplication;
- attachment handling;
- source provenance;
- initial data classification;
- correlation and idempotency identifiers.

#### B. Intake and Interpretation Agent

Transforms unstructured language into a typed `PromiseRequest`.

Responsibilities:

- extract requested outcome and terms;
- identify missing or ambiguous information;
- normalize dates, quantities, units, currencies, and conditions;
- identify likely promise type;
- attach evidence spans back to the original request;
- provide an interpretation confidence score;
- request human clarification when ambiguity would materially affect feasibility.

The interpretation agent does not approve the request and cannot create reservations.

#### C. Commitment Graph Compiler

Combines the normalized request with the organization's Commitment Pack and capability manifest.

Responsibilities:

- expand the request into required dependencies;
- encode dependency order and conditional branches;
- identify the authority responsible for each dependency;
- define which dependencies can run in parallel;
- define freshness, evidence, and assurance requirements;
- identify available counterterm operators;
- attach compensation requirements to proposed mutations.

Output: a versioned directed acyclic graph for the initial preparation attempt. Repair can produce a new graph version linked to the prior certificate.

#### D. Agent Registry

Stores approved agent definitions.

An agent definition includes:

```yaml
agent:
  id: inventory_authority
  domain: inventory
  objective: preserve feasible allocation without double booking
  triggers:
    - dependency.type == physical_inventory
  context_scope:
    - sku
    - location
    - on_hand
    - existing_reservations
  authorities:
    - observe_inventory
    - place_inventory_hold
    - release_inventory_hold
  tools:
    - get_available_inventory
    - hold_inventory
    - release_inventory
  policies:
    - inventory_allocation_policy
  output_schema: DomainDecisionV1
  timeout_seconds: 20
  escalation_role: inventory_manager
```

The orchestrator may instantiate only registered agents. An LLM cannot invent a new authority or tool permission.

#### E. Policy Engine

Executes deterministic policies such as:

- minimum margin;
- maximum discount;
- credit exposure;
- resource allocation priority;
- restricted customer or jurisdiction;
- delivery SLA;
- reservation TTL;
- required human authority;
- maximum automated commitment value;
- allowed substitutions;
- compensation limits.

Policies are versioned. Every approval and certificate records the policy version used.

#### F. Domain Agent Runtime

Runs permissioned domain agents with isolated context, objectives, tools, and memory.

Responsibilities:

- retrieve allowed domain context;
- reason about ambiguous or exception cases;
- call deterministic tools;
- place or reject reservations;
- propose bounded counterterms;
- explain decisions without exposing restricted raw data;
- return typed decisions and receipts.

#### G. CommitOS Edge

Runs inside a customer-controlled environment when data cannot or should not be centralized.

Responsibilities:

- connect to local systems;
- enforce field-level data access;
- run local policy or calculation modules;
- create signed receipts;
- expose declared capabilities rather than unrestricted database access;
- receive commit, release, or compensation commands;
- maintain a local idempotency ledger;
- publish approved state-change events.

#### H. Reservation Ledger

Maintains the authoritative CommitOS record of:

- proposed reservations;
- source receipts;
- expiry times;
- status transitions;
- terms hashes;
- assurance levels;
- release and compensation activity.

The ledger is separate from agent transcripts. An agent cannot rewrite historical receipts.

#### I. Deterministic Transaction Coordinator

Owns the state machine and decides whether a certificate is valid.

Responsibilities:

- validate required dependencies;
- validate authority and policy versions;
- validate receipt signatures and terms hashes;
- calculate certificate expiry;
- perform prepare, commit, abort, and repair transitions;
- coordinate retries and idempotency;
- initiate compensation after partial failure;
- prevent invalid or expired certificates from being consumed.

The coordinator is deterministic. It does not delegate terminal state to an LLM.

#### J. Certificate Service

Creates, signs, validates, breaks, consumes, and supersedes Commit Certificates.

#### K. Monitoring and Repair Service

Listens for:

- reservation expiry;
- supplier cancellation;
- capacity loss;
- inventory reallocation;
- payment failure;
- policy changes;
- customer changes;
- source evidence becoming stale;
- execution failures.

It determines the affected dependencies, breaks the certificate if required, and starts a bounded repair graph.

#### L. Human Authority Portal

Allows authorized people to:

- provide missing evidence;
- place a human-attested hold;
- approve an exception;
- reject an unsafe request;
- choose among counterterms;
- authorize compensation;
- inspect the exact data and policy behind a decision.

Human approval is an explicit typed event, not a message hidden in an agent transcript.

#### M. Commitment Console

Provides the operational interface described later in this document.

---

## 8. Agentic System Design

### 8.1 When a domain should be an agent

A domain warrants an agent when it has all or most of the following:

1. role-specific or private context;
2. a distinct objective that may conflict with another domain;
3. authority to reserve, approve, change, or veto a dependency;
4. a need to reason over incomplete or unstructured information;
5. the ability to propose alternative terms;
6. responsibility for explaining a refusal or escalation.

A domain should not become an agent merely because it has a calculation.

Examples that normally belong in deterministic code:

- arithmetic;
- taxes from an approved rule table;
- unit conversion;
- margin calculation;
- reservation expiry comparison;
- quantity reconciliation;
- signature verification;
- certificate validity;
- state-machine transitions.

### 8.2 Agent identity and authority

Every agent operates with:

- a stable identity;
- a tenant and domain;
- a bounded objective;
- an explicit context scope;
- a fixed tool allowlist;
- policy versions;
- a maximum authority limit;
- a typed input contract;
- a typed output contract;
- timeout and escalation behavior.

Agents must never receive ambient authority merely because they participate in the same workflow.

### 8.3 Agent roles

The core platform recognizes reusable role classes:

| Role class | Purpose |
|---|---|
| Intake | Interpret the external request |
| Resource | Establish whether a scarce resource can be held |
| Capacity | Reserve time- or throughput-based capability |
| Financial | Protect margin, cash, payment, and credit constraints |
| External Supply | Obtain bounded supplier or partner options |
| Delivery | Protect fulfillment and service-level feasibility |
| Quality/Compliance | Enforce evidence, regulatory, safety, or quality requirements |
| Commercial | Generate acceptable terms and customer-facing counteroffers |
| Skeptic/Risk | Attempt to falsify unsafe or stale assumptions |
| Repair | Replan after a dependency changes |

An industry pack specializes these role classes without changing the orchestration protocol.

### 8.4 Dynamic agent selection

The agent council is not a fixed number of agents.

The active set is calculated as:

```text
Active agents
= mandatory agents for the promise type
+ agents triggered by requested terms
+ agents triggered by discovered dependencies
+ agents required by risk and policy
- agents whose authority is already satisfied by a stronger combined authority
```

Illustrative triggers:

```text
physical quantity requested       -> inventory/material agent
internal shortfall discovered     -> procurement/supplier agent
specific completion date          -> capacity and delivery agents
deferred payment                  -> credit agent
advance payment                   -> payment authorization
non-standard price                -> margin/commercial authority
regulated or quality term         -> compliance/quality agent
high value or policy exception    -> skeptic/risk agent
custom service obligation         -> staffing or entitlement agent
```

Dynamic selection can occur in waves. A material agent may discover a shortage, causing the orchestrator to add a procurement agent. A counterterm may remove a credit dependency and replace it with a deposit dependency. A post-commit disruption may reactivate only the domains affected by the failure.

### 8.5 Agent outputs

Agents do not return free-form conversational agreement as the operational result.

Every domain returns a typed object:

```yaml
domain_decision:
  request_id: PR-2041
  dependency_id: DEP-12
  domain: capacity
  decision: held | approved | rejected | counterterm | escalate
  covered_terms_hash: sha256:...
  quantity_or_limit: 1000
  valid_until: 2026-08-30T17:00:00+05:30
  policy_version: CAPACITY-3.1
  authority_id: plant-capacity-agent
  assurance_level: hard_hold | source_approval | human_attestation
  receipt_id: RCPT-7781
  receipt_hash: sha256:...
  explanation_code: CAPACITY_SLOT_RESERVED
  permitted_counterterms: []
```

Free-form explanation may accompany the object, but it does not determine validity.

### 8.6 Multi-agent negotiation

Negotiation should be bounded rather than an open-ended conversation.

The process is:

1. rejected domains return structured constraints;
2. the commercial agent generates a small candidate set using permitted counterterm operators;
3. deterministic calculators expand the exact consequences of each candidate;
4. affected domain agents evaluate candidates in parallel;
5. infeasible candidates are eliminated;
6. remaining candidates are ranked using declared organizational priorities;
7. the customer or authorized user selects a candidate when required;
8. all dependencies are prepared again against one exact terms hash.

Permitted counterterm operators can include:

- change quantity;
- split fulfillment;
- change date;
- change location;
- substitute resource;
- reduce or change scope;
- change price or discount;
- change payment terms;
- require a deposit;
- change service level;
- request an authorized exception.

Agents cannot invent contract terms outside the organization's policy catalogue.

### 8.7 Skeptic agent

The skeptic is not a generic critic. It has a formal mandate to test:

- evidence freshness;
- double counting;
- supplier or capacity concentration;
- missing dependencies;
- policy exceptions;
- inconsistent units or quantities;
- unsupported human attestations;
- reservations expiring too close to commit;
- compensation paths that are absent or unsafe.

The skeptic may block preparation, require stronger assurance, or force human escalation.

### 8.8 Agent memory

Agent memory must be scoped and separated:

- **case memory:** facts and decisions for the current promise;
- **domain memory:** relevant prior decisions within the same authority;
- **organization memory:** approved policies and mappings;
- **repair history:** prior failures, attempted alternatives, and compensations;
- **model transcript:** reasoning and explanations, stored separately from operational truth.

Operational state must never be reconstructed solely from conversation history.

---

## 9. Orchestration Model

### 9.1 Orchestration principle

LLM agents reason; the deterministic coordinator governs.

The coordinator owns:

- graph execution;
- state transitions;
- concurrency;
- retries;
- timeouts;
- idempotency;
- reservation freshness;
- certificate validity;
- commit ordering;
- abort and compensation.

### 9.2 Commitment lifecycle

```text
intake
  -> normalized
  -> planning
  -> preparing
  -> negotiating (optional)
  -> prepared
  -> committing
  -> committed
```

Failure and recovery states:

```text
planning/preparing -> cannot_commit
preparing          -> aborting -> aborted
prepared           -> expired  -> aborted
committing         -> compensating -> compensated | repair_needed
committed          -> broken -> repairing -> repaired | repair_needed
any governed state -> awaiting_authorized_exception
```

### 9.3 Prepare phase

During prepare:

1. the coordinator freezes a version of the proposed terms;
2. it calculates a `terms_hash`;
3. dependency agents run according to the graph;
4. agents place reservations or provide approvals tied to the hash;
5. receipts are written to the independent ledger;
6. the skeptic validates freshness and completeness;
7. the coordinator confirms that every required dependency is satisfied;
8. the proposed certificate expiry becomes the earliest required receipt expiry;
9. the certificate enters `prepared` state.

Changing a material term creates a new terms version and invalidates approvals that depended on the old hash.

### 9.4 Commit phase

During commit:

1. the coordinator revalidates every required receipt;
2. it checks that the certificate has not expired or been superseded;
3. it executes commit actions using idempotency keys;
4. each adapter returns an execution receipt;
5. failures are classified as retryable, compensatable, or escalation-only;
6. the final certificate becomes `committed` only after required commit actions succeed.

### 9.5 Abort phase

Abort releases all prepared resources that have not been committed.

Abort must be:

- idempotent;
- safe to retry;
- visible in the evidence timeline;
- scoped to the exact reservation IDs owned by the request.

### 9.6 Compensation

External business systems generally cannot participate in one ACID transaction. CommitOS therefore uses a two-phase-like prepare boundary followed by saga-style compensation.

Examples:

- release inventory;
- void an authorization;
- cancel a supplier option;
- cancel a delivery slot;
- refund or credit a payment where permitted;
- reopen capacity;
- notify an authorized operator when an action cannot be reversed.

Compensation is not assumed to be a perfect rollback. Every action declares:

- whether it is reversible;
- the compensation command;
- the latest safe compensation time;
- financial or operational side effects;
- required human authority;
- its idempotency behavior.

### 9.7 Repair

Repair starts when a prepared or committed dependency becomes invalid.

The repair engine:

1. identifies the failed dependency and downstream effects;
2. preserves unaffected reservations when policy allows;
3. determines whether the customer-facing terms can remain unchanged;
4. activates only the affected agents and required skeptic roles;
5. explores bounded alternatives;
6. creates a successor certificate or escalates truthfully;
7. links every successor to the broken certificate.

### 9.8 Concurrency

Independent dependencies should prepare in parallel.

The graph compiler must mark:

- parallel-safe nodes;
- ordering constraints;
- mutual exclusions;
- shared resource locks;
- dependency joins;
- conditional branches.

Agent count should not be confused with system scale. A complex promise may use eight logical agents, while the platform can process thousands of promises by running isolated orchestration instances partitioned by tenant and request.

### 9.9 Idempotency

Every mutation requires an idempotency key derived from:

```text
tenant + request + certificate version + dependency + action
```

Adapters maintain a record of completed operations so retries cannot duplicate orders, charges, holds, notifications, or releases.

### 9.10 Orchestration invariants

The coordinator must enforce:

1. no certificate without all required dependencies;
2. no dependency receipt covering a different terms hash;
3. no use of expired evidence;
4. no agent action outside declared authority;
5. no commit without a valid prepared certificate;
6. no duplicate mutation for the same idempotency key;
7. no compensation executed more than once;
8. no silent partial success;
9. no policy-free human override;
10. no LLM-generated terminal state without deterministic verification.

---

## 10. Data Integration Strategy

### 10.1 Integration is a capability, not the category

CommitOS requires integration but should not compete primarily as an integration product.

The integration strategy is to define one canonical commitment protocol and allow multiple adapter types to satisfy it.

### 10.2 Adapter modes

| Adapter mode | Typical use | Assurance |
|---|---|---|
| Native CommitOS store | Smaller organization using CommitOS as the resource ledger | Hard hold within CommitOS |
| API adapter | Modern source system | Source-backed read or mutation |
| Event adapter | Enterprise event bus or outbox | Near-real-time evidence and invalidation |
| Local database adapter | Customer-controlled Edge deployment | Source-local query and mutation |
| File adapter | CSV, spreadsheet, XML, JSON, scheduled export | Snapshot evidence with explicit freshness |
| Human authority adapter | No machine-accessible source or required judgment | Signed human attestation |

### 10.3 Canonical adapter contract

Every adapter declares a capability manifest:

```yaml
adapter:
  id: local_inventory_v1
  domain: inventory
  capabilities:
    - observe
    - reserve
    - commit
    - release
  freshness_mode: event_driven
  supports_idempotency: true
  supports_compensation: true
  data_location: customer_edge
  assurance_level: hard_hold
  schemas:
    request: InventoryReservationRequestV1
    receipt: ReservationReceiptV1
```

The orchestrator calls capabilities rather than vendor-specific APIs.

### 10.4 Mapping layer

Vendor-specific records map into canonical entities such as:

- `resource`;
- `availability`;
- `policy_limit`;
- `capacity_window`;
- `customer_exposure`;
- `supplier_option`;
- `reservation`;
- `execution_receipt`.

Mappings may be configured through:

- a column mapper;
- a JSON/XML mapping definition;
- a connector SDK;
- a customer-specific Edge transformation;
- a Commitment Pack default.

### 10.5 Assurance levels

CommitOS must not present every input as equally strong.

| Level | Meaning |
|---|---|
| Hard hold | Source system guarantees the resource is reserved |
| Source approval | Authorized source confirms feasibility but does not technically lock it |
| Human attestation | An authorized person confirms the dependency |
| Snapshot observation | The system observed a value at a time but cannot reserve it |

The certificate displays the weakest critical assurance level and may require stronger evidence for high-risk promises.

---

## 11. Privacy, Confidentiality, and Trust Architecture

### 11.1 Control plane and data plane separation

CommitOS should separate:

- **data plane:** raw operational records inside source systems or customer-controlled Edge runtimes;
- **control plane:** dependency status, reservations, receipts, terms hashes, expiries, and orchestration state.

The control plane should receive only the minimum information required to prove the commitment.

### 11.2 Domain isolation

Each domain agent receives only permitted context.

Examples:

- Sales may see permitted price bands but not the full cost ledger.
- Finance may see customer identity and exposure but not confidential supplier negotiations.
- Capacity may see required output and dates but not customer lifetime value.
- The coordinator may see that credit is reserved without receiving detailed receivables.

### 11.3 Deployment models

CommitOS should support:

1. multi-tenant hosted deployment;
2. single-tenant private cloud;
3. hybrid control plane with customer-hosted Edge;
4. fully customer-hosted deployment for high-sensitivity environments.

### 11.4 Required controls

- tenant isolation;
- encryption in transit and at rest;
- optional customer-managed keys;
- role- and attribute-based access control;
- service identities for agents and adapters;
- short-lived credentials;
- field-level context policies;
- immutable action receipts;
- secrets isolation;
- configurable retention and deletion;
- audit export;
- approval limits;
- model and prompt version recording;
- regional data residency support where required.

### 11.5 AI data policy

The system must explicitly declare:

- which fields are sent to a model;
- which model and deployment processes them;
- whether the data is retained;
- whether the call occurs in the cloud or customer environment;
- which deterministic redaction occurs first;
- how a customer can disable generative interpretation for a domain.

No raw confidential data should be sent to a generative model merely because it is available to the integration layer.

---

## 12. Canonical State Model

### 12.1 Promise request

```yaml
promise_request:
  id: PR-2041
  tenant_id: ORG-21
  promise_type: configured_type
  counterparty_ref: CUSTOMER-88
  requested_terms: {}
  normalized_terms: {}
  source_refs: []
  terms_version: 3
  terms_hash: sha256:...
  status: intake | normalized | planning | preparing | negotiating | prepared | committing | committed | cannot_commit | aborted | repair_needed | compensated
  created_at: timestamp
  requested_validity: timestamp
```

### 12.2 Dependency

```yaml
dependency:
  id: DEP-12
  request_id: PR-2041
  type: resource | capacity | financial | policy | quality | delivery
  owner_domain: capacity
  required: true
  depends_on: []
  requested_coverage: {}
  minimum_assurance: source_approval
  freshness_requirement_seconds: 300
  allowed_counterterms: []
  compensation_required: true
  status: pending | evaluating | held | approved | rejected | expired | released | committed | broken
```

### 12.3 Reservation receipt

```yaml
reservation_receipt:
  id: RCPT-7781
  dependency_id: DEP-12
  source_adapter_id: local_capacity_v1
  resource_ref: CAPACITY-4
  covered_terms_hash: sha256:...
  quantity_or_limit: 1000
  valid_from: timestamp
  valid_until: timestamp
  status: held | committed | released | expired | broken
  assurance_level: hard_hold
  authority_id: capacity-authority
  policy_version: CAPACITY-3.1
  idempotency_key: key
  source_receipt_ref: string
  receipt_hash: sha256:...
  signature: string
```

### 12.4 Commit Certificate

```yaml
commit_certificate:
  id: CERT-501
  request_id: PR-2041
  tenant_id: ORG-21
  terms_version: 3
  terms_hash: sha256:...
  required_dependency_ids: []
  receipt_ids: []
  valid_from: timestamp
  valid_until: timestamp
  minimum_assurance: source_approval
  status: prepared | valid | consumed | expired | broken | superseded | compensated
  predecessor_certificate_id: null
  compensation_plan_id: COMP-9
  coordinator_version: 1.0.0
  policy_bundle_version: 2026-08-29
  certificate_hash: sha256:...
  signature: string
```

### 12.5 Compensation plan

```yaml
compensation_plan:
  id: COMP-9
  certificate_id: CERT-501
  steps:
    - action_id: release-capacity
      adapter_id: local_capacity_v1
      compensates_action_id: commit-capacity
      idempotency_key: key
      authorization_required: false
      latest_safe_time: timestamp
  status: ready | executing | completed | partial | escalation_required
```

---

## 13. Core Tool and Protocol Contract

The universal tool surface should be resource-oriented rather than industry-oriented.

### 13.1 Read operations

```text
describe_capability(domain, promise_type)
get_resource_state(resource_query)
get_policy_decision(policy_query)
get_existing_reservations(resource_query)
get_evidence_freshness(evidence_ref)
```

### 13.2 Prepare operations

```text
prepare_resource_hold(resource, coverage, ttl, terms_hash)
prepare_capacity_hold(capability, time_window, quantity, ttl, terms_hash)
prepare_financial_envelope(type, amount, ttl, terms_hash)
prepare_external_option(provider, coverage, ttl, terms_hash)
record_authorized_approval(domain, decision, ttl, terms_hash)
```

### 13.3 Commit operations

```text
commit_reservation(reservation_id, certificate_id, idempotency_key)
commit_promise(certificate_id, idempotency_key)
send_counteroffer(request_id, terms_version, idempotency_key)
```

### 13.4 Abort and compensation operations

```text
release_reservation(reservation_id, reason, idempotency_key)
abort_commitment(certificate_id, reason, idempotency_key)
execute_compensation(action_id, certificate_id, idempotency_key)
```

### 13.5 Monitoring operations

```text
publish_dependency_event(dependency_id, event)
break_certificate(certificate_id, reason)
start_repair(certificate_id, failed_dependency_ids)
```

Every mutation returns a receipt stored independently of model output.

---

## 14. User Experience Scope

### 14.1 Promise Inbox

Displays:

- incoming requests;
- source and counterparty;
- requested value and deadline;
- current orchestration state;
- blocking domain;
- time remaining before evidence expires.

### 14.2 Commitment Graph

The primary interface is a dependency graph, not a chat screen.

It shows:

- required domains;
- active agents;
- dependencies and ordering;
- held, rejected, stale, or missing evidence;
- assurance level;
- reservation expiry;
- source receipts.

### 14.3 Agent Decision Cards

Each card shows:

- agent identity and domain;
- reason it was activated;
- information it is authorized to use;
- decision;
- resource or limit covered;
- expiry;
- policy version;
- proposed counterterms;
- supporting receipt.

### 14.4 Counterterm Workspace

Compares a small number of feasible alternatives across:

- customer acceptance likelihood;
- delivery outcome;
- margin and exposure;
- resource use;
- policy exceptions;
- required human authority.

Generated likelihoods must be labeled as estimates. Feasibility remains deterministic.

### 14.5 Commit Certificate View

Shows:

- exact promised terms;
- all required receipts;
- validity window;
- weakest assurance level;
- pending commit actions;
- certificate signature and status;
- downstream execution receipts.

### 14.6 Repair Timeline

Shows:

- what fact changed;
- which certificate broke;
- affected dependencies;
- resources released or preserved;
- agents reactivated;
- revised terms;
- compensation receipts;
- final outcome.

### 14.7 Administration

Allows authorized users to configure:

- Commitment Packs;
- agent registry;
- policies and approval limits;
- adapters and capability manifests;
- privacy and retention settings;
- evidence and assurance requirements;
- human escalation routes;
- model configuration;
- evaluation fixtures.

---

## 15. Functional Requirements

### FR-1: Request normalization

The system shall transform structured or unstructured requests into a versioned typed representation while preserving source provenance.

### FR-2: Dependency compilation

The system shall construct a dependency graph from the request, Commitment Pack, organization capabilities, and policies.

### FR-3: Dynamic agent activation

The system shall activate only registered agents required by the current dependency graph and policy conditions.

### FR-4: Context isolation

Each agent shall receive only the context and tools permitted for its domain and authority.

### FR-5: Typed decisions

Every operational agent decision shall conform to a versioned schema and reference the covered terms hash.

### FR-6: Resource preparation

Adapters shall support preparation through hard holds, source approvals, human attestations, or explicitly labeled observations.

### FR-7: Deterministic feasibility

Quantities, prices, exposure, policy rules, freshness, and terminal states shall be verified by deterministic code.

### FR-8: Counterterm generation

The system shall generate and evaluate bounded counterterms when the original request is infeasible.

### FR-9: Certificate enforcement

The system shall issue a certificate only after all required dependencies are satisfied and shall reject consumption of invalid, expired, broken, or superseded certificates.

### FR-10: Coordinated execution

The coordinator shall execute required commit actions with idempotency and receipt collection.

### FR-11: Abort and release

The system shall release prepared resources when a request is rejected, expires, or fails before commit.

### FR-12: Compensation

The system shall execute declared compensation steps after partial failure and escalate non-reversible outcomes.

### FR-13: Monitoring and repair

The system shall react to dependency events, invalidate affected certificates, and attempt bounded repair.

### FR-14: Human governance

The system shall support authorized human decisions, exceptions, and escalations as typed, auditable events.

### FR-15: Auditability

The system shall preserve request versions, agent identities, policy versions, evidence, receipts, model versions, actions, and terminal outcomes.

### FR-16: Industry adaptation

The system shall support new promise types through Commitment Packs and adapter mappings without changing the core coordinator.

---

## 16. Non-Functional Requirements

### 16.1 Reliability

- state transitions must be durable;
- mutation retries must be idempotent;
- expired reservations must not remain valid;
- partial failure must be visible;
- the coordinator must recover after process restart;
- event processing must tolerate duplicates and reordering.

### 16.2 Security

- least-privilege service identities;
- encrypted transport and storage;
- tenant isolation;
- secrets never exposed to prompts;
- signed or verifiable receipts;
- configurable human approval thresholds;
- auditable administrative changes.

### 16.3 Scalability

- orchestration instances partitioned by tenant and request;
- stateless agent workers where possible;
- durable queue for tool and adapter calls;
- separate scaling for model calls and deterministic services;
- backpressure and concurrency limits per source system;
- hierarchical orchestration for unusually large dependency graphs.

The system should scale through more concurrent promise instances, not through arbitrarily increasing the number of agents per promise.

### 16.4 Explainability

Every refusal, counterterm, escalation, and certificate must identify:

- the responsible dependency;
- the relevant policy;
- the source and freshness of evidence;
- the agent or human authority;
- the action required to proceed.

### 16.5 Observability

Each orchestration must expose:

- trace and correlation IDs;
- node timings;
- model and tool calls;
- retries and timeouts;
- reservation state;
- adapter latency and failures;
- compensation status;
- token and infrastructure cost where relevant.

### 16.6 Portability

The protocol and state model should remain independent of one model provider, ERP vendor, cloud provider, or industry.

---

## 17. Minimum Credible Product Scope

The minimum credible CommitOS product must demonstrate the product invariant rather than broad feature coverage.

It requires:

1. one unstructured request becoming typed terms;
2. a dependency graph compiled from configuration;
3. at least four agents with distinct context, objectives, and authority;
4. at least two real or simulated resource-hold adapters;
5. at least three deterministic policy or feasibility checks;
6. dynamic activation of a conditional agent;
7. a bounded counterterm that changes feasibility;
8. a prepared Commit Certificate tied to exact terms;
9. a commit that changes independently stored business state;
10. an abort that releases all prepared holds;
11. a post-prepare or post-commit disruption;
12. an idempotent compensation or repaired successor certificate;
13. a visible evidence and action timeline;
14. a privacy boundary showing that one agent cannot read another domain's raw context.

The product is not credible if:

- agents only produce chat messages;
- holds are visual flags with no state or expiry;
- the certificate is a decorative document;
- invalid certificates can still execute downstream mutations;
- a failure leaves duplicate or leaked actions;
- all agents share the same unrestricted context;
- arithmetic or terminal state is delegated to an LLM;
- a single prompt could produce an indistinguishable demonstration.

---

## 18. Reference End-to-End Scenario

This scenario is intentionally abstract.

### Request

A customer requests a quantity, price, payment term, completion date, and service condition.

### Initial dependency graph

```text
Commercial terms
├── resource quantity
├── input supply
├── execution capacity
├── financial exposure
├── delivery capability
└── policy and evidence review
```

### First preparation attempt

- the resource agent covers only part of the quantity;
- the supply agent can cover the balance at a higher cost;
- the capacity agent can meet the date only with a split plan;
- the finance agent rejects deferred payment;
- the skeptic confirms that the supplier option expires soon.

No certificate is issued.

### Counterterm

The commercial agent proposes:

- partial advance payment;
- a split completion schedule;
- a bounded price adjustment.

Agents evaluate the revised terms. All required dependencies return receipts tied to the new terms hash.

### Prepare and commit

The coordinator:

- verifies quantity coverage;
- verifies minimum margin;
- verifies credit or payment coverage;
- validates receipt freshness;
- prepares the certificate;
- executes the resource, payment, and downstream order actions;
- records execution receipts;
- marks the certificate committed.

### Disruption

An external supply option becomes unavailable.

The monitor breaks the certificate, preserves unaffected holds, activates the supply, capacity, delivery, commercial, and skeptic agents, and produces either:

- a successor certificate with repaired terms; or
- a truthful `repair_needed` result with executed compensations.

---

## 19. Novelty Analysis

### 19.1 Known components

CommitOS must not claim to invent:

- available-to-promise;
- material requirements planning;
- order promising;
- workflow approvals;
- distributed sagas;
- agent orchestration;
- tool-using AI agents;
- ERP connectors;
- automated checkout;
- digital signatures;
- counteroffer generation.

### 19.2 Defensible novelty hypothesis

The defensible novelty is the composition of these capabilities around a new enforceable transaction primitive:

> A cross-domain, privacy-preserving, expiring, terms-bound, and compensatable Commit Certificate issued before an organization releases a consequential promise.

The potentially novel characteristics are:

1. **Promise-to-graph compilation:** an unstructured commercial request becomes a versioned dependency graph over operational domains.
2. **Dynamic permissioned council:** agents are selected according to required authorities and discovered dependencies rather than a fixed workflow.
3. **Private domain reasoning:** each domain evaluates its dependency without exposing all raw context to other agents or the coordinator.
4. **Typed reservation protocol:** agents exchange signed reservation and approval objects rather than relying on dialogue.
5. **Terms-bound evidence:** every receipt is bound to an exact terms hash, policy version, authority, and expiry.
6. **Certificate enforcement:** the certificate is required by downstream mutation tools and is not merely a report.
7. **Agentic counterterm repair:** agents search within policy-bounded changes to convert an unsafe request into a feasible promise.
8. **Live invalidation:** changed evidence breaks an existing certificate instead of allowing stale approval to remain silently valid.
9. **Semantic compensation:** the system associates each cross-system action with an operationally meaningful compensation or escalation.
10. **Assurance-aware operation:** the certificate distinguishes hard holds, source approvals, human attestations, and observations.
11. **Industry-independent protocol:** the same commitment lifecycle applies to inventory, rooms, machines, labor, finance, service entitlements, and other resources.
12. **Commitment reliability graph:** fulfilled, broken, repaired, and compensated promises create a permissioned dataset about organizational reliability.

### 19.3 Novelty test

The product retains its novelty only if all of the following are visible:

- independent domain authority;
- real or faithfully represented reservations;
- a deterministic coordinator;
- an enforced certificate;
- expiry and stale-evidence handling;
- failure recovery or truthful escalation;
- privacy boundaries;
- changed business state.

Remove those elements and the product becomes a workflow dashboard, agent council, or available-to-promise interface.

### 19.4 Intellectual-property caution

This document describes a product novelty hypothesis, not a patentability opinion. Formal claims would require a dedicated patent and prior-art review across order promising, distributed transactions, authorization tokens, policy engines, agent systems, and privacy-preserving orchestration.

---

## 20. Business Value and Need

### 20.1 Customer value

CommitOS can create value by:

- shortening exception-approval cycles;
- reducing unfulfilled or revised promises;
- preventing double allocation;
- preventing margin and credit-policy violations;
- reducing manual coordination;
- exposing the exact blocking dependency;
- preserving private domain data;
- making counteroffers faster and more precise;
- recovering systematically after disruption;
- creating an auditable promise history.

### 20.2 Value measurement

The platform should measure rather than invent impact.

Recommended metrics:

- request-to-decision time;
- percentage of requests committed without manual escalation;
- percentage feasible after a counterterm;
- number of unsafe promises prevented;
- number of stale dependencies detected;
- reservation leakage rate;
- duplicate-action rate;
- repair success rate;
- compensation completion rate;
- promised-versus-fulfilled reliability;
- margin or credit exceptions prevented;
- user touches per commitment.

### 20.3 Enterprise buyer

Potential economic buyers include:

- Chief Operating Officer;
- Chief Commercial Officer;
- supply-chain or operations leadership;
- revenue operations;
- plant or property leadership;
- enterprise architecture and CIO organization;
- finance or risk leadership for credit-heavy commitments.

The initial champion is normally the leader responsible for a high-value exception workflow.

### 20.4 Smaller-company buyer

The owner or operations head is both buyer and policy authority. CommitOS can provide built-in lightweight resource ledgers while preserving the same certificate and orchestration semantics.

---

## 21. Commercial Product Structure

The commercial product can be packaged as:

### CommitOS Control Plane

- orchestration;
- policies;
- certificate service;
- monitoring;
- audit and console.

### CommitOS Edge

- customer-network runtime;
- local tools and policies;
- private receipts;
- connector execution;
- local idempotency and audit.

### Commitment Packs

- promise templates;
- agent roles;
- dependency patterns;
- policies;
- UI terminology;
- integration mappings;
- test fixtures.

### Connector and Adapter SDK

- capability manifests;
- canonical schemas;
- validation harness;
- certification tests;
- reference adapters.

### Commercial levers

- base platform subscription;
- committed or evaluated promise volume;
- number of enabled Commitment Packs;
- enterprise Edge deployment;
- premium governance and audit;
- custom adapter implementation;
- service-level and support commitments.

The durable product value should remain the commitment protocol, certificate enforcement, policy graph, and reliability data—not custom connector revenue.

---

## 22. Expansion Strategy

The product should expand along the promise graph:

```text
one exception workflow
    -> all high-value commercial promises
    -> operational capacity promises
    -> supplier-backed promises
    -> service and renewal promises
    -> multi-entity commitments
    -> cross-company commitment network
```

The long-term network opportunity is for two organizations to exchange verifiable, expiring commitment receipts without exposing their full underlying data.

For example, a supplier can attest that capacity is held for a buyer without exposing its complete production schedule. A logistics provider can reserve a lane without revealing unrelated customer data. These receipts can become dependencies in the buyer's certificate.

---

## 23. Data and Moat Hypothesis

The moat is not prompt wording or the raw count of agents.

The defensible dataset is the permissioned commitment-reliability graph:

```text
requested terms
    -> dependency graph
    -> evidence and policies
    -> reservations
    -> counterterms
    -> certificate
    -> execution
    -> disruption
    -> repair or compensation
    -> fulfillment outcome
```

Over time, this dataset may improve:

- dependency discovery;
- evidence-freshness requirements;
- counterterm selection;
- supplier and capacity reliability;
- exception routing;
- policy calibration;
- repair planning;
- predicted fulfillment risk.

Predictive models may assist these functions, but they must not replace deterministic certificate validity.

---

## 24. Principal Risks and Mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Integration sprawl | Every organization has different systems | Canonical capability protocol, Edge runtime, mapping tools, Commitment Packs |
| Source cannot reserve | Observation may become stale immediately | Assurance levels, short TTL, human attestation, policy-based certificate restrictions |
| AI hallucination | Incorrect terms or dependencies create false confidence | Source spans, schemas, deterministic checks, human clarification, evaluation fixtures |
| Agent authority creep | Agent may access or change unauthorized data | Registry, allowlisted tools, scoped identities, policy enforcement |
| Partial commit failure | External systems cannot share one transaction | Prepare boundary, idempotency, saga compensation, escalation |
| Privacy concern | Sensitive finance, customer, or supplier data may be exposed | Edge processing, data minimization, domain isolation, private deployment |
| False atomicity claim | Business compensation is not equivalent to database rollback | Explicit reversibility metadata and honest terminal states |
| Excessive agent count | Cost, latency, and unpredictability grow | Agents only for independent authority; deterministic services for calculations |
| Adoption resistance | Teams may bypass the product | Make certificate required for scoped mutations; begin with exception workflows |
| Decorative certificate | Product becomes a reporting UI | Downstream tools must validate the certificate before executing |
| Weak source evidence | Human or file input may be unreliable | Show assurance grade and require stronger evidence at higher risk |
| Model/vendor dependence | Product becomes tied to one AI provider | Versioned interfaces and provider-independent agent runtime |

---

## 25. Evaluation and Test Strategy

### 25.1 Known-answer cases

Every Commitment Pack must include deterministic fixtures for:

1. directly feasible request;
2. feasible only after a counterterm;
3. impossible request;
4. stale evidence before commit;
5. conflicting reservations;
6. duplicate tool retry;
7. expired certificate;
8. partial commit failure;
9. successful compensation;
10. post-commit disruption and successful repair;
11. post-commit disruption requiring human escalation;
12. unauthorized agent action;
13. terms changed after approval;
14. human attestation below the minimum required assurance.

### 25.2 Agent evaluation

Measure:

- request extraction accuracy;
- dependency recall;
- unauthorized data-access attempts;
- tool-selection accuracy;
- schema validity;
- counterterm feasibility;
- explanation fidelity;
- escalation correctness;
- repair success within allowed actions.

### 25.3 Coordinator evaluation

The coordinator must be tested through state-machine and fault-injection tests rather than language-model evaluation.

Verify:

- no certificate on incomplete preparation;
- no commit after expiry;
- safe recovery after restart;
- duplicate event tolerance;
- exactly-once effect through idempotent adapters;
- compensation ordering;
- accurate successor-certificate lineage;
- preservation of unaffected reservations during repair.

### 25.4 Security evaluation

- tenant-boundary tests;
- role and attribute authorization tests;
- prompt-injection resistance at tool boundaries;
- secrets leakage tests;
- connector permission tests;
- receipt forgery tests;
- audit completeness;
- retention and deletion verification.

---

## 26. Success Criteria

CommitOS is successful as a product when it can demonstrate that:

1. a real business request is converted into an accurate dependency graph;
2. only required agents are activated;
3. agents operate with independent context and authority;
4. operational resources or limits are actually held where integrations permit;
5. private data is not unnecessarily centralized;
6. the original request can be rejected or repaired using bounded counterterms;
7. deterministic code—not an LLM—decides validity;
8. the certificate controls downstream execution;
9. stale evidence or changed facts break the certificate;
10. partial actions are compensated exactly once or escalated explicitly;
11. the same core engine supports a materially different promise type through configuration and adapters;
12. customers can measure faster decisions or fewer unsafe commitments.

---

## 27. Scope Boundaries

### In scope

- cross-domain promise interpretation;
- dependency graph construction;
- dynamic multi-agent selection;
- permissioned domain reasoning;
- deterministic policy and feasibility checks;
- resource reservations and approvals;
- counterterm generation;
- Commit Certificate lifecycle;
- prepare, commit, abort, repair, and compensation;
- Edge and adapter protocol;
- privacy and authority controls;
- human escalation;
- audit, observability, and evaluation;
- industry adaptation through Commitment Packs.

### Out of scope as core category

- full general ledger;
- payroll;
- broad CRM functionality;
- complete MRP or PMS replacement;
- generic business intelligence;
- unrestricted workflow automation;
- universal legal or tax advice;
- autonomous actions without policy authority;
- centralized replication of every source-system record;
- open-ended agent-to-agent conversation as operational truth.

---

## 28. Research and Prior-Art Boundary

CommitOS is informed by existing capabilities and must position itself honestly.

- SAP Advanced Available-to-Promise provides confirmation proposals based on stock, future receipts, allocation, and other constraints.
- SAP Business One advanced ATP supports real-time availability, reservation, delivery proposals, and rescheduling.
- Oracle OPERA Cloud manages hotel inventory, reservations, rooms, and related property operations.
- Odoo and other manufacturing systems model bills of materials, work orders, and production capacity.
- Industry systems such as print-shop management products already provide quoting, approvals, scheduling, and payments.
- Saga orchestration is an established distributed-systems pattern for coordinating local transactions and compensations.
- Agentic workflow patterns already apply tool-using agents to reasoning and recovery.

CommitOS should therefore claim neither the invention of order promising nor the invention of distributed compensation.

Its product thesis is that these known mechanisms can be composed into a universal pre-promise control plane with permissioned domain agents, terms-bound reservation receipts, enforced Commit Certificates, assurance levels, and live semantic repair.

### Reference links

- [SAP Advanced Available-to-Promise](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/e1d9bfb257d54a5fbdd0f1545de13b22/a004ec57a7b5bc12e10000000a4450e5.html)
- [SAP Business One Advanced ATP](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/93230cc0be374dbbb9529368c91f9b3c.html)
- [Oracle OPERA Cloud](https://www.oracle.com/hospitality/hotel-property-management/hotel-pms-software/tour/)
- [Odoo bill of materials documentation](https://www.odoo.com/documentation/master/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html)
- [Printavo](https://www.printavo.com/)
- [Katana manufacturing](https://katanamrp.com/features/manufacturing/)
- [AWS saga patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-patterns.html)
- [AWS saga orchestration](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)

---

## 29. Final Product Narrative

Traditional systems tell an organization what it owns, what it recorded, and what it already did. They do not always coordinate every independent authority before a complex promise is released.

CommitOS treats the promise itself as a governed transaction.

It listens to the request, determines what must be true, activates only the domains with relevant authority, obtains expiring evidence and reservations without unnecessarily centralizing private data, negotiates safe alternatives when the original request fails, and issues a certificate only when the entire promise is backed.

If reality changes, CommitOS does not hide the inconsistency. It breaks the certificate, preserves or releases resources according to policy, repairs the terms when possible, compensates partial execution, and escalates when the organization can no longer fulfill safely.

> **ERP records what the organization did. CommitOS proves what the organization can safely promise next—and governs that promise until it is fulfilled, repaired, or truthfully withdrawn.**

---

## 30. Differentiation from Snowflake's Agentic Enterprise Control Plane

### 30.1 Why this comparison matters

Snowflake publicly describes an **agentic enterprise control plane** that connects governed enterprise data, models, policy, agents, tools, and operational applications. Its stated control-plane responsibilities include:

- coordinating agents across enterprise context;
- controlling access to data and tools;
- deciding whether an action should occur;
- applying policy and risk constraints;
- determining when human judgment is required;
- coordinating execution across systems;
- governing and observing an enterprise agent estate.

This means CommitOS cannot credibly claim that its novelty is simply:

- being an enterprise control plane;
- connecting AI agents to governed data;
- coordinating multi-step agent actions;
- providing role-specific agents;
- enforcing tool permissions;
- placing a human in an agent workflow;
- using shared enterprise context;
- monitoring agent activity;
- allowing agents to act across applications.

Those are horizontal agent-platform capabilities, and Snowflake already occupies that conceptual category.

### 30.2 Required positioning correction

CommitOS should not position **control plane** as its primary novel category.

The preferred category is:

> **Business Commitment Transaction Protocol**

Alternative descriptions include:

- resource-backed promise protocol;
- commitment transaction layer;
- promise assurance and execution protocol;
- system of commitment.

The recommended positioning is:

> CommitOS compiles a proposed business promise into a distributed transaction. Independent domain agents place expiring, terms-bound reservations, and a deterministic coordinator issues the certificate required to release that promise.

The concise distinction is:

> **Snowflake governs agents. CommitOS governs promises.**

### 30.3 Product-layer distinction

| Dimension | Snowflake agentic control plane | CommitOS business commitment protocol |
|---|---|---|
| Primary controlled object | Agents, models, tools, data access, and agent actions | A specific business promise |
| Primary question | May this agent use this context or perform this action? | Is this exact promise fully backed and still valid? |
| Core artifact | Governed agent, tool, context, and execution environment | Commit Graph, Reservation Receipts, and Commit Certificate |
| Core state | Agent interaction and multi-step work | Prepare, reserve, negotiate, commit, abort, break, repair, and compensate |
| Operational evidence | Governed context and tool results | Terms-bound, expiring receipts from independent authorities |
| Resource semantics | Generic tools and actions | Explicit scarce-resource, limit, capacity, approval, and assurance semantics |
| Validity | Governed by access and runtime policy | Governed by complete dependency coverage and the earliest receipt expiry |
| Failure meaning | Agent, tool, policy, or workflow failure | An externally relevant promise becomes invalid or partially executed |
| Recovery | Platform or application-defined workflow | Mandatory release, compensation, repair, successor certificate, or truthful escalation |
| Privacy boundary | Snowflake access control, masking, governed context, and caller permissions | Source-local domain evaluation with minimal signed commitment evidence |
| Primary buyer | CIO, CDO, data platform, security, and enterprise AI teams | COO, commercial, finance, supply chain, plant/property operations, and revenue assurance |
| Product relationship | Horizontal agent and data foundation | Operational transaction protocol that may run on Snowflake or another foundation |

### 30.4 Snowflake can be infrastructure beneath CommitOS

Snowflake and CommitOS do not have to be mutually exclusive products.

An enterprise could use Snowflake for:

- governed enterprise data;
- agent identity and access;
- semantic models and retrieval;
- agent creation and tool selection;
- role-based access control;
- model execution;
- MCP or application tools;
- centralized agent monitoring.

CommitOS would still supply application-level semantics that are specific to business promises:

- `PromiseRequest` normalization;
- Commit Graph compilation;
- dependency ownership;
- Reservation Receipt protocol;
- assurance levels;
- exact `terms_hash` binding;
- prepare/commit/abort state transitions;
- certificate creation and enforcement;
- certificate expiry and invalidation;
- compensation contracts;
- repair graphs;
- predecessor and successor certificate lineage;
- fulfilled-versus-broken commitment history.

CommitOS can therefore be implemented on top of Snowflake, on another enterprise AI platform, or independently. Its differentiation must survive a change of model provider, data platform, agent framework, and ERP vendor.

### 30.5 Different units of governance

Snowflake's horizontal unit of governance is principally the agent and its access to context, tools, policies, and actions.

CommitOS's unit of governance is the promise:

```text
requested outcome
    + exact commercial terms
    + required operational dependencies
    + domain authorities
    + expiring evidence
    + resource reservations
    + commit actions
    + compensation obligations
    = governed business commitment
```

An authorized agent action is not automatically a valid business commitment. A tool may be permitted to create an order while the promised delivery date remains operationally unsupported. CommitOS introduces a second condition:

```text
Agent is authorized to call the tool
                      AND
The promise has a valid Commit Certificate
                      =
Downstream mutation may proceed
```

### 30.6 Five differentiating protocol primitives

#### A. Commit Graph

An external request is compiled into an explicit graph of conditions that must be true before the promise can exist.

The graph defines:

- required and optional dependencies;
- owning authority for each dependency;
- execution ordering;
- parallel-safe checks;
- assurance requirements;
- expiry rules;
- counterterm operators;
- compensation obligations.

#### B. Reservation Receipt

Every required authority returns a typed receipt rather than conversational agreement.

The receipt proves:

- what dependency was covered;
- which terms were evaluated;
- which resource, capacity, or limit was reserved;
- which authority made the decision;
- which policy version was used;
- how strong the assurance is;
- when the evidence expires;
- how the receipt can be verified.

#### C. Commit Certificate

All mandatory receipts must cover the same terms hash. The resulting certificate is the authorization key required by downstream commitment actions.

The certificate is not a report generated after an agent run. It is an enforced business transaction object.

#### D. Broken and Successor Certificates

A certificate becomes broken when a material dependency fails, expires, or is revoked. Repair creates a formally linked successor certificate rather than silently editing the historical promise.

```text
CERT-100: original commitment
    |
    +-- broken_by: supplier capacity cancellation
    |
    +-- successor: CERT-101
                     revised quantity/date
                     new terms hash
                     new receipts
```

#### E. Assurance-aware commitment

CommitOS distinguishes among:

- hard source-system hold;
- authoritative source approval;
- signed human attestation;
- snapshot observation.

The certificate reports the weakest critical assurance level and applies organization policy accordingly. An uploaded spreadsheet must not be presented as equivalent to a live, source-backed reservation.

### 30.7 Defensible differentiation statement

The recommended formal differentiation statement is:

> CommitOS is a terms-bound business commitment protocol in which an external promise becomes executable only after independent operational authorities issue expiring reservation receipts. A deterministic coordinator binds those receipts into a Commit Certificate, invalidates the certificate when evidence changes, and coordinates repair or compensation after partial failure.

### 30.8 Claims CommitOS must avoid

CommitOS should not say:

- it invented the enterprise agent control plane;
- it invented governed enterprise agents;
- it invented available-to-promise;
- it invented distributed transactions or sagas;
- it is novel merely because multiple agents use different tools;
- it guarantees atomic rollback across systems that do not support it;
- it provides cryptographic or privacy guarantees that are not implemented;
- no existing enterprise platform could technically implement similar workflows.

The honest claim is that CommitOS packages known capabilities into a specific, enforceable transaction protocol and product object for cross-domain business promises.

### 30.9 Competitive implication

If CommitOS only demonstrates agents querying governed data, applying policy, obtaining human approval, and calling tools, it is not sufficiently differentiated from Snowflake's public control-plane direction.

If CommitOS demonstrates terms-bound reservations, certificate enforcement, expiry, live invalidation, compensation, and successor commitments, it occupies a narrower product layer that Snowflake can support as infrastructure but does not define as the central product object in the reviewed public material.

### 30.10 Reference links

- [Snowflake — Powering the Era of the Agentic Enterprise](https://www.snowflake.com/en/blog/agentic-enterprise-control-plane/)
- [Snowflake — The Agentic Control Plane](https://www.snowflake.com/en/artificial-intelligence/ai-governance/control-plane/)
- [Snowflake documentation — Build agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/snowflake-cowork/build-agents)
- [Snowflake documentation — User access and settings for agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/snowflake-cowork/deploy-agents)

---

## 31. What the Demonstration Must Prove

### 31.1 Demo objective

The demonstration must prove that CommitOS is an enforceable commitment transaction protocol, not a collection of agents operating on enterprise data.

The audience should be able to answer all of the following after the demonstration:

1. What exact promise was requested?
2. Which operational dependencies were required?
3. Why was each agent activated?
4. What private authority did each agent possess?
5. Which resources or limits were actually held?
6. How long were the holds valid?
7. Why could the original terms not be committed?
8. Which counterterm changed feasibility?
9. What made the final certificate valid?
10. Why could the downstream action not bypass the certificate?
11. What happened when a dependency changed?
12. Were partial actions repaired, released, compensated, or escalated exactly once?

### 31.2 Required proof sequence

#### Proof 1: Request-to-graph compilation

Show an unstructured business request becoming typed terms and an explicit Commit Graph.

The graph must display:

- requested outcome;
- quantity or scope;
- price and payment terms;
- deadline or service condition;
- required dependencies;
- owning domains;
- assurance requirements.

This proves that the system is reasoning about a promise rather than merely responding to a question.

#### Proof 2: Dynamic agent activation

Begin with a smaller agent set. Allow one agent to discover a new dependency that causes the coordinator to activate another registered agent.

Example pattern:

```text
Resource agent discovers an internal shortfall
                    ->
External-supply agent is activated
```

The UI must show why the new agent appeared and which authority it owns.

This proves that orchestration follows the dependency graph rather than a fixed theatrical council.

#### Proof 3: Independent context and authority

Show that agents do not share unrestricted context.

For example:

- commercial sees the permitted price range but not the complete cost ledger;
- finance sees exposure and policy but not confidential supplier details;
- resource operations see quantity and allocation but not customer strategy;
- the coordinator receives a signed decision rather than raw private records.

Attempting an unauthorized read or mutation should fail visibly.

#### Proof 4: Real reservation state

At least two agents must create actual persisted reservations containing:

- reservation ID;
- resource reference;
- covered quantity or limit;
- terms hash;
- expiry;
- policy version;
- assurance level;
- receipt or action hash.

The reservation must affect subsequent availability. Re-running the same request must not pretend the resource remains unallocated.

#### Proof 5: Original terms fail closed

At least one domain must reject the original request for a specific, deterministic reason.

Examples:

- insufficient resource coverage;
- credit limit exceeded;
- margin below policy;
- capacity outside the requested date;
- required assurance missing;
- evidence too stale.

No certificate may be issued while the dependency remains red.

#### Proof 6: Bounded counterterm changes feasibility

Change one or more permitted terms, such as:

- deposit percentage;
- quantity;
- delivery date;
- split fulfillment;
- substitute resource;
- price or discount.

The revised terms must receive a new `terms_hash`. Previous terms-dependent approvals must not be reused unless policy explicitly permits it.

All affected agents re-evaluate the revised request.

#### Proof 7: Certificate creation from matched receipts

Show the deterministic coordinator verifying:

- all required dependencies are satisfied;
- all receipts cover the same terms hash;
- all receipts remain fresh;
- all authorities are valid;
- all minimum assurance requirements are met;
- the certificate expiry is derived from the earliest critical receipt expiry.

The final certificate must expose its receipts and validation result.

#### Proof 8: Certificate-enforced execution

Attempt the downstream action once without a valid certificate.

It must fail.

Then execute the same action with the valid certificate.

It must succeed and produce an independent execution receipt.

Example actions include:

- create a confirmed order;
- confirm a booking;
- release a production job;
- issue a binding quote;
- create a payment authorization;
- reserve a delivery or service slot.

This is the strongest visible distinction between CommitOS and a recommendation or agent-governance interface.

#### Proof 9: Live certificate invalidation

After preparation or commitment, change one material fact:

- cancel a supplier option;
- expire a capacity hold;
- mark a machine unavailable;
- revoke a payment authorization;
- change a required policy;
- remove an allocated resource.

The certificate must visibly transition to `broken` or `expired`. It must no longer authorize new downstream actions.

#### Proof 10: Selective repair

The repair engine must identify the affected subgraph and reactivate only the necessary agents.

It should preserve unaffected reservations when policy allows rather than restarting every domain.

The result must be:

- a successor certificate with new terms and receipts;
- an exact `cannot_commit` or `repair_needed` outcome; or
- a human escalation identifying the missing authority.

#### Proof 11: Idempotent compensation

If an action already succeeded before failure, demonstrate its declared compensation.

Trigger the compensation twice. The second invocation must not duplicate the reversal, refund, release, or cancellation.

The evidence timeline must show one effective compensation and the duplicate-safe retry.

#### Proof 12: Persistent and auditable state

Refresh or resume the case and show that CommitOS preserves:

- request identity;
- terms versions;
- agent decisions;
- policy versions;
- reservation receipts;
- certificate state;
- actions and idempotency keys;
- disruption and repair history.

The system must not reconstruct operational truth from a chat transcript.

### 31.3 Essential visual state transition

The memorable visual transition should be:

```text
UNBACKED REQUEST
       |
       v
COMMIT GRAPH WITH RED DEPENDENCIES
       |
       v
EXPIRING DOMAIN RESERVATIONS
       |
       v
TERMS-BOUND COMMIT CERTIFICATE
       |
       v
ENFORCED DOWNSTREAM EXECUTION
       |
       v
DEPENDENCY FAILURE
       |
       v
BROKEN CERTIFICATE
       |
       v
SUCCESSOR CERTIFICATE OR COMPENSATED EXIT
```

### 31.4 Minimum evidence visible on screen

The demo UI must visibly expose:

- request ID;
- terms version and abbreviated terms hash;
- agent activation reason;
- dependency owner;
- reservation IDs;
- quantities or limits covered;
- expiry countdowns;
- assurance levels;
- policy versions;
- certificate status;
- certificate predecessor/successor relationship;
- action receipts;
- idempotency keys;
- compensation status.

### 31.5 What must not be the primary demo

The following may support the product but cannot be the main proof:

- a chat transcript between agents;
- a generated recommendation;
- a summary of company data;
- an attractive dashboard without mutations;
- a fixed animation of agent cards;
- a list of integrations;
- a generic policy approval;
- a forecasted profit number;
- an agent selecting and calling a tool;
- a certificate-shaped PDF that downstream tools ignore.

### 31.6 Snowflake differentiation test

Before accepting the demo, ask:

> Could a generic governed enterprise agent platform produce an indistinguishable result by querying data and calling tools?

If the answer is yes, the demo does not prove CommitOS.

The demo passes only when it visibly proves:

```text
terms-bound dependency graph
+ independent reservation receipts
+ deterministic certificate validation
+ certificate-gated execution
+ live invalidation
+ semantic repair or compensation
```

### 31.7 Demo acceptance checklist

- [ ] The original request is unstructured.
- [ ] The normalized terms are visible.
- [ ] The Commit Graph is generated from configuration.
- [ ] At least one agent is activated dynamically.
- [ ] At least two persisted reservations are created.
- [ ] Agents have visibly different context and authority.
- [ ] One original dependency rejects the request.
- [ ] A bounded counterterm changes feasibility.
- [ ] Revised receipts use the new terms hash.
- [ ] The deterministic coordinator issues the certificate.
- [ ] An invalid or missing certificate is rejected by an execution tool.
- [ ] A valid certificate produces an execution receipt.
- [ ] A material dependency failure breaks the certificate.
- [ ] Only affected agents reactivate for repair.
- [ ] Compensation is idempotent.
- [ ] A successor certificate or truthful escalation is produced.
- [ ] State survives refresh or resume.
- [ ] The audit timeline is independent of the agent transcript.

### 31.8 Final differentiated demo statement

> The demo is not proving that agents can access company data and perform governed actions. Snowflake and other enterprise AI platforms already pursue that capability. The demo is proving that a business promise can be compiled, reserved, cryptographically bound to exact terms, enforced at execution, invalidated when reality changes, and repaired or compensated without relying on conversational agreement.
