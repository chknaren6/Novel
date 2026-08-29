# CommitOS Demo, GTM, and Monetization Specification

## Judge-facing position

Category:

> The transaction control plane for enterprise promises.

Cold open:

> Salespeople and AI agents can promise anything. CommitOS ensures every promise reserves the inventory, credit, margin, supply, and delivery capacity required to fulfill it before the customer receives it.

Do not open with “six agents,” the tech stack, or an architecture diagram.

## Three-minute presentation

### 0:00–0:30 — Business context

Show the ₹74 lakh buyer request and say:

> A large quote crosses Sales, Finance, Inventory, Procurement, Logistics, and Risk. Today, those teams coordinate through calls and spreadsheets, and the customer may receive a promise before the business has backed it.

Name the metric: time to a safe commitment and broken-promise exposure.

### 0:30–1:00 — Current workflow failure

Show compact source-state cards:

- only 14,200 of 25,000 units currently available;
- the balance depends on a supplier option;
- Net-60 violates credit policy;
- delivery and margin depend on the final terms.

Explain that ordinary ERP records the order and ordinary deal desks recommend terms. CommitOS makes the promise itself a controlled transaction.

### 1:00–2:35 — Live product

1. Start evaluation.
2. Show Sales normalize the request, then Finance, Inventory, Procurement, and Logistics resolve in parallel.
3. Risk challenges their evidence and reservation coverage.
4. Finance vetoes Net-60; Inventory, Procurement, and Logistics place typed reservations.
5. Sales creates the bounded 30% advance counteroffer.
6. Judge or teammate accepts through the buyer page.
7. Show certificate issuance and receipts for order, inventory, CRM, checkout, and outbox.
8. Judge clicks `Supplier B unavailable`.
9. Show the original certificate break, compensation receipts, Supplier C repair, and new certificate.

Narrate only state transitions and business consequences. Do not read agent explanations aloud.

### 2:35–3:00 — Startup close

> We begin with high-value exception quotes at distributors and manufacturers. Customers pay an annual platform fee plus usage based on backed commitments. The wedge expands from deal commitments into supplier, production, and service promises. ERP tells you what the business did; CommitOS proves what it can safely promise next.

End on the repaired backed commitment, not the architecture.

## Demo controls

- Fixture selector is visible but defaults to the happy-path case.
- The buyer page is already open on a second device or browser session.
- Supplier disruption is a visible judge-controlled button.
- Reset is available only outside the main action area and requires confirmation.
- Every animation is driven by persisted events.
- Backup recording follows the same sequence and contains no hidden edits.

## Monetization model

### Paid pilot

₹3–8 lakh for a four-to-six-week design-partner pilot covering:

- one protected promise type;
- two production-system integrations;
- current-state baseline;
- policy configuration;
- measured time-to-safe-commit and exception outcomes.

### Production contract

- ₹24–60 lakh annual mid-market platform fee.
- Usage tier based on commitment count or protected transaction-value band.
- One-time integration/onboarding fee.
- ₹1 crore or greater enterprise tier for multiple business units, SSO, custom policies, governance, support, and SLAs.

These are pricing hypotheses. Do not describe them as validated market prices.

### Revenue-track evidence

- Display a clear paid-pilot offer and pricing structure.
- Calculate fixture ROI from explicit seeded inputs.
- Use Stripe test mode for the buyer deposit.
- If P0 is stable, add a separate Stripe test payment link for reserving a CommitOS paid pilot.
- Record willing-to-pay reactions from interviewees; never fabricate signups or transactions.

## ROI model

```text
annual customer value =
  margin leakage prevented
  + emergency sourcing and freight avoided
  + manual coordination cost removed
  + contribution from deals committed faster
  - CommitOS annual cost
```

The demo displays component inputs and formulas. It does not annualize a staged case as a real customer result unless the operator explicitly selects a hypothetical scenario label.

## Go-to-market

### Design-partner profile

- Distributor or manufacturer with complex B2B quotes.
- At least three operational systems involved in quote-to-order.
- Visible exception queue and manual approval process.
- Executive owner for order reliability, revenue operations, finance, or supply chain.
- Willingness to provide anonymized workflow timings and failure categories.

### Sales motion

1. Identify one expensive promise failure or approval bottleneck.
2. Map the current workflow and establish a baseline.
3. Run a paid pilot beside the existing ERP rather than replacing it.
4. Protect one action and one promise type.
5. Demonstrate faster correct commitments and fewer broken promises.
6. Expand by transaction volume, connector, workflow, and business unit.

### Expansion

```text
exception quote
→ all deal commitments
→ supplier and purchase promises
→ production capacity
→ customer SLAs and renewals
→ cross-company commitment network
```

## Competitive boundary

- SAP and other ERPs are systems of record and increasingly ship business agents.
- Available-to-promise products calculate inventory and delivery feasibility.
- Deal-desk products manage pricing and approvals.
- Agentic commerce protocols enable discovery and checkout.

CommitOS must not claim to invent order promising, saga compensation, deal desks, or agentic checkout. Its differentiator is the cross-domain, expiring, compensatable certificate required before a consequential enterprise promise is released.

## Investor narrative

- **Wedge:** high-value exception deals.
- **Buyer:** executive owner of revenue reliability and operations.
- **Business model:** enterprise platform plus usage and integrations.
- **Expansion:** more promises and business units increase ACV.
- **Moat:** permissioned commitment-to-outcome graph.
- **Why now:** more human and AI actors can initiate business actions, increasing the need for pre-action operational proof.

## Claims policy

Allowed:

- exact fixture values;
- measured hackathon run time;
- test-mode transaction state;
- recorded interview statements with consent;
- clearly labeled pricing and ROI hypotheses.

Forbidden:

- fabricated users, revenue, savings, accuracy, or partner logos;
- claiming production ERP integrations when using sandbox adapters;
- calling a prepared checkout a completed payment;
- describing LLM output as deterministic proof;
- claiming the product guarantees legal or financial outcomes.

## Validation target during the event

Collect five short reactions from relevant builders, operators, founders, or mentors. Ask:

1. Where does a large quote get stuck today?
2. What is the cost of a promise that later breaks?
3. Which system or executive owns the problem?
4. Would a pre-commit control layer be purchased separately from the ERP?
5. What pilot scope and price would be credible?

Record role, company type, pain, buying objection, and willingness-to-pilot signal. Do not collect unnecessary personal information.

## Submission checklist

- Public repository and build instructions created during the event.
- Live application URL.
- Three-minute backup video.
- Primary-track evidence for Novelty.
- Pricing, ROI logic, and GTM brief.
- Three-case results and action receipts.
- Architecture image.
- Disclosure of pre-event planning/spec context if requested.
