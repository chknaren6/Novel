# Revenue Model — Implementation Research

## Core Pricing Decision

**₹300 per Commit Certificate issued.**

That is the entire pricing model. No subscriptions. No seats. No monthly fees.

---

## Why ₹300

Our cost to run all 6 AI agents and issue one Commit Certificate is approximately ₹10 per attempt — covering LLM inference and infrastructure combined.

₹300 gives us:

- Full coverage of the ₹10 compute cost
- Buffer to absorb payment processing fees on failed attempts
- Healthy margin even with a reasonable failure rate
- A price low enough that customers never hesitate to run a request through the system

---

## How the Model Works

| Scenario | Customer Pays | We Keep |
|---|---|---|
| Certificate issued successfully | ₹300 | ₹300 |
| Certificate fails | ₹300 collected, full refund issued | ₹0 |
| Payment fails | Nothing collected | ₹0 |

**Payment is collected before computation begins.**

The certificate is the product. Payment is the key to unlock it. No payment means no certificate, which means no promise goes out.

If the certificate fails for any reason — inventory short, credit rejected, supplier unavailable, margin floor breached — the full ₹300 is refunded instantly. The customer carries zero risk.

---

## Why Charge Before Computation

If we charge after, a customer can dispute or delay payment after receiving value. If we charge before, the model is clean:

- Customer pays to attempt
- We attempt
- Success → we keep the money
- Failure → money goes back

This also aligns with the core product principle: **the certificate has real value, and payment proves intent.**

---

## Our Only Risk

Payment processing fees are deducted at the moment of charge and are not returned even when we issue a refund. This means every failed certificate costs us the processing fee out of pocket.

₹300 is priced to absorb this. Even if 30% of attempts fail, the model remains profitable.

---

## What Makes This Model Strong

**Outcome-based pricing** is the fastest growing pricing model in B2B software in 2026. The principle is simple — the vendor earns only when value is delivered.

Intercom charges per resolved support ticket. Salesforce Agentforce charges per resolved conversation. Our product charges per backed commitment.

The difference from those products: **we refund on failure.** Most outcome-based products charge regardless of whether the outcome was fully successful. Our model only keeps money when the promise is completely backed. That is a stronger guarantee than any competitor offers.

Key market data supporting this model:
- Companies using outcome-based pricing see 31% higher customer retention
- 21% higher customer satisfaction scores
- 43% of SaaS companies now use hybrid or outcome-based pricing, projected to reach 61% by end of 2026

---

## Unit Economics

```
Revenue per successful certificate    ₹300
Cost per attempt (AI + infra)         ₹10
Processing fee on failures            ~₹9 (estimated)

Gross margin on success               96.7%
Net margin accounting for failures    ~90%+ at normal failure rates
```

Even at a 40% failure rate, the model is strongly profitable.

---

## Customer Perspective

From the customer's view:

- ₹300 is negligible compared to the value of a backed ₹74 lakh deal
- They pay nothing if the system cannot back the promise
- They get a machine-verifiable certificate proving every department confirmed
- The certificate is worth far more than ₹300 in avoided coordination cost alone

A single broken commitment at a mid-market distributor costs ₹2–10 lakh in emergency sourcing, margin leakage, and relationship damage. ₹300 to guarantee that never happens is an obvious purchase.

---

## Revenue at Scale

| Monthly Certificates | Revenue |
|---|---|
| 100 | ₹30,000 |
| 500 | ₹1,50,000 |
| 1,000 | ₹3,00,000 |
| 5,000 | ₹15,00,000 |
| 10,000 | ₹30,00,000 |

Revenue grows automatically as the customer closes more deals through the system. No renegotiation. No upsell calls needed.

---

## One Line for Any Audience

> *We charge ₹300 every time we back a business promise. If we cannot back it, the money returns. We only earn when we deliver.*

