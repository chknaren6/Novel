# CommitOS Product Specification

## Product statement

CommitOS is the transaction control plane for enterprise promises. It prevents a salesperson or AI agent from releasing a consequential customer commitment until every required business dependency has been reserved and verified.

Ten-second pitch:

> Salespeople and AI agents can promise anything. CommitOS makes every promise reserve the inventory, credit, margin, supply, and delivery capacity needed to fulfill it before the customer receives it.

## Problem

Large B2B quotes cross organizational boundaries. Sales negotiates price and timing, Finance controls credit and contribution, Inventory owns existing allocation, Procurement owns future supply, Logistics owns deliverability, and Risk owns evidence freshness and policy exceptions.

Today, those parties coordinate through calls, spreadsheets, inboxes, and approvals. A customer-visible promise may be made while one or more dependencies are stale, assumed, or unavailable. The resulting cost appears later as margin leakage, emergency sourcing, rush freight, delayed delivery, working-capital exposure, churn, or manual recovery.

Existing ERP systems record orders. Available-to-promise systems generally focus on inventory and delivery. Deal-desk tools focus on pricing and approvals. CommitOS introduces a cross-domain object that binds commercial terms to operational reservations before release: the **Commit Certificate**.

## Beachhead market

### Initial customer

Mid-market distributors and manufacturers with high-value, non-standard B2B orders and fragmented CRM, inventory, procurement, logistics, and payment systems.

### Economic buyer

- COO
- CFO
- Head of Revenue Operations
- Head of Order Management
- Head of Supply Chain

### Daily operator

A deal-desk or order-operations manager responsible for converting exception quotes into fulfillable orders.

### Counterparty user

The buyer who reviews and accepts a bounded counteroffer without needing a CommitOS account.

## Job to be done

When a buyer requests non-standard commercial and delivery terms, determine what the business can safely promise and complete one of three outcomes:

1. Issue and execute a resource-backed commitment.
2. Present a precise counterterm that would make the request feasible.
3. Refuse truthfully and identify the unresolved dependency.

## Core scenario

The MVP uses one electronics-distributor fixture:

```yaml
buyer_request:
  sku: POWERBANK-20K
  quantity: 25000
  total_value_inr: 7400000
  requested_discount: 0.12
  payment_terms: NET_60
  delivery_days: 14

known_state:
  inventory_available: 14200
  supplier_option_available: 10800
  finance_counterterm: 30_PERCENT_ADVANCE
  expected_contribution_margin_after_counterterm: 0.181
```

These are staged fixture values. The product must never present them as customer validation or production savings.

## User experience

### Operator flow

1. Open the seeded deal or paste the buyer request.
2. See the normalized terms and source context.
3. Start evaluation.
4. Watch six role cards move from `pending` to a typed decision.
5. See constraints as reservations, counterterms, or vetoes rather than chat messages.
6. Send the bounded counteroffer.
7. Resume the same case when the buyer responds.
8. See the Commit Certificate and action receipts.
9. Trigger or observe a supplier disruption.
10. See compensation and repair without losing case history.

### Buyer flow

1. Open a signed, expiring counteroffer link.
2. Review the original request, proposed changes, delivery plan, deposit amount, and expiration.
3. Accept, reject, or choose one permitted counterterm.
4. Receive the backed commitment and Stripe test checkout only after certificate issuance.

## Functional requirements

### P0: Must ship

- **P0-1:** Parse the core buyer request into versioned structured terms.
- **P0-2:** Persist an authenticated operator case and anonymous signed buyer session.
- **P0-3:** Run six role-specific logical agents through the ApplyBee/Hive gateway.
- **P0-4:** Enforce role-specific context and tool permissions on the server.
- **P0-5:** Calculate inventory, credit, margin, and delivery feasibility deterministically.
- **P0-6:** Create expiring inventory, supplier, logistics, and credit reservations with receipts.
- **P0-7:** Generate a bounded 30% advance counterterm when Net-60 fails.
- **P0-8:** Resume the case after buyer acceptance without asking for prior context again.
- **P0-9:** Issue a certificate only when every required reservation is held, fresh, and bound to the same terms version.
- **P0-10:** Commit the sandbox order, CRM stage, resource allocations, Stripe test checkout, and message outbox exactly once.
- **P0-11:** Break a certificate after a supplier disruption and execute permitted compensation exactly once.
- **P0-12:** Produce either a repaired certificate or a truthful escalation.
- **P0-13:** Display a chronological evidence timeline with agent decisions, rule checks, tool calls, and receipts.
- **P0-14:** Run three selectable known-answer cases without builder intervention.

### P1: Ship only after every P0 passes

- Downloadable Commit Certificate JSON.
- ROI panel calculated from fixture inputs.
- Signed receipt bundle export.
- Separate Stripe test payment link for a paid CommitOS design-partner pilot.
- Basic landing page explaining the startup wedge and pricing hypothesis.

## Business rules

- A missing, malformed, stale, or unavailable domain decision blocks certificate issuance.
- Reservations from different terms or case versions cannot be combined.
- Agents cannot override deterministic margin, credit, quantity, date, expiry, or permission checks.
- A customer-facing quote cannot be sent through the protected tool without a valid certificate or an explicitly marked non-binding counteroffer.
- A committed promise cannot be silently edited. Repair creates a new terms version and certificate.
- All fixture savings and ROI values must be labeled staged or simulated.

## Success metrics

### Product metrics

- Time from request to verified terminal state.
- Percentage of commitment attempts reaching a correct terminal state.
- Percentage of customer promises later broken.
- Protected transaction value.
- Contribution margin preserved by accepted counterterms.
- Number of manual handoffs eliminated.
- Percentage of mutations with independently verifiable receipts.

### Hackathon acceptance targets

- At least 85% success across the three-case repeated test suite.
- Three consecutive clean runs of every known-answer case.
- Main live flow completes within 90 seconds.
- No duplicate mutation under retry.
- No certificate issued with a missing or expired dependency.

## Monetization

CommitOS uses an enterprise platform model rather than per-seat agent pricing.

Pricing hypotheses to validate:

- ₹3–8 lakh paid design-partner pilot for one promise type and two integrations.
- ₹24–60 lakh annual mid-market platform contract.
- Usage tier based on commitment count or protected transaction-value band.
- One-time integration and onboarding fee.
- ₹1 crore or greater enterprise contract for multiple business units, governance, SSO, custom policies, and support.

The product should not initially take a percentage of payments. Predictable platform and usage pricing avoids unnecessary payment-regulatory and attribution complexity.

## Expansion

```text
one high-value quote workflow
→ every exception deal
→ supplier and purchase commitments
→ production-capacity commitments
→ customer SLAs and renewals
→ cross-company commitment network
```

## Defensibility

The moat is not prompts or model choice. It is the permissioned commitment graph linking:

- requested terms;
- policy versions;
- role decisions;
- resource reservations;
- counterterms;
- customer responses;
- mutations and receipts;
- disruptions and compensations;
- eventual fulfillment outcomes.

Over time, this dataset can improve policy configuration, counterterm ranking, and commitment reliability without giving LLMs authority over terminal business truth.

## Non-goals

- Replacing an ERP, CRM, WMS, TMS, or payment processor.
- Supporting more than one industry or SKU family in the hackathon.
- Real supplier purchasing or real-money charging.
- Tax, accounting, insurance, underwriting, or legal conclusions.
- General-purpose workflow or agent builders.
- A marketplace for external agents.
- Voice interfaces.
- Open-ended agent debate.
- Model training or fine-tuning.
- Continuous self-revision or self-modifying code.
