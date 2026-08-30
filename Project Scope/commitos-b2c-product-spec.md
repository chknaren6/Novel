# CommitOS B2C Marketplace — Product Specification

**Version:** 1.0
**Phase:** 2 (built on top of B2B core)
**Status:** Pre-build

---

## 1. What It Is

CommitOS B2C is a guaranteed-fulfillment marketplace for industrial and commercial goods. A buyer submits a requirement. CommitOS checks its supplier graph, negotiates the best buy price on the buyer's behalf, and sells the goods to the buyer at a margin — with a guaranteed price, guaranteed delivery, and a single point of accountability.

CommitOS is a transparent intermediary. Buyers know they are buying through CommitOS. The value proposition is certainty and effort saved — not necessarily the cheapest price, but a guaranteed price with guaranteed delivery and no supplier coordination required.

---

## 2. Who It Is For

**Primary buyer persona:** SME owners, contractors, electricians, small manufacturers who regularly source industrial or commercial goods — raw materials, components, electrical goods, packaging, hardware — and currently do so through WhatsApp messages, cold calls, or directories like IndiaMART.

**What they look like:**
- Order in quantities too large for retail but too small to get distributor attention
- Have no formal procurement process
- Spend significant time chasing quotes and following up on deliveries
- Have been burned by suppliers who overpromised and underdelivered
- Operate on tight timelines where a delayed delivery is a real problem

**What they want:**
- Tell someone what they need, get a confirmed price and delivery date, pay, receive goods
- No back and forth, no uncertainty, no supplier management

---

## 3. What CommitOS Promises the Buyer

Every order CommitOS accepts comes with three guarantees:

1. **Confirmed price** — the price quoted is the price charged. No surprise additions.
2. **Confirmed delivery** — the delivery date quoted is the date committed to. If CommitOS misses it, the buyer is compensated per the cancellation policy.
3. **Single accountability** — the buyer's relationship is entirely with CommitOS. They do not manage the supplier, handle disputes with the supplier, or chase anyone. CommitOS handles everything.

These guarantees are only possible because CommitOS runs a commit protocol against the supplier before quoting the buyer. It does not quote and hope. It confirms and then quotes.

---

## 4. How It Works — End to End

### Step 1: Buyer Submits a Requirement

The buyer sends a message on WhatsApp or email describing what they need. Format is unstructured.

**Examples:**
- "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore"
- "Looking for 200kg of HDPE granules, natural grade, urgent"
- "500 units ISI marked 6A switches, need by next week"

CommitOS's intake agent parses the message and extracts:
- Item description and category
- Quantity and unit
- Required delivery date
- Delivery location
- Any quality or specification requirements mentioned

If anything critical is missing, CommitOS asks one clarifying question before proceeding.

---

### Step 2: Supplier Check

The check agent queries the internal supplier graph — built from B2B clients who have opted in to the marketplace — for suppliers who can fulfill the requirement.

The check evaluates:
- Does any supplier carry this product or category?
- Can they fulfill the requested quantity?
- Can they meet the delivery date given their lead time and location?
- Is their data fresh enough to be reliable?

**Data freshness rules:**
- Suppliers with real-time or polling integration (Tier 1/2): data used directly
- Suppliers with daily snapshots (Tier 3): agent adds a freshness warning and factors it into confidence
- If no supplier found: requirement is logged as a demand signal, buyer is informed with a realistic timeline for sourcing, or request is declined if timeline is impossible

If multiple suppliers can fulfill, all viable candidates are passed to the next step ranked by lead time, price band, and reliability history.

---

### Step 3: Negotiation

A human negotiator at CommitOS contacts the shortlisted supplier(s) to get the best buy price. Before the negotiator makes contact, the AI negotiation assistant prepares a brief containing:

- Market price range for the item (from public sources + past transactions)
- Supplier's historical pricing if available
- The buyer's deadline and any flexibility indicators
- BATNA — other suppliers in the graph who can fulfill and at what approximate price
- Suggested opening price
- Walk-away price (below this margin floor the order is declined)
- Suggested negotiation levers (volume commitment framing, repeat order potential, competing quote)

The human negotiator uses this brief to negotiate. The AI does not negotiate autonomously in Phase 1.

**Negotiation approach:**
- Anchor with volume and repeat order potential
- Use BATNA (competing supplier) as leverage
- If price won't move, negotiate lead time or payment terms
- Walk away if supplier won't meet the walk-away price

Once a buy price is confirmed with the supplier, it is locked. The negotiator records the confirmed buy price in CommitOS.

---

### Step 4: Margin Calculation and Buyer Quote

Once buy price is confirmed, CommitOS calculates the sell price.

**Sell price formula:**
```
Confirmed buy price
+ Platform operational cost per order (fixed, set per category)
+ Risk buffer (% of buy price, covers delays and compensation exposure)
+ Margin % (variable by category and order size)
= Sell price quoted to buyer
```

**Margin % by order size:**

| Order Value | Margin % |
|---|---|
| Under ₹25,000 | 10–15% |
| ₹25,000–₹2,00,000 | 7–10% |
| Above ₹2,00,000 | 5–7% |

**Rules:**
- Minimum acceptable margin: 5% — below this, order is declined rather than fulfilled at risk
- Circuit breaker: if daily losses from thin margins exceed a set threshold (defined per operational period), all new B2C orders are paused for manual review
- Sell price must be within 20% of prevailing market price or buyer trust erodes

**Willingness to pay estimation:**
- If buyer stated a budget: use it as a ceiling
- If no budget stated: infer from order urgency (tight deadline = less price sensitive), quantity, and category market price band

CommitOS sends the buyer a quote containing:
- Item, quantity, specification
- Total price (inclusive of all charges)
- Delivery date
- Payment terms
- Quote validity window (typically 4–12 hours depending on supplier capacity volatility)

---

### Step 5: Buyer Accepts and Pays Advance

If the buyer accepts the quote, they pay an advance before CommitOS places the supplier order.

**Advance structure:**

| Order Value | Advance Required | Balance Due |
|---|---|---|
| Under ₹50,000 | 100% | — |
| ₹50,000–₹5,00,000 | 70% | On delivery confirmation |
| Above ₹5,00,000 | 50% | On delivery confirmation |

Payment via UPI, bank transfer, or payment link (Razorpay).

CommitOS does not place the supplier order until the advance is received. This eliminates inventory risk — CommitOS is never net negative on cash at any point in the order lifecycle.

---

### Step 6: Supplier Order Placed

Once advance is received, CommitOS places the confirmed order with the supplier.

**Supplier payment structure:**
- 40–50% paid to supplier on order confirmation
- Balance paid on dispatch confirmation

The difference between buyer advance received and supplier advance paid is always positive.

CommitOS issues an internal Commit Certificate at this point, tying the supplier's confirmed order to the buyer's exact terms (quantity, price, delivery date, location). The certificate is required for all downstream fulfillment steps — dispatch tracking, payment release, delivery confirmation.

---

### Step 7: Fulfillment and Delivery

CommitOS tracks the order from supplier dispatch to buyer delivery.

**Tracking touchpoints:**
- Supplier confirms dispatch → CommitOS notifies buyer
- Goods in transit → CommitOS provides tracking if available
- Delivery confirmed → CommitOS releases balance payment to supplier and collects balance from buyer if applicable

CommitOS is the buyer's single point of contact throughout. The buyer never contacts the supplier directly.

---

### Step 8: Exceptions and Failures

**Supplier delays after order is placed:**
CommitOS first attempts to source from an alternate supplier. If not possible, CommitOS notifies buyer with a revised delivery date and offers compensation (partial refund or discount on next order) depending on delay severity.

**Supplier cancels entirely:**
CommitOS attempts alternate sourcing. If no alternate exists within the buyer's acceptable window, CommitOS issues a full refund plus a compensation payment of 5–10% of order value to the buyer. CommitOS absorbs this cost — it is the risk the margin is priced to cover.

**Buyer cancels before supplier order is placed:**
Full refund minus 2% processing fee.

**Buyer cancels after supplier order is placed but before dispatch:**
CommitOS retains 15% of order value as a cancellation fee. Remaining advance refunded. CommitOS handles the supplier cancellation — any supplier cancellation fee is absorbed by CommitOS up to a defined limit.

**Buyer cancels after dispatch:**
No refund. Goods either returned to supplier (if supplier accepts returns — negotiated in supplier agreements) or resold by CommitOS.

All cancellation terms are shown to the buyer before payment. No surprises.

---

## 5. Channels

### WhatsApp (Primary)

WhatsApp Business API number. Buyers message in natural language. The intake agent parses the requirement. Quote is sent back in WhatsApp. Payment link sent in WhatsApp. Order updates sent in WhatsApp. The entire order lifecycle is managed in one WhatsApp thread.

**Why WhatsApp:** Indian SME buyers already send RFQs to suppliers over WhatsApp. CommitOS meets them in the channel they already use.

### Email (Secondary)

Same flow, email-based. Slightly more formal buyers. Same backend.

### Public Website (Tertiary)

A public-facing website where buyers can submit requirements directly. Not a marketplace storefront — no product browsing, no catalogue. The website has a single primary action: describe what you need and submit. The intake agent processes it the same way as a WhatsApp or email request. The website also serves as the discovery surface — buyers who find CommitOS through search or word of mouth land here and understand what the product does before submitting their first requirement.

No mobile app in Phase 1.

---

## 6. Supplier Relationship

### Onboarding

Suppliers are B2B clients who have explicitly opted into the marketplace program. Opt-in is a separate agreement from their B2B CommitOS subscription.

**What suppliers agree to when they opt in:**
- Share product catalogue, pricing bands, MOQ, lead times, and available capacity with CommitOS
- Accept orders placed by CommitOS without knowing the end buyer's identity
- Honor committed prices for the duration of a quote validity window
- Accept CommitOS's payment terms (advance on order confirmation, balance on dispatch)

**What CommitOS agrees to:**
- Not disclose supplier identity to buyers without supplier's consent
- Bring guaranteed, pre-paid orders
- Handle all buyer communication — supplier deals only with CommitOS

### Data Freshness Tiers

| Tier | Method | Frequency | Check Agent Behaviour |
|---|---|---|---|
| Tier 1 | Supplier pushes webhooks on inventory change | Real-time | Data used directly |
| Tier 2 | CommitOS polls supplier system via B2B adapter | Every 15–30 minutes | Minor confidence adjustment if last poll > 2 hours ago |
| Tier 3 | Daily data export from supplier | Daily | Freshness timestamp shown; human confirmation required if data > 20 hours old |

### Data Stored Per Supplier

- Product catalogue (SKUs, categories, specifications)
- Pricing bands (listed price, MOQ-based bands)
- Available inventory / production capacity
- Lead time by quantity range
- Geographic delivery coverage (states, pincodes)
- Payment terms accepted
- Quality certifications (ISI, ISO, BIS etc.)
- Historical reliability (on-time delivery rate, cancellation rate) — built over time from transaction data

---

## 7. Pricing and Revenue Model

### Revenue Sources

**Primary — Trading margin:**
CommitOS buys at negotiated buy price, sells at marked-up sell price. Margin ranges 5–15% by category and order size.

**Secondary — Cancellation fees:**
15% retention on buyer cancellations post-supplier-order placement.

**Not a revenue source — supplier commissions:**
CommitOS does not take commission from suppliers. Its interests must be aligned with getting the buyer the best price. Supplier commissions create the wrong incentive.

### Unit Economics (Illustrative)

| Line | Amount |
|---|---|
| Average order value | ₹75,000 |
| Average margin % | 8% |
| Gross margin per order | ₹6,000 |
| Operational cost per order | ₹1,500 |
| Risk buffer absorbed (avg) | ₹500 |
| **Net contribution per order** | **₹4,000** |

**Scale targets:**
- 50 orders/month → ₹2,00,000 net contribution
- 200 orders/month → ₹8,00,000 net contribution

---

## 8. The Commit Protocol in B2C Context

The B2C layer uses the same core CommitOS protocol as B2B, adapted for CommitOS as the principal rather than coordinator.

**Check phase:** Check agent queries supplier graph. Returns viable suppliers with capacity confirmation ranked by fit.

**Prepare phase:** Negotiation completed, buy price locked, sell price calculated, quote sent to buyer. Draft certificate prepared internally — not yet committed because buyer has not accepted.

**Commit phase:** Buyer pays advance. CommitOS places supplier order and receives supplier confirmation. Internal Commit Certificate issued tying buyer's exact terms to supplier's confirmed order. Certificate required for all downstream fulfillment actions.

**Monitoring:** Certificate monitored for supplier-side failures (delay, cancellation, quality issue). If a dependency breaks, repair protocol runs — alternate supplier sourcing or buyer compensation.

**Compensation:** If order cannot be fulfilled and compensation is owed, it is logged as a typed compensation event against the certificate. Compensation does not happen informally.

---

## 9. What CommitOS Does Not Do in B2C

- Does not run a product catalogue or storefront — this is request-driven, not browse-driven
- Does not allow buyers to contact suppliers directly
- Does not act as a logistics provider — coordinates with supplier's logistics or books third-party logistics, but does not own a fleet
- Does not extend credit to buyers — advance payment is required
- Does not handle customs, import, or cross-border trade in Phase 1
- Does not operate in B2C consumer categories (clothing, electronics, food) — industrial and commercial goods only

---

## 10. Demand Signal Logging

Every request where no supplier is found in the graph is logged as a demand signal.

**Each demand signal records:**
- Item description and category
- Quantity
- Delivery location
- Deadline
- Buyer identifier (anonymised)
- Date of request

Demand signals are reviewed weekly. High-frequency misses in a category trigger proactive supplier outreach — CommitOS finds and onboards a supplier for that category.

This is how the supplier graph grows based on actual buyer demand rather than speculative outreach.

---

## 11. Metrics That Matter

### Operational Metrics

| Metric | Description | Target |
|---|---|---|
| Request-to-quote time | Time from buyer message to quote sent | Under 2 hours |
| Quote-to-order conversion | % of quotes that result in payment | Track and improve |
| Supplier confirmation rate | % of placed orders confirmed on time by supplier | > 95% |
| On-time delivery rate | % of orders delivered on committed date | > 90% |
| Buyer cancellation rate | % of orders cancelled by buyer after payment | Track |
| Supplier cancellation rate | % of orders cancelled by supplier after confirmation | Track separately |
| Demand signal miss rate | % of requests with no supplier match | Track; drives outreach |

### Financial Metrics

| Metric | Description |
|---|---|
| Gross margin per order | Sell price minus buy price |
| Net contribution per order | Gross margin minus operational cost and risk buffer |
| GMV (Gross Merchandise Value) | Total value of orders placed per month |
| Average order value | GMV divided by order count |

### Quality Metrics

| Metric | Description |
|---|---|
| Buyer repeat order rate | Strongest signal the product is working |
| Buyer-reported issues per 100 orders | Disputes, wrong goods, quality complaints |
| Compensation events per 100 orders | How often CommitOS has to compensate |

---

## 12. Technical Surface

### Intake Layer
- WhatsApp Business API integration
- Email intake parser
- Web form
- All three route into the same intake agent

### Supplier Graph
- Supplier registry (catalogue, pricing, capacity, lead time, geography, certifications, reliability history)
- Freshness tier management (event-driven, polling, snapshot)
- Check agent — queries graph, returns viable suppliers ranked by fit

### Negotiation Tooling
- Negotiation brief generator — market price, BATNA, historical supplier pricing, suggested opening price, walk-away price
- Human negotiator interface — internal tool where negotiator records confirmed buy price
- Market price reference module — pulls from public sources (IndiaMART, Amazon Business) for price benchmarking

### Margin Engine
- Takes confirmed buy price, category, order size, urgency signals
- Calculates sell price within margin policy
- Applies floor and circuit breaker rules

### Buyer Communication
- Quote delivery over WhatsApp / email
- Payment link generation (Razorpay)
- Order status updates
- Cancellation handling

### Order Management
- Internal order tracker — supplier order placed, dispatched, delivered
- Commit Certificate lifecycle per B2C order
- Compensation event logging

### Demand Signal Store
- Logs every unfulfilled request
- Weekly review dashboard

---

## 13. Phase 2 Launch Checklist

Do not launch B2C until all of the following are true:

- [ ] At least 5 B2B clients are active and generating Commit Certificates
- [ ] At least 3 suppliers have explicitly opted in to the marketplace program
- [ ] At least one vertical has been studied with real buyer and supplier interviews (minimum 10 buyers, 5 suppliers)
- [ ] A human negotiator is hired or designated
- [ ] Cancellation policy is written and reviewed by a lawyer
- [ ] Razorpay (or equivalent) payment integration is live and tested
- [ ] WhatsApp Business API approval is obtained (start this application early — approval takes time)
- [ ] First 10 orders planned to be processed manually with the system in the background for logging

The first 10 orders are done entirely manually. This is intentional — learn the edge cases before automating them.

---

## 14. Positioning

CommitOS B2C is not a directory. It is not a marketplace where buyers browse and pick suppliers. It is a procurement agent that does the work the buyer would otherwise do themselves — finding a supplier, negotiating, placing the order, tracking delivery — and backs every step with a guarantee.

The buyer pitch: "You could spend two days finding a supplier, negotiating blind, placing the order, and hoping they deliver. Or you can tell us what you need and we'll handle everything, guaranteed."

The margin is earned by the guarantee, the negotiation, and the accountability — not by marking up a listing.
