# CommitOS 24-Hour Build Scope

## Team model

Four equally capable builders use Emergent and other agentic coding tools. Each owns an independently testable lane. Equal skill does not mean shared ownership of every file; clear boundaries are required to prevent generated code from diverging.

## First-hour contract freeze

Before parallel implementation, all four builders agree on:

- repository structure;
- entity and enum names;
- `DomainDecision` schema;
- model gateway interface;
- tool signatures;
- case event types;
- state transitions;
- three fixture IDs and expected terminal states;
- ownership of shared files;
- integration checkpoints.

After the freeze, a contract change requires all affected lane owners to acknowledge it. Do not let coding agents independently rename shared fields.

## Builder lanes

### Builder A — Product, evidence, and buyer flow

Owns:

- three fixture definitions and deterministic business truth;
- buyer counteroffer page and signed-response flow;
- ROI calculation inputs and labeling;
- validation interviews;
- demo script, evidence capture, and submission package.

Acceptance condition:

- Buyer acceptance updates the correct case version.
- Fixture expected outcomes are documented and machine-readable.
- Demo and backup evidence use real persisted state.

### Builder B — Operator experience

Owns:

- deal intake and fixture selector;
- normalized terms view;
- six role cards;
- commitment/reservation graph;
- event and receipt timeline;
- supplier-disruption control;
- terminal-state and evidence views.

Acceptance condition:

- A first-time judge can run the main flow without builder intervention.
- UI renders from API state and survives reload.

### Builder C — Transaction core and integrations

Owns:

- database schema and migrations;
- state-transition functions;
- policy/economics engine;
- reservations, certificates, idempotency, outbox, and compensation;
- sandbox ERP/CRM, supplier, logistics, and Stripe adapters;
- deployment and health checks.

Acceptance condition:

- Deterministic happy path works without LLM calls.
- Duplicate events and retries create no duplicate effects.
- Commit and compensation produce verifiable receipts.

### Builder D — Agents and evaluation

Owns:

- ApplyBee/Hive gateway adapter;
- six role configurations and prompts;
- context selectors and tool permissions;
- structured output validation;
- role traces;
- three-case evaluation runner and adversarial tests.

Acceptance condition:

- All roles use the organizer gateway.
- Role permissions are enforced by code.
- Three-case runner verifies actual terminal state and receipts.

## Shared-file ownership

- Builder C owns database schema, state enums, and coordinator contracts.
- Builder D owns role types and model-gateway contracts.
- Builder A owns fixture truth and buyer-response contracts.
- Builder B consumes contracts and owns presentation components.

One owner edits each shared contract file. Other builders propose changes through a small diff or direct coordination rather than allowing multiple coding agents to rewrite it.

## Timeline

### Hours 0–1: Verify stack and freeze contracts

- Obtain official ApplyBee/Hive credentials and documentation.
- Smoke-test one structured model call.
- Confirm model ID, tool support, concurrency, rate limits, and request IDs.
- Freeze schemas, fixtures, interfaces, and ownership.
- Verify Emergent deployment path.

Kill condition: if the Hive call cannot return validated structured output, use JSON text plus strict server parsing through the same gateway. Do not switch to an unapproved provider without organizer confirmation.

### Hours 1–4: Deterministic vertical skeleton

- Seed the three cases.
- Implement state transitions and core tables.
- Render operator and buyer skeletons.
- Implement local fake `ModelGateway` for deterministic development.
- Make the main case progress through stubbed decisions.

Checkpoint: deployed app loads, persists a case, and resumes after reload.

### Hours 4–8: Happy-path transaction

- Implement economics and feasibility rules.
- Implement reservation tools.
- Implement certificate validation.
- Implement sandbox order/CRM/inventory writes.
- Implement buyer acceptance.
- Render receipts and certificate.

Checkpoint: the full committed outcome works without real model reasoning.

### Hours 8–12: Hive role integration

- Connect the shared role runtime to ApplyBee/Hive.
- Add the six role configurations.
- Run Finance, Inventory, Procurement, and Logistics concurrently, then run Risk against their typed outputs.
- Validate typed outputs and permissions.
- Generate the bounded 30% advance counterterm.

Checkpoint: main case uses real Hive calls and reaches `committed` twice consecutively.

### Hours 12–16: Failure and recovery

- Implement supplier-disruption event.
- Break the consumed certificate.
- Implement compensation receipts.
- Add Supplier C repair fixture.
- Rerun affected roles and issue repaired certificate.
- Send correction through outbox.

Checkpoint: disruption reaches `repaired` with no duplicate effects.

### Hours 16–19: Evaluation and reliability

- Implement stale-hold case.
- Complete evaluation runner.
- Run each case three times.
- Test duplicate events, reloads, timeouts, and invalid outputs.
- Remove flaky or unverified features.

Checkpoint: all pass criteria in the evaluation specification are satisfied.

### Hours 19–21: Deployment and proof

- Freeze features.
- Verify public deployment in separate sessions.
- Capture before/after state and receipts.
- Export three-case CSV.
- Calculate staged ROI.
- Record architecture image and backup demo.

### Hours 21–24: GTM, rehearsal, and submission

- Collect five short validation reactions.
- Finalize pricing and pilot hypothesis.
- Rehearse three-minute presentation.
- Rehearse offline/failure fallback.
- Submit before the final window closes.
- Do not add another role, integration, or workflow.

## Agentic coding-tool rules

- Give each coding agent the relevant spec and owned interfaces, not the entire repository without boundaries.
- Require generated code to use existing names and schemas.
- Review migrations, auth, money calculations, state transitions, and destructive operations manually.
- Never paste credentials into an agent prompt or committed file.
- Run tests after each generated change.
- Prefer three explicit lines over a new abstraction.
- Do not let Emergent redesign the architecture after the contract freeze.
- Do not accept generated animations that are not driven by persisted state.

## Must ship

- One distributor scenario and SKU family.
- Six config-driven logical role agents through Hive.
- One shared role runtime.
- Three deterministic business constraints: inventory, credit, and margin.
- Supplier and logistics feasibility sufficient for the fixture.
- Four reservation domains.
- Commit Certificate and Protected Promise API.
- Buyer counterterm and persisted response.
- Sandbox ERP/CRM writes and Stripe test checkout.
- One post-commit disruption and repair.
- Three repeated known-answer cases.
- Evidence timeline and receipt bundle.
- Public deployment and backup video.

## Cut order

Cut these in order if behind:

1. Paid-pilot Stripe link.
2. Downloadable certificate file.
3. ROI interaction beyond the fixed deterministic calculation.
4. Decorative animations.
5. Automatic alternate counterterm ranking; keep the one approved 30% advance term.
6. Live email delivery; keep the persistent outbox.

Never cut:

- ApplyBee/Hive role calls;
- deterministic policy checks;
- persisted reservations;
- certificate enforcement;
- idempotent receipts;
- three known-answer cases;
- truthful failure behavior.

## Integration protocol

- Integrate at hours 4, 8, 12, and 16.
- At each checkpoint, merge only passing lane changes.
- Run schema validation and deterministic tests first.
- Run the deployed happy path after every shared-contract change.
- Keep commits small and stage files by name.
- Do not push credentials, generated caches, or visual-companion files.

## Final exit criteria

- Main flow completes in 90 seconds or less.
- Three cases pass three consecutive runs.
- ApplyBee/Hive usage is independently visible.
- Every protected mutation has a receipt.
- Duplicate inputs create no duplicate effects.
- Reload resumes the current case.
- Judge-controlled disruption produces a repaired or truthful terminal state.
- Public repository, live URL, video, GTM brief, and evidence package are ready before submission.
