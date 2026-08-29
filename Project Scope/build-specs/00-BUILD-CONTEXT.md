# CommitOS Build Context

This directory is the source of truth for building **CommitOS**, a transaction control plane for enterprise promises. It converts one complex B2B request into a resource-backed commitment, a bounded counteroffer, or a truthful refusal.

## Read in this order

1. [Product specification](01-PRODUCT-SPEC.md)
2. [Technical specification](02-TECHNICAL-SPEC.md)
3. [Agent architecture](03-AGENT-ARCHITECTURE.md)
4. [Data and state specification](04-DATA-AND-STATE-SPEC.md)
5. [Tool contracts](05-TOOL-CONTRACTS.md)
6. [Evaluation and test specification](06-EVALUATION-AND-TEST-SPEC.md)
7. [Demo, GTM, and monetization](07-DEMO-GTM-AND-MONETIZATION.md)
8. [24-hour build scope](08-24-HOUR-BUILD-SCOPE.md)

The original concept brief remains at [../01-COMMITOS.md](../01-COMMITOS.md). If it conflicts with this directory, this directory wins because it contains the validated build decisions.

## Locked product decision

CommitOS is not a replacement ERP and not a conversational “agent council.” It is the **transaction control plane for enterprise promises**.

The beachhead is one high-value, non-standard B2B quote at a mid-market distributor or manufacturer. CommitOS sits between a salesperson or AI agent and protected actions such as `send_quote` and `commit_order`. Those actions reject execution unless a valid Commit Certificate proves that the required inventory, credit, margin, supplier capacity, logistics capacity, and payment terms are simultaneously backed.

## Locked architecture decisions

- Six logical role agents: Sales, Finance, Inventory, Procurement, Logistics, and Risk.
- One shared agent runtime and one organizer-provided ApplyBee/Hive model gateway.
- Role instances differ by context, objective, tools, permissions, memory namespace, and authority.
- Agents exchange typed decisions through persisted case state. They do not debate through natural-language messages.
- Deterministic code owns calculations, policies, versions, reservations, certificate validity, commit, abort, compensation, and terminal state.
- The application is event-driven. It does not continuously poll an LLM, rewrite its prompts, or modify its own code.
- Emergent is the primary coding and deployment accelerator. ApplyBee/Hive is the required runtime model gateway.
- Supabase/Postgres is the persistent source of truth. Stripe runs in test mode. ERP, supplier, and logistics systems are production-shaped sandbox adapters.

## Product law

```text
Agents interpret ambiguity and propose bounded actions.
Code verifies money, inventory, policy, freshness, and authority.
Tools create observable state and return persistent receipts.
```

No LLM output may directly mint a certificate, calculate final money or inventory values, choose a terminal state, or bypass server-side permissions.

## Hackathon constraint

The implementation must be created during the official 24-hour on-site build and must use the ApplyBee/Hive infrastructure. Planning documents are pre-event context only. The submission should disclose the pre-existing idea and spec work if organizers consider it a borderline starting point.

The public ApplyBee material does not document the production SDK, REST base URL, authentication format, model IDs, structured-output behavior, tool schema, or concurrency limits. The implementation therefore uses the `ModelGateway` boundary defined in the technical specification. At kickoff, one builder must map that interface to the official organizer documentation before other role-agent work proceeds.

## Demonstrated outcome

The demo uses one electronics-distributor case:

1. A buyer requests 25,000 power banks for ₹74 lakh, with a 12% discount, Net-60 payment, and delivery within 14 days.
2. Finance rejects Net-60, Inventory can reserve 14,200 units, Procurement can option the remaining 10,800 units, and Logistics can hold a split-delivery plan.
3. Sales sends a bounded counteroffer for 30% advance payment.
4. The buyer accepts through a persisted counterparty page.
5. CommitOS creates a valid certificate, commits sandbox business writes, and releases a Stripe test checkout.
6. A supplier disruption breaks the original certificate.
7. CommitOS compensates affected actions exactly once and either issues a repaired certificate or returns a truthful escalation.

## Required terminal states

Every case must finish in exactly one of these states:

- `committed`
- `cannot_commit`
- `repaired`
- `escalated`

“Recommendation ready,” “awaiting agent consensus,” and free-form prose are not terminal states.

## Definition of complete

The hackathon build is complete only when:

- three known-answer cases pass three consecutive runs;
- every mutation has a durable receipt and idempotency key;
- the product survives a page reload and resumes the same case;
- the judge can change one input and observe a different verified action;
- the ApplyBee/Hive request path is visible in traces or receipts;
- the live demo fits inside two minutes of a three-minute presentation;
- a backup recording and evidence package exist;
- the repository contains no real credentials or private customer data.
