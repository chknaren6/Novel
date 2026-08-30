# B2C Foundation Tweaks — Design

**Goal:** Make the existing B2B CommitOS schema/workflow capable of hosting a B2C marketplace case without breaking or reinterpreting any existing B2B behavior. This is groundwork only — no intake/check/negotiation agents, no WhatsApp/Razorpay, no actual B2C workflow file. Those are follow-up plans once this foundation exists.

**Architecture:** Every change here is additive (new nullable columns, new tables, new named constants) or documentation-only. Nothing in the existing B2B `evaluateAndRoute`/`runCommit`/fixture code changes behavior. This was validated against `Project Scope/commitos-b2c-product-spec.md` and `Project Scope/build-specs/04-DATA-AND-STATE-SPEC.md`.

**Tech Stack:** Same as the existing app — Prisma/SQLite, Zod, Vitest, TypeScript.

---

## Decisions, one per identified gap

### 1. Variable advance percentage (was: fixed `ADVANCE_30` enum + hardcoded 3000bps)

- Add `"ADVANCE_VARIABLE"` to `PaymentTermsSchema` (`src/lib/types.ts`) alongside the existing `NET_60`/`ADVANCE_30`/`OTHER_BOUNDED` — additive, doesn't touch existing values or any code branching on them.
- Add nullable `advanceBps Int?` to `TermsVersion` (Prisma). Only meaningful when `paymentTerms === "ADVANCE_VARIABLE"`; null for every existing B2B row and every non-advance B2C row.
- `calculateDealEconomics` (`src/policy/economics.ts`) already takes `depositBps` as a plain parameter — no signature change needed. A future B2C caller passes `terms.advanceBps` instead of the B2B `ADVANCE_DEPOSIT_BPS` constant; that caller doesn't exist yet, so this task only adds the field and its validation, not the caller.

### 2. Separate lightweight buyer identity (was: reusing `Customer`, which is entirely trade-credit shaped)

- New Prisma model `MarketplaceBuyer`: `id`, `name`, `phone`, `email` (nullable), `createdAt`. No credit fields — a B2C buyer never has a credit limit or exposure.
- `DealCase.customerId` has **no enforced foreign key today** (confirmed by reading the migration SQL — only `companyId` has a real `FOREIGN KEY` constraint). So a B2C `DealCase` can point `customerId` at a `MarketplaceBuyer.id` with zero schema conflict. `companyId` still requires a real `Company` row; the convention is one sentinel `Company` row (name: `"CommitOS"`) that every B2C case uses, seeded once, documented in a code comment next to the new model.

### 3. B2C-specific required reservation domains (was: `REQUIRED_BASE_DOMAINS = ["credit","inventory","logistics"]`, B2B-only)

- Add `B2C_REQUIRED_DOMAINS: ReservationDomain[] = ["supplier"]` next to (not replacing) `REQUIRED_BASE_DOMAINS` in `src/workflow/dealSubmitted.ts`, with a comment explaining B2C never extends credit and doesn't hold its own inventory (per `commitos-b2c-product-spec.md` §9), so `credit`/`inventory` never apply. Unused until a real B2C workflow file exists — that's fine, it documents the decision at the point future code will look for it, the same way `SKU_UNIT_COST_MINOR` existed before any script consumed a given SKU.

### 4. Async human-in-the-loop pause point (was: `evaluateAndRoute` runs synchronously start-to-finish)

- **Finding, not a code change**: `transitionCase` (`src/state/transitions.ts`) and `emitCaseEvent` are already domain-agnostic — they don't assume the 6-role B2B fanout. A B2C workflow can already sit in `evaluating` indefinitely while a human negotiates with a supplier, then call the same `transitionCase`/`emitCaseEvent` primitives to resume, mirroring the existing buyer-accept/reject-resumes-from-`negotiating` pattern but on the supplier side. No schema or code change needed for this one — documenting it (in the notes file below) so the next plan doesn't reinvent it or assume a gap that isn't real.

### 5. Terminology collision: B2C's "Negotiation" step vs. the existing `negotiating` `CaseStatus`

- **Documentation decision, not a code change**: the existing `negotiating` status means specifically "buyer-facing counteroffer sent, awaiting buyer response" and its only legal transitions are `negotiating → evaluating | cannot_commit` (`04-DATA-AND-STATE-SPEC.md:160`) — no path to `prepared`. A future B2C workflow's supplier-negotiation step must stay inside `evaluating` and must not reuse the `negotiating` status/name for it. Recorded in the notes file so this doesn't get silently violated later.

### 6. Per-order buy price (was: static global `SKU_UNIT_COST_MINOR` lookup table)

- Add nullable `confirmedBuyPriceMinor Int?` to `TermsVersion` — per-unit buy price, captured once supplier negotiation concludes (parallel semantics to the existing `unitCostMinor` parameter of `calculateDealEconomics`). Null until negotiation completes; never populated by any existing B2B code path.

### 7. Supplier data freshness (was: no freshness/tier concept anywhere in `SupplierOption`)

- Add nullable `freshnessTier String?` (expected values `"tier1" | "tier2" | "tier3"`, stored as a plain string like other enum-shaped columns in this schema, validated at the application layer the same way `PaymentTerms`/`RoleId` are — no new DB-level enum type, consistent with existing convention) and `lastVerifiedAt DateTime?` to `SupplierOption`.

---

## Non-goals (explicitly out of scope for this pass)

- No intake/check/negotiation-brief/margin-engine agents.
- No WhatsApp, email-intake, or Razorpay integration.
- No actual B2C workflow file (the equivalent of `dealSubmitted.ts` for B2C cases).
- No changes to any existing B2B behavior, test, or fixture.

## Files touched

- `app/prisma/schema.prisma` — `MarketplaceBuyer` model, 3 nullable columns (`TermsVersion.advanceBps`, `TermsVersion.confirmedBuyPriceMinor`, `SupplierOption.freshnessTier`, `SupplierOption.lastVerifiedAt`).
- `app/prisma/migrations/<timestamp>_b2c_foundation/migration.sql` — generated by `prisma migrate dev`.
- `app/src/lib/types.ts` — add `"ADVANCE_VARIABLE"` to `PaymentTermsSchema`.
- `app/src/workflow/dealSubmitted.ts` — add `B2C_REQUIRED_DOMAINS` constant (unused for now).
- `Project Scope/build-specs/09-B2C-FOUNDATION-NOTES.md` (new) — records decisions #4 and #5 (the two non-code findings) so a future B2C workflow plan starts from them instead of re-deriving or violating them.

## Self-review

- **Placeholder scan**: none — every decision above states the exact field name, type, and nullability.
- **Type consistency**: `ReservationDomain` and `PaymentTerms` types are extended, not redefined; existing values/behavior untouched.
- **Spec coverage**: all 7 items from the validation review are addressed (5 as schema/code changes, 2 as documented findings that require no code).
