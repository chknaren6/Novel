# B2C Core Workflow — Design

**Goal:** Build the actual B2C marketplace workflow — intake → check → negotiate → quote → buyer accept → commit — end to end, using fixture/fake data for suppliers and a fake payment step, but a **real** LLM call for intake parsing. No WhatsApp/email/Razorpay integration; those are channel/payment-rail work for a later plan.

**Architecture:** Maximizes reuse of existing generic B2B machinery (confirmed by reading it directly, not assumed) and adds only what's genuinely new: intake parsing, supplier matching/ranking, the margin engine, and a B2C-flavored commit step. Case status stays entirely within `intake`/`evaluating`/`prepared`/`committing`/`committed`/`cannot_commit` — no new `CaseStatus` value, per the foundation plan's finding #2 (`09-B2C-FOUNDATION-NOTES.md`).

**Tech Stack:** Same as existing — Prisma/SQLite, Zod, OpenAI SDK, Vitest, TypeScript.

---

## What's reused as-is (verified by reading the code, not assumed)

| Function | File | Why it's already generic |
|---|---|---|
| `holdSupplierOption` | `src/adapters/supplierAdapter.ts` | Takes `caseId/caseVersion/termsHash/supplierId/sku/quantity/maxUnitCostMinor/maxLeadDays/ttlSeconds` — zero B2B-specific assumptions. |
| `prepareCommitCertificate` | `src/reservations/coordinator.ts` | Takes `requiredDomains` as a parameter — will be called with `B2C_REQUIRED_DOMAINS = ["supplier"]` (already added in the foundation plan). |
| `commitOrder` | `src/workflow/commit.ts` | Takes `depositMinor` as a plain number parameter — the caller computes economics, this function doesn't hardcode any B2B constant. |
| `calculateDealEconomics` | `src/policy/economics.ts` | Takes `depositBps`/`unitCostMinor` as parameters — fully generic. |
| `transitionCase` / `assertValidTransition` | `src/state/transitions.ts` | Domain-agnostic status machine, confirmed no B2B coupling. |
| `emitCaseEvent` | `src/workflow/events.ts` | Domain-agnostic. |
| `abortCommitment` / `releaseReservations` | `src/reservations/coordinator.ts` | Domain-agnostic, dispatches on `reservation.domain`. |
| `signBuyerToken` / `hashBuyerToken` / `verifyBuyerToken` | `src/lib/hash.ts` | Domain-agnostic. |
| `runReceiptedAction`, sandbox ERP/Stripe/outbox adapters | `src/receipts/`, `src/adapters/` | Already "fake" (sandbox/mock) — exactly matches this plan's own "fakes" scope, reused as the stand-in for a future real ERP/Razorpay integration. |

**Not reused, needs B2C-specific replacement:** `SKU_UNIT_COST_MINOR` and `ADVANCE_DEPOSIT_BPS` (the B2B economics constants `runCommit` reads) — B2C sources these from `TermsVersion.confirmedBuyPriceMinor`/`advanceBps` (already added in the foundation plan) instead.

## A simplification the B2B pattern doesn't need

B2B's buyer always states a price up front, so a `TermsVersion` exists (and gets *re-negotiated* via `createCounteroffer`, v→v+1) before any human/agent decision happens. B2C's buyer requirement has **no price at all** until a human negotiates a buy price with a supplier — so there's nothing to persist as a priced `TermsVersion` before that happens.

**Decision:** intake and check are pure/read-only steps (no `DealCase` exists yet). The `DealCase` and its **only** `TermsVersion` (v1) are created together, already priced, at the moment a human's negotiated buy price comes in. There is no provisional-then-repriced two-version dance, and — because terms never change between being quoted and being accepted — **buyer acceptance needs no version bump either**, unlike B2B's buyer-response flow (read directly from `commitos-p0-vertical-slice`'s `buyerResponse.ts` for comparison, not merged into `main` yet but instructive: it re-runs the entire 6-role evaluation on accept because the terms actually changed; B2C's terms don't change on accept, so there's nothing to re-evaluate).

## File-by-file plan

All new files under `src/workflow/b2c/` (kept out of `dealSubmitted.ts`, per the Task 3 code-quality reviewer's note in the foundation plan that B2C content was already starting to blur that file's responsibility).

### `prisma/schema.prisma` (modify)
Add `channel String @default("b2b")` to `DealCase`, right after `fixtureId`. Every existing row backfills to `"b2b"` automatically (SQLite `ALTER TABLE ... ADD COLUMN ... DEFAULT`). Lets any future query or dashboard tell B2B and B2C cases apart without inferring it from `customerId`'s target table.

### `src/policy/b2cMargin.ts` (new)
Pure function implementing `commitos-b2c-product-spec.md` §4 Step 4's tables exactly:

```typescript
export interface B2CMarginInput {
  buyPriceMinor: number; // per-unit, from supplier negotiation
  quantity: number;
  operationalCostMinor: number; // fixed per-order, category-set — passed in, not hardcoded here
  riskBufferBps: number; // % of buy price
}
export interface B2CMarginResult {
  sellPriceMinor: number;
  marginBps: number;
  advanceBps: number; // 10000 (100%), 7000 (70%), or 5000 (50%) by order value band
}
export function calculateB2CQuote(input: B2CMarginInput): B2CMarginResult
```

Margin % bands (§4): <₹25,000 → 12.5% (midpoint of 10-15%), ₹25,000-₹2,00,000 → 8.5% (midpoint of 7-10%), >₹2,00,000 → 6% (midpoint of 5-7%) — picking the documented range's midpoint is the same convention this codebase already used for `MOTION_DURATION_MS` in the Novel website plan, applied here to a business-policy range instead of a UI-timing range. Advance % bands (§5): <₹50,000 → 100%, ₹50,000-₹5,00,000 → 70%, >₹5,00,000 → 50%. Floor: if computed margin would be <5%, the function returns `null` instead of a result (caller declines the order per §4's "Minimum acceptable margin" rule) — so the return type is actually `B2CMarginResult | null`.

### `src/workflow/b2c/intake.ts` (new)
```typescript
export interface ParsedRequirement {
  itemDescription: string;
  quantity: number;
  unit: string;
  deliveryDeadline: string; // ISO date
  location: string;
  missingCriticalField: string | null; // set instead of guessing, per spec §4 Step 1
}
export async function parseB2CRequirement(
  client: OpenAI, modelId: string, rawText: string, timeoutMs: number,
): Promise<ParsedRequirement>
```
One bounded `chat.completions.create` call with `response_format: json_schema` (the same OpenAI SDK pattern `OpenAIModelGateway`'s final-response call already uses — read directly from `src/gateway/openaiGateway.ts:110-118` — but **not** routed through `ModelGateway.runRole`, since that interface is typed around the 6-role `RoleModelOutput` decision vocabulary, which doesn't fit "extract structured fields from free text" at all). Network/parse failures map to `ToolError("PROVIDER_UNAVAILABLE", ...)`/`ToolError("INVALID_INPUT", ...)`, mirroring the existing gateway's own error convention exactly.

### `src/workflow/b2c/check.ts` (new)
```typescript
export interface SupplierCandidate {
  supplierId: string; unitCostMinor: number; leadDays: number;
  availableQuantity: number; freshnessTier: string | null; isStale: boolean;
}
export async function findSupplierCandidates(
  db: PrismaClient, input: { sku: string; quantity: number },
): Promise<SupplierCandidate[]>
```
Deterministic Prisma query — `supplierOption.findMany({ where: { sku, status: "available", availableQuantity: { gte: quantity } } })`, sorted by `(unitCostMinor asc, leadDays asc)`. `isStale` is `true` when `freshnessTier === "tier3"` and `lastVerifiedAt` is more than 20 hours old (§6's exact threshold). No LLM call — this is a query+rank function, not a reasoning agent, matching the design-validation finding that "check agent" doesn't fit the `RoleModelOutput` vocabulary.

### `src/workflow/b2c/createCase.ts` (new)
The orchestrator a human negotiator's tool calls once they've confirmed a buy price with a chosen supplier:

```typescript
export interface CreateB2CCaseInput {
  buyerName: string; buyerPhone: string; buyerEmail?: string;
  parsedRequirement: ParsedRequirement;
  chosenSupplierId: string;
  negotiatedBuyPriceMinor: number;
  operationalCostMinor: number; riskBufferBps: number;
  buyerLinkSigningSecret: string; traceId: string;
}
export async function createB2CCase(db: PrismaClient, input: CreateB2CCaseInput)
```
Steps: find-or-create `MarketplaceBuyer` by phone; find-or-create a sentinel `Company` named `"CommitOS"`; run `calculateB2CQuote` (decline with `{ status: "declined_margin_floor" }` if it returns `null`); create `DealCase` (`channel: "b2c"`, `status: "intake"`) + its one `TermsVersion` v1 (`paymentTerms: "ADVANCE_VARIABLE"`, `confirmedBuyPriceMinor`, `advanceBps`, `source: "buyer_request"`); `transitionCase` intake→evaluating; `emitCaseEvent("b2c.requirement_parsed", ...)` with the raw parsed requirement as payload (the audit trail for a step that otherwise never touched the DB); call `holdSupplierOption` with `ttlSeconds` = the quote validity window in seconds (**12 hours = 43200**, not B2B's 900s — B2B's TTL assumes a synchronous few-second 6-role evaluation; B2C's spans a human negotiation plus §4's "4-12 hour" buyer quote window, so the hold has to survive that whole span); sign a buyer token and create a `Counteroffer` row directly (`sourceTermsVersion: 1, proposedTermsVersion: 1, status: "sent"` — deliberately *not* calling `createCounteroffer`, which creates a *new* v+1 row from an existing one; here v1 already *is* the final priced terms, so reusing that helper would fabricate a phantom v0). Returns `{ dealCase, termsVersion, buyerToken }` (or the decline/no-supplier-match result).

### `src/workflow/b2c/buyerResponse.ts` (new)
```typescript
export async function runB2CBuyerResponse(
  db: PrismaClient, input: { buyerToken: string; response: "accept" | "reject"; traceId: string; buyerLinkSigningSecret: string },
)
```
Verify token → look up `Counteroffer` by token hash → same status/expiry guards as B2B's `buyerResponse.ts` (idempotent replay of an already-accepted/rejected token returns the same result, never re-mutates). On `reject` or expiry: `transitionCase` evaluating→cannot_commit, `abortCommitment` (releases the held supplier reservation). On `accept`: mark counteroffer accepted, `prepareCommitCertificate` (using the held reservation, `requiredDomains: B2C_REQUIRED_DOMAINS`), `transitionCase` evaluating→prepared, then call `runB2CCommit` (below) immediately — mirroring B2B's "direct-feasible" path, since there's no re-evaluation step to insert between prepare and commit.

### `src/workflow/b2c/commit.ts` (new)
Structurally identical to `runCommit` (`src/workflow/commit.ts`) — same transition sequence (`prepared → committing → committed`, or `→ aborting → escalated` on failure), same `commitOrder`/`abortCommitment` calls — but its economics come from the terms row itself:

```typescript
const economics = calculateDealEconomics({
  totalValueMinor: terms.totalValueMinor,
  discountBps: terms.discountBps,
  quantity: terms.quantity,
  unitCostMinor: terms.confirmedBuyPriceMinor ?? 0, // B2C: negotiated per-order, not a static SKU table
  paymentTerms: terms.paymentTerms as PaymentTerms,
  depositBps: terms.advanceBps ?? 0, // B2C: variable per-order, not the fixed 3000
});
```

## Non-goals (explicitly out of scope)

- WhatsApp Business API, email intake, Razorpay — the intake *parsing* and payment *bookkeeping* are built; the real channels/rails are not.
- Demand-signal logging (spec §10) — a real but separable feature; not required to prove the core commit protocol works end to end.
- A negotiation-brief generator (market price / BATNA / walk-away price) — `createB2CCase`'s input assumes a human has *already* negotiated a price; producing the brief that helps them do so is a distinct, later piece of work.
- Supplier data freshness *enforcement* beyond the `isStale` flag on candidates — `check.ts` surfaces staleness, it doesn't block or require confirmation on it yet.

## Self-review

- **Placeholder scan:** none — every new file has a concrete signature and concrete logic description.
- **Type consistency:** `ParsedRequirement`, `SupplierCandidate`, `B2CMarginResult`, `CreateB2CCaseInput` are each defined once and referenced by name throughout.
- **Spec coverage:** every step in `commitos-b2c-product-spec.md` §4 (Steps 1-6) has a corresponding file/function above; Steps 7-8 (fulfillment tracking, exception handling) are correctly left for a later plan since they require the real WhatsApp/tracking integrations this plan explicitly excludes.
