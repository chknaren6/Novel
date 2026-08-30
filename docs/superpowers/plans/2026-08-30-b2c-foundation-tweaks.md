# B2C Foundation Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing B2B CommitOS schema/workflow capable of hosting a B2C marketplace case, per `docs/superpowers/specs/2026-08-30-b2c-foundation-tweaks-design.md`, without changing any existing B2B behavior.

**Architecture:** Purely additive Prisma schema changes (new nullable columns, one new table), one new Zod enum value, one new unused-for-now constant, and one documentation file. No new agents, no new workflow, no integrations.

**Tech Stack:** Prisma 5.18 / SQLite, Zod, Vitest, TypeScript. Working directory for every command below: `/Users/eidoviscontact/Novel/Novel/.worktrees/b2c-foundation-tweaks/app`.

---

### Task 1: `ADVANCE_VARIABLE` payment term

**Files:**
- Modify: `src/lib/types.ts:75`
- Test: `src/lib/types.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/types.test.ts` (new `describe` block, alongside the existing ones):

```typescript
import { PaymentTermsSchema } from "./types";
```

(add `PaymentTermsSchema` to the existing import line from `"./types"` rather than a new import statement)

```typescript
describe("PaymentTermsSchema", () => {
  it("accepts the existing B2B terms plus the new B2C variable-advance term", () => {
    for (const term of ["NET_60", "ADVANCE_30", "OTHER_BOUNDED", "ADVANCE_VARIABLE"]) {
      expect(PaymentTermsSchema.parse(term)).toBe(term);
    }
    expect(() => PaymentTermsSchema.parse("NET_90")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types.test.ts`
Expected: FAIL — `ADVANCE_VARIABLE` is not a valid enum value yet.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, change line 75 from:

```typescript
export const PaymentTermsSchema = z.enum(["NET_60", "ADVANCE_30", "OTHER_BOUNDED"]);
```

to:

```typescript
// ADVANCE_VARIABLE is B2C-only: the advance percentage is negotiated per order
// (see TermsVersion.advanceBps), not fixed like the B2B ADVANCE_30 counterterm.
export const PaymentTermsSchema = z.enum(["NET_60", "ADVANCE_30", "OTHER_BOUNDED", "ADVANCE_VARIABLE"]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/types.test.ts
git commit -m "feat: add ADVANCE_VARIABLE payment term for B2C"
```

---

### Task 2: Schema additions — `MarketplaceBuyer`, `TermsVersion.advanceBps`/`confirmedBuyPriceMinor`, `SupplierOption.freshnessTier`/`lastVerifiedAt`

Schema changes must exist before Prisma Client generates the types a test would import, so this task is schema-first rather than strict red-green — write the schema, migrate, generate, then write and pass the verifying test in one pass. This mirrors how every other schema task in this codebase's own history was done (see `git log --oneline -- prisma/schema.prisma`).

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_b2c_foundation/migration.sql` (generated, not hand-written)
- Test: `src/fixtures/b2cFoundation.test.ts`

- [ ] **Step 1: Add the new model and columns**

In `prisma/schema.prisma`, add a new model (place it near `Customer`):

```prisma
// A B2C buyer's identity. Deliberately separate from Customer, which is entirely
// trade-credit shaped (creditLimitMinor, currentExposureMinor, allowedPaymentTerms) —
// none of that applies to a B2C buyer, who always pays advance/full upfront and is
// never extended credit (commitos-b2c-product-spec.md §9).
model MarketplaceBuyer {
  id        String   @id @default(uuid())
  name      String
  phone     String
  email     String?
  createdAt DateTime @default(now())
}
```

In the `TermsVersion` model, add two nullable fields (after `paymentTerms`):

```prisma
  // B2C only. Meaningful only when paymentTerms == "ADVANCE_VARIABLE"; null for every
  // B2B row and every non-advance B2C row.
  advanceBps             Int?
  // B2C only. The buy price negotiated with the supplier for this specific order —
  // B2C has no fixed per-SKU cost table (unlike SKU_UNIT_COST_MINOR), because buy
  // price is discovered live per order, not looked up from a catalog. Null until
  // supplier negotiation concludes.
  confirmedBuyPriceMinor Int?
```

In the `SupplierOption` model, add two nullable fields (after `status`):

```prisma
  // B2C only. Data-freshness tier per commitos-b2c-product-spec.md §6 ("tier1" =
  // real-time webhook, "tier2" = 15-30min polling, "tier3" = daily snapshot).
  // Validated at the application layer, not a DB-level enum — consistent with how
  // PaymentTerms/RoleId are handled elsewhere in this schema.
  freshnessTier  String?
  lastVerifiedAt DateTime?
```

- [ ] **Step 2: Generate and apply the migration**

```bash
export DATABASE_URL="file:./dev.db"
npx prisma migrate dev --name b2c_foundation
```

Expected: a new folder under `prisma/migrations/` is created and applied; command exits 0.

- [ ] **Step 3: Apply the same migration to `test.db`**

```bash
export DATABASE_URL="file:./test.db"
npx prisma migrate deploy
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 4: Write the verifying test**

Create `src/fixtures/b2cFoundation.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";

describe("B2C foundation schema additions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a MarketplaceBuyer independent of Customer/Company", async () => {
    const buyer = await testDb.marketplaceBuyer.create({
      data: { name: "Ramesh Traders", phone: "+91-90000-00000" },
    });
    expect(buyer.id).toBeTruthy();
    expect(buyer.email).toBeNull();
  });

  it("lets a DealCase.customerId point at a MarketplaceBuyer id with no FK conflict", async () => {
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: buyer.id, activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });
    expect(dealCase.customerId).toBe(buyer.id);
  });

  it("stores advanceBps and confirmedBuyPriceMinor on TermsVersion, nullable by default", async () => {
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: buyer.id, activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });
    const withoutAdvance = await testDb.termsVersion.create({
      data: {
        caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1",
        sku: "SKU-1", quantity: 1, totalValueMinor: 100_00, discountBps: 0,
        paymentTerms: "NET_60", deliveryDeadline: new Date(),
      },
    });
    expect(withoutAdvance.advanceBps).toBeNull();
    expect(withoutAdvance.confirmedBuyPriceMinor).toBeNull();

    const withAdvance = await testDb.termsVersion.create({
      data: {
        caseId: dealCase.id, version: 2, source: "buyer_request", termsHash: "hash-2",
        sku: "SKU-1", quantity: 1, totalValueMinor: 100_00, discountBps: 0,
        paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: new Date(),
        advanceBps: 7000, confirmedBuyPriceMinor: 85_00,
      },
    });
    expect(withAdvance.advanceBps).toBe(7000);
    expect(withAdvance.confirmedBuyPriceMinor).toBe(85_00);
  });

  it("stores freshnessTier and lastVerifiedAt on SupplierOption, nullable by default", async () => {
    const withoutFreshness = await testDb.supplierOption.create({
      data: { supplierId: "VEND-1", sku: "SKU-1", availableQuantity: 10, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available" },
    });
    expect(withoutFreshness.freshnessTier).toBeNull();

    const withFreshness = await testDb.supplierOption.create({
      data: {
        supplierId: "VEND-2", sku: "SKU-1", availableQuantity: 10, unitCostMinor: 100, leadDays: 5,
        optionTtlSeconds: 900, status: "available", freshnessTier: "tier2", lastVerifiedAt: new Date(),
      },
    });
    expect(withFreshness.freshnessTier).toBe("tier2");
    expect(withFreshness.lastVerifiedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm test -- b2cFoundation.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full existing suite to confirm nothing B2B broke**

Run: `npm test`
Expected: all 28 pre-existing files plus this new one pass — 148 + 4 = 152 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/fixtures/b2cFoundation.test.ts
git commit -m "feat: B2C foundation schema — MarketplaceBuyer, advance/buy-price and supplier freshness columns"
```

---

### Task 3: `B2C_REQUIRED_DOMAINS` constant

**Files:**
- Modify: `src/workflow/dealSubmitted.ts`
- Test: `src/workflow/dealSubmitted.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/workflow/dealSubmitted.test.ts` (new `describe` block; add `B2C_REQUIRED_DOMAINS` to the existing import from `"./dealSubmitted"`):

```typescript
describe("B2C_REQUIRED_DOMAINS", () => {
  it("is exactly ['supplier'] — B2C never extends credit and doesn't hold its own inventory", () => {
    expect(B2C_REQUIRED_DOMAINS).toEqual(["supplier"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dealSubmitted.test.ts`
Expected: FAIL — `B2C_REQUIRED_DOMAINS` is not exported yet.

- [ ] **Step 3: Implement**

In `src/workflow/dealSubmitted.ts`, next to the existing `REQUIRED_BASE_DOMAINS` constant, add:

```typescript
// B2C's required-domain set is deliberately different from B2B's REQUIRED_BASE_DOMAINS
// above: B2C never extends credit (commitos-b2c-product-spec.md §9, "does not extend
// credit to buyers") and doesn't hold its own inventory (it brokers a supplier order,
// it doesn't stock goods) — so "credit" and "inventory" never apply. Only "supplier"
// (the confirmed purchase order) is required; "logistics" is added by the future B2C
// workflow only when CommitOS books third-party freight itself, mirroring how
// REQUIRED_BASE_DOMAINS above conditionally adds "supplier" on a shortfall. Not yet
// consumed by any workflow — that's the next plan (the actual B2C evaluate/route flow).
export const B2C_REQUIRED_DOMAINS: ReservationDomain[] = ["supplier"];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dealSubmitted.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/dealSubmitted.ts src/workflow/dealSubmitted.test.ts
git commit -m "feat: add B2C_REQUIRED_DOMAINS constant (unused until the B2C workflow exists)"
```

---

### Task 4: Record the two non-code findings

**Files:**
- Create: `Project Scope/build-specs/09-B2C-FOUNDATION-NOTES.md`

- [ ] **Step 1: Write the file**

```markdown
# B2C Foundation Notes

Two findings from validating `commitos-b2c-product-spec.md` against the existing
B2B architecture that required no schema or code change, but do need to be honored
by whichever plan builds the actual B2C workflow next.

## 1. The async human-negotiation pause point already exists as a pattern

`evaluateAndRoute` (B2B) runs all six roles synchronously start-to-finish with no
pause point. B2C's Step 3 ("The AI does not negotiate autonomously in Phase 1" — a
human negotiator must act, which can take hours or days) needs a workflow that can
sit indefinitely and resume later.

That pattern already exists: `transitionCase` (`src/state/transitions.ts`) and
`emitCaseEvent` are domain-agnostic — they don't assume the B2B six-role fanout. The
existing buyer-accept/reject flow (resumes from `negotiating` after an arbitrary-delay
human action) is the model to mirror for B2C's supplier-side negotiation — but on the
supplier side, which has no equivalent code yet. No schema change needed; the primitive
is already generic. The next plan should reuse `transitionCase`/`emitCaseEvent`
directly rather than inventing new state-transition machinery.

## 2. B2C's "Negotiation" step must not reuse the `negotiating` CaseStatus

The existing `negotiating` status means specifically "buyer-facing counteroffer sent,
awaiting buyer response," with only `negotiating → evaluating | cannot_commit` as legal
transitions (`04-DATA-AND-STATE-SPEC.md`) — no path to `prepared`. B2C's own spec calls
its supplier-negotiation step "Negotiation" (§3), but that step happens *before* a buyer
quote exists and must lead into `prepared`, which the current `negotiating` status
cannot do without breaking the documented transition table.

**Decision:** B2C's supplier-negotiation step stays inside the `evaluating` status.
Do not introduce a case transition out of `negotiating` into `prepared`, and do not
name any B2C case-status value "negotiating" — pick a different name (e.g. `sourcing`)
only if a distinct, observable status is later found to be worth the transition-table
change; until then, no new status is needed at all.
```

- [ ] **Step 2: Commit**

```bash
git add "Project Scope/build-specs/09-B2C-FOUNDATION-NOTES.md"
git commit -m "docs: record B2C foundation findings on async negotiation and status naming"
```

---

### Task 5: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: every test file passes — 29 files (28 original + 1 new), 152 tests (148 original + 4 new), 0 failures.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Confirm migrations are reproducible from a clean database**

```bash
rm -f prisma/dev-verify.db
DATABASE_URL="file:./dev-verify.db" npx prisma migrate deploy
rm -f prisma/dev-verify.db prisma/dev-verify.db-journal
```

Expected: `All migrations have been successfully applied.` with no manual intervention.

- [ ] **Step 5: Confirm no existing B2B fixture/test changed behavior**

```bash
git diff --stat main -- src/fixtures src/workflow/dealSubmitted.ts src/workflow/commit.ts src/reservations
```

Expected: only the additive changes from Tasks 1–3 above (new constant, new import in dealSubmitted.test.ts) — no line inside existing B2B decision/routing logic is touched.

---

## Self-review notes

- **Spec coverage:** all 7 items from `2026-08-30-b2c-foundation-tweaks-design.md` are covered — 5 as code/schema tasks (1, 2, 3, 6, 7 from the design doc, folded into Tasks 1–3 above since several share files), 2 as the documentation-only Task 4 (design doc items 4 and 5).
- **Placeholder scan:** no TBD/TODO; every step has complete code, exact commands, and expected output.
- **Type consistency:** `MarketplaceBuyer`, `advanceBps`, `confirmedBuyPriceMinor`, `freshnessTier`, `lastVerifiedAt`, `B2C_REQUIRED_DOMAINS`, `ADVANCE_VARIABLE` are each defined exactly once and referenced with matching names throughout.
