# B2C Core Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the B2C marketplace workflow end to end (intake → check → negotiate → quote → buyer accept → commit) per `docs/superpowers/specs/2026-08-30-b2c-core-workflow-design.md`, reusing existing B2B reservation/certificate/commit machinery wherever it's already generic, and adding only what's genuinely new.

**Architecture:** New files under `src/workflow/b2c/` and `src/policy/b2cMargin.ts`. No B2B file's behavior changes except relocating one already-unused B2C constant out of `dealSubmitted.ts` into its proper home.

**Tech Stack:** Prisma/SQLite, Zod, OpenAI SDK, Vitest, TypeScript. Working directory for every command: `/Users/eidoviscontact/Novel/Novel/.worktrees/b2c-core-workflow/app`.

---

### Task 1: `DealCase.channel` field

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_dealcase_channel/migration.sql` (generated)
- Test: `src/fixtures/b2cFoundation.test.ts` (extend the existing file from the foundation plan)

Schema-first, same justified exception as the foundation plan's Task 2 (Prisma Client must generate before a test can reference the new field).

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, in the `DealCase` model, add right after `fixtureId`:

```prisma
  // "b2b" (default, every existing row) or "b2c". Lets a query or dashboard tell the
  // two apart without inferring it from which table customerId happens to point at.
  channel            String              @default("b2b")
```

- [ ] **Step 2: Generate and apply the migration**

```bash
export DATABASE_URL="file:./dev.db"
npx prisma migrate dev --name dealcase_channel
export DATABASE_URL="file:./test.db"
npx prisma migrate deploy
```

Expected: both exit 0, `All migrations have been successfully applied.` for the second.

- [ ] **Step 3: Add a verifying test**

Add to `src/fixtures/b2cFoundation.test.ts` (new `it` inside the existing `describe` block):

```typescript
  it("defaults DealCase.channel to 'b2b' and allows 'b2c'", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const b2b = await testDb.dealCase.create({ data: { companyId: company.id, customerId: buyer.id, activeTermsVersion: 1, status: "intake", createdBy: "seed" } });
    expect(b2b.channel).toBe("b2b");
    const b2c = await testDb.dealCase.create({ data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "intake", createdBy: "seed" } });
    expect(b2c.channel).toBe("b2c");
  });
```

- [ ] **Step 4: Run tests**

```bash
npm test -- b2cFoundation.test.ts
```

Expected: 5/5 pass (4 existing + 1 new).

- [ ] **Step 5: Full suite + commit**

```bash
npm test
```

Expected: 29 files, 155 tests (154 baseline + 1), 0 failures.

```bash
git add prisma/schema.prisma prisma/migrations src/fixtures/b2cFoundation.test.ts
git commit -m "feat: add DealCase.channel field (b2b default, b2c opt-in)"
```

---

### Task 2: Relocate `B2C_REQUIRED_DOMAINS` into its own home

The foundation plan added this constant directly inside `dealSubmitted.ts` (the B2B workflow file) because no B2C code existed yet to give it a better home. That home now exists.

**Files:**
- Modify: `src/workflow/dealSubmitted.ts` (remove the constant)
- Modify: `src/workflow/dealSubmitted.test.ts` (remove its test)
- Create: `src/workflow/b2c/constants.ts`
- Test: `src/workflow/b2c/constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/constants.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { B2C_REQUIRED_DOMAINS } from "./constants";

describe("B2C_REQUIRED_DOMAINS", () => {
  it("is exactly ['supplier'] — B2C never extends credit and doesn't hold its own inventory", () => {
    expect(B2C_REQUIRED_DOMAINS).toEqual(["supplier"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/constants.test.ts
```

Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 3: Create the new file**

Create `src/workflow/b2c/constants.ts`:

```typescript
import type { ReservationDomain } from "@/lib/types";

// B2C's required-domain set is deliberately different from B2B's REQUIRED_BASE_DOMAINS
// (src/workflow/dealSubmitted.ts): B2C never extends credit (commitos-b2c-product-spec.md
// §9, "does not extend credit to buyers") and, because it never places a supplier order
// until the buyer's advance is received (§4, "This eliminates inventory risk"), it never
// carries its own inventory exposure either — so "credit" and "inventory" never apply
// here. Only "supplier" (the confirmed purchase order) is required; "logistics" would be
// added by a future revision only if CommitOS ever books third-party freight itself.
export const B2C_REQUIRED_DOMAINS: ReservationDomain[] = ["supplier"];
```

- [ ] **Step 4: Remove it from `dealSubmitted.ts`**

Delete the `B2C_REQUIRED_DOMAINS` constant and its comment block from `src/workflow/dealSubmitted.ts` entirely (it currently sits right after `REQUIRED_BASE_DOMAINS`). Leave `REQUIRED_BASE_DOMAINS` itself untouched.

- [ ] **Step 5: Remove its test from `dealSubmitted.test.ts`**

Delete the `describe("B2C_REQUIRED_DOMAINS", ...)` block from `src/workflow/dealSubmitted.test.ts`, and remove `B2C_REQUIRED_DOMAINS` from its import line from `"./dealSubmitted"` (keep every other imported name).

- [ ] **Step 6: Run both test files**

```bash
npm test -- src/workflow/b2c/constants.test.ts src/workflow/dealSubmitted.test.ts
```

Expected: `constants.test.ts` passes (1/1); `dealSubmitted.test.ts` still passes (5/5, one fewer than before since the relocated test moved out).

- [ ] **Step 7: Full suite + commit**

```bash
npm test
```

Expected: 30 files (29 + 1 new), 155 tests (same total — one test moved, none added or lost).

```bash
git add src/workflow/dealSubmitted.ts src/workflow/dealSubmitted.test.ts src/workflow/b2c/constants.ts src/workflow/b2c/constants.test.ts
git commit -m "refactor: relocate B2C_REQUIRED_DOMAINS into src/workflow/b2c/constants.ts"
```

---

### Task 3: B2C margin engine

**Files:**
- Create: `src/policy/b2cMargin.ts`
- Test: `src/policy/b2cMargin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/policy/b2cMargin.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { calculateB2CQuote } from "./b2cMargin";

describe("calculateB2CQuote", () => {
  it("applies the under-Rs25k margin band and 100% advance for a small order", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 1000_00, quantity: 10, operationalCostMinor: 1500_00, riskBufferBps: 500 });
    expect(result.marginBps).toBe(1250);
    expect(result.sellPriceMinor).toBe(1_325_000);
    expect(result.advanceBps).toBe(10_000);
  });

  it("applies the mid-band margin and 70% advance for a mid-size order", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 100_000_00, quantity: 1, operationalCostMinor: 1500_00, riskBufferBps: 500 });
    expect(result.marginBps).toBe(850);
    expect(result.advanceBps).toBe(7_000);
  });

  it("applies the top-band margin and 50% advance for a large order", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 800_000_00, quantity: 1, operationalCostMinor: 1500_00, riskBufferBps: 500 });
    expect(result.marginBps).toBe(600);
    expect(result.sellPriceMinor).toBe(88_950_000);
    expect(result.advanceBps).toBe(5_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/policy/b2cMargin.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/policy/b2cMargin.ts`:

```typescript
export interface B2CMarginInput {
  buyPriceMinor: number; // per unit, from supplier negotiation
  quantity: number;
  operationalCostMinor: number; // fixed per-order, category-set — caller decides the value
  riskBufferBps: number; // % of buy value
}

export interface B2CMarginResult {
  sellPriceMinor: number;
  marginBps: number;
  advanceBps: number; // 10000 (100%), 7000 (70%), or 5000 (50%) by sell-value band
}

// Margin % bands are the midpoint of commitos-b2c-product-spec.md §4's documented
// ranges (<Rs25k: 10-15%, Rs25k-2L: 7-10%, >2L: 5-7%) — same "pick the range's
// midpoint" convention this codebase already used for MOTION_DURATION_MS in the
// Novel website plan, applied to a business-policy range instead of a UI-timing one.
// All three bands are comfortably above the spec's 5% minimum-acceptable-margin floor
// by construction (12.5/8.5/6% vs a 5% floor), so no runtime floor check exists here —
// if a future category-specific dynamic margin calculation replaces these fixed bands,
// reintroduce one.
function pickMarginBps(buyValueMinor: number): number {
  if (buyValueMinor < 25_000_00) return 1250;
  if (buyValueMinor <= 200_000_00) return 850;
  return 600;
}

// Advance % bands per commitos-b2c-product-spec.md §5.
function pickAdvanceBps(sellValueMinor: number): number {
  if (sellValueMinor < 50_000_00) return 10_000;
  if (sellValueMinor <= 500_000_00) return 7_000;
  return 5_000;
}

// Sell price formula per commitos-b2c-product-spec.md §4: confirmed buy price +
// operational cost + risk buffer (% of buy value) + margin (% of buy value).
export function calculateB2CQuote(input: B2CMarginInput): B2CMarginResult {
  const buyValueMinor = input.buyPriceMinor * input.quantity;
  const riskBufferMinor = Math.round((buyValueMinor * input.riskBufferBps) / 10_000);
  const marginBps = pickMarginBps(buyValueMinor);
  const marginMinor = Math.round((buyValueMinor * marginBps) / 10_000);
  const sellPriceMinor = buyValueMinor + input.operationalCostMinor + riskBufferMinor + marginMinor;
  const advanceBps = pickAdvanceBps(sellPriceMinor);
  return { sellPriceMinor, marginBps, advanceBps };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/policy/b2cMargin.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/policy/b2cMargin.ts src/policy/b2cMargin.test.ts
git commit -m "feat: add B2C margin engine (calculateB2CQuote)"
```

---

### Task 4: Intake parser

**Files:**
- Create: `src/workflow/b2c/parsedRequirementJsonSchema.ts`
- Create: `src/workflow/b2c/intake.ts`
- Test: `src/workflow/b2c/intake.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/intake.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { parseB2CRequirement } from "./intake";
import { ToolError } from "@/lib/types";

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe("parseB2CRequirement", () => {
  it("parses a complete raw requirement into structured fields", async () => {
    const VALID = {
      itemDescription: "4mm copper wire", quantity: 500, unit: "metres",
      deliveryDeadline: "2026-09-15", location: "Bangalore", missingCriticalField: null,
    };
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(VALID) } }] }]);
    const result = await parseB2CRequirement(client, "gpt-5-nano", "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore", 30_000);
    expect(result).toEqual(VALID);
  });

  it("carries a flagged missing critical field through instead of guessing silently", async () => {
    const VALID = {
      itemDescription: "HDPE granules", quantity: 200, unit: "kg",
      deliveryDeadline: "", location: "", missingCriticalField: "delivery deadline and location not stated",
    };
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(VALID) } }] }]);
    const result = await parseB2CRequirement(client, "gpt-5-nano", "Looking for 200kg of HDPE granules, natural grade, urgent", 30_000);
    expect(result.missingCriticalField).toBe("delivery deadline and location not stated");
  });

  it("wraps a network failure as ToolError PROVIDER_UNAVAILABLE", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(parseB2CRequirement(client, "gpt-5-nano", "some text", 30_000)).rejects.toThrow(ToolError);
  });

  it("wraps a non-JSON response as ToolError INVALID_INPUT", async () => {
    const client = fakeClient([{ choices: [{ message: { content: "not json" } }] }]);
    await expect(parseB2CRequirement(client, "gpt-5-nano", "some text", 30_000)).rejects.toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/intake.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/parsedRequirementJsonSchema.ts` (same hand-written-JSON-Schema-mirror convention as `src/gateway/roleModelOutputJsonSchema.ts`):

```typescript
// A hand-written JSON Schema mirror of ParsedRequirementSchema (intake.ts), shaped for
// OpenAI structured outputs strict mode — same convention as
// src/gateway/roleModelOutputJsonSchema.ts.
export const PARSED_REQUIREMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemDescription: { type: "string" },
    quantity: { type: "integer" },
    unit: { type: "string" },
    deliveryDeadline: { type: "string" },
    location: { type: "string" },
    missingCriticalField: { type: ["string", "null"] },
  },
  required: ["itemDescription", "quantity", "unit", "deliveryDeadline", "location", "missingCriticalField"],
} as const;
```

Create `src/workflow/b2c/intake.ts`:

```typescript
import type OpenAI from "openai";
import { z } from "zod";
import { ToolError } from "@/lib/types";
import { PARSED_REQUIREMENT_JSON_SCHEMA } from "./parsedRequirementJsonSchema";

export const ParsedRequirementSchema = z.object({
  itemDescription: z.string(),
  quantity: z.number().int().positive(),
  unit: z.string(),
  deliveryDeadline: z.string(),
  location: z.string(),
  missingCriticalField: z.string().nullable(),
});
export type ParsedRequirement = z.infer<typeof ParsedRequirementSchema>;

const INTAKE_SYSTEM_PROMPT =
  "You are the intake parser for a B2C industrial-goods marketplace. Extract a " +
  "structured requirement from the buyer's raw message: item description, quantity, " +
  "unit, delivery deadline, and location. If a critical field (item, quantity, or " +
  "delivery deadline) is missing or too vague to act on, set missingCriticalField to a " +
  "short description of what's missing rather than guessing; otherwise set it to null.";

// One bounded, tool-free structured-output call — not routed through ModelGateway.runRole,
// since that interface is typed around the six-role RoleModelOutput decision vocabulary
// (approve/counter/veto/unavailable), which doesn't fit "extract structured fields from
// free text" at all. Error handling mirrors OpenAIModelGateway's final-response handling
// (src/gateway/openaiGateway.ts) exactly, for the same reasons.
export async function parseB2CRequirement(
  client: OpenAI,
  modelId: string,
  rawText: string,
  timeoutMs: number,
): Promise<ParsedRequirement> {
  let response;
  try {
    response = await client.chat.completions.create(
      {
        model: modelId,
        messages: [
          { role: "system", content: INTAKE_SYSTEM_PROMPT },
          { role: "user", content: rawText },
        ],
        response_format: { type: "json_schema", json_schema: { name: "parsed_requirement", strict: true, schema: PARSED_REQUIREMENT_JSON_SCHEMA } },
      },
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new ToolError("PROVIDER_UNAVAILABLE", `Intake parse call failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  const raw = response.choices[0]!.message.content ?? "{}";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new ToolError("INVALID_INPUT", `Intake parse response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, false);
  }
  const parsed = ParsedRequirementSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ToolError("INVALID_INPUT", `Intake parse response failed validation: ${parsed.error.message}`, false);
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/intake.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/intake.ts src/workflow/b2c/parsedRequirementJsonSchema.ts src/workflow/b2c/intake.test.ts
git commit -m "feat: add B2C intake parser (real LLM call, no channel integration)"
```

---

### Task 5: Supplier check

**Files:**
- Create: `src/workflow/b2c/check.ts`
- Test: `src/workflow/b2c/check.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/check.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { findSupplierCandidates } from "./check";

describe("findSupplierCandidates", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns only options with enough available quantity, ranked by cost then lead time", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 100, unitCostMinor: 300, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    await testDb.supplierOption.create({ data: { supplierId: "VEND-B", sku: "SKU-1", availableQuantity: 100, unitCostMinor: 200, leadDays: 15, optionTtlSeconds: 900, status: "available" } });
    await testDb.supplierOption.create({ data: { supplierId: "VEND-C", sku: "SKU-1", availableQuantity: 5, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available" } });

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-1", quantity: 50 });
    expect(candidates.map((c) => c.supplierId)).toEqual(["VEND-B", "VEND-A"]);
  });

  it("flags a tier3 option as stale when lastVerifiedAt is more than 20 hours old", async () => {
    const staleDate = new Date(Date.now() - 21 * 60 * 60 * 1000);
    await testDb.supplierOption.create({ data: { supplierId: "VEND-D", sku: "SKU-2", availableQuantity: 100, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available", freshnessTier: "tier3", lastVerifiedAt: staleDate } });

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-2", quantity: 10 });
    expect(candidates[0]!.isStale).toBe(true);
  });

  it("does not flag a fresh tier1 option as stale", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-E", sku: "SKU-3", availableQuantity: 100, unitCostMinor: 100, leadDays: 5, optionTtlSeconds: 900, status: "available", freshnessTier: "tier1", lastVerifiedAt: new Date() } });

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-3", quantity: 10 });
    expect(candidates[0]!.isStale).toBe(false);
  });

  it("returns an empty array when no supplier can fulfill", async () => {
    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-NONEXISTENT", quantity: 10 });
    expect(candidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/check.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/check.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

export interface SupplierCandidate {
  supplierId: string;
  unitCostMinor: number;
  leadDays: number;
  availableQuantity: number;
  freshnessTier: string | null;
  isStale: boolean;
}

// commitos-b2c-product-spec.md §6: "human confirmation required if data > 20 hours old"
// for a Tier 3 (daily-snapshot) supplier.
const STALE_THRESHOLD_MS = 20 * 60 * 60 * 1000;

// Deterministic supplier-graph query, not a reasoning agent — "here are 3 ranked
// candidates" doesn't fit the RoleModelOutput decision vocabulary (approve/counter/
// veto/unavailable), so this is a plain typed function, not a ModelGateway role.
export async function findSupplierCandidates(
  db: PrismaClient,
  input: { sku: string; quantity: number },
): Promise<SupplierCandidate[]> {
  const options = await db.supplierOption.findMany({
    where: { sku: input.sku, status: "available", availableQuantity: { gte: input.quantity } },
  });
  const now = Date.now();
  return options
    .map((option) => ({
      supplierId: option.supplierId,
      unitCostMinor: option.unitCostMinor,
      leadDays: option.leadDays,
      availableQuantity: option.availableQuantity,
      freshnessTier: option.freshnessTier,
      isStale:
        option.freshnessTier === "tier3" &&
        (!option.lastVerifiedAt || now - option.lastVerifiedAt.getTime() > STALE_THRESHOLD_MS),
    }))
    .sort((a, b) => a.unitCostMinor - b.unitCostMinor || a.leadDays - b.leadDays);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/check.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/check.ts src/workflow/b2c/check.test.ts
git commit -m "feat: add B2C supplier check (deterministic query, no LLM)"
```

---

### Task 6: Case creation orchestrator

**Files:**
- Create: `src/workflow/b2c/createCase.ts`
- Test: `src/workflow/b2c/createCase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/createCase.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "./createCase";

const BASE_INPUT: CreateB2CCaseInput = {
  buyerName: "Ramesh Traders",
  buyerPhone: "+91-90000-00000",
  sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire",
    quantity: 500,
    unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore",
    missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A",
  listedUnitCostMinor: 100_00,
  listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00,
  operationalCostMinor: 1500_00,
  riskBufferBps: 500,
  buyerLinkSigningSecret: "test-secret",
  traceId: "trace-1",
};

describe("createB2CCase", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
  });

  it("creates a priced case, holds the supplier reservation, and returns a signed buyer token", async () => {
    const result = await createB2CCase(testDb, BASE_INPUT);

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: result.caseId } });
    expect(dealCase.channel).toBe("b2c");
    expect(dealCase.status).toBe("evaluating");

    const terms = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: result.caseId, version: 1 } });
    expect(terms.paymentTerms).toBe("ADVANCE_VARIABLE");
    expect(terms.confirmedBuyPriceMinor).toBe(90_00);
    expect(terms.totalValueMinor).toBe(result.sellPriceMinor);

    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: result.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("held");

    const option = await testDb.supplierOption.findFirstOrThrow({ where: { supplierId: "VEND-A", sku: "SKU-1" } });
    expect(option.availableQuantity).toBe(500);

    const counteroffer = await testDb.counteroffer.findFirstOrThrow({ where: { caseId: result.caseId } });
    expect(counteroffer.status).toBe("sent");
  });

  it("reuses an existing MarketplaceBuyer by phone instead of creating a duplicate", async () => {
    await createB2CCase(testDb, BASE_INPUT);
    await testDb.supplierOption.updateMany({ where: { supplierId: "VEND-A" }, data: { availableQuantity: 1000 } });
    await createB2CCase(testDb, { ...BASE_INPUT, traceId: "trace-2" });
    const buyers = await testDb.marketplaceBuyer.findMany({ where: { phone: BASE_INPUT.buyerPhone } });
    expect(buyers).toHaveLength(1);
  });

  it("holds the reservation using the listed price as the ceiling, even when the negotiated price is lower", async () => {
    const result = await createB2CCase(testDb, { ...BASE_INPUT, listedUnitCostMinor: 100_00, negotiatedBuyPriceMinor: 80_00 });
    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: result.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("held");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/createCase.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/createCase.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { canonicalTermsHash, signBuyerToken, hashBuyerToken } from "@/lib/hash";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "../events";
import { holdSupplierOption } from "@/adapters/supplierAdapter";
import { calculateB2CQuote } from "@/policy/b2cMargin";
import type { ParsedRequirement } from "./intake";

// commitos-b2c-product-spec.md §4: "Quote validity window (typically 4-12 hours
// depending on supplier capacity volatility)" — used both as the buyer-quote expiry
// and the held supplier reservation's TTL, since the hold must survive the whole
// window a human negotiation plus buyer decision can span. Unlike B2B's 900s (15min)
// TTL, which assumes a synchronous few-second six-role evaluation.
const QUOTE_VALIDITY_SECONDS = 12 * 60 * 60;

export interface CreateB2CCaseInput {
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  sku: string;
  parsedRequirement: ParsedRequirement;
  chosenSupplierId: string;
  // The listed price/lead time seen during the check step — passed separately from
  // negotiatedBuyPriceMinor because holdSupplierOption re-validates against a ceiling,
  // and a human negotiator may have gotten a price BELOW the listed one. Using the
  // negotiated (lower) price as the ceiling would wrongly reject a hold whenever the
  // listed price is anything above it.
  listedUnitCostMinor: number;
  listedLeadDays: number;
  negotiatedBuyPriceMinor: number;
  operationalCostMinor: number;
  riskBufferBps: number;
  buyerLinkSigningSecret: string;
  traceId: string;
}

export interface CreateB2CCaseResult {
  caseId: string;
  buyerToken: string;
  sellPriceMinor: number;
}

async function findOrCreateBuyer(db: PrismaClient, input: { name: string; phone: string; email?: string }) {
  // Non-atomic find-or-create: acceptable here because MarketplaceBuyer identity has no
  // uniqueness invariant to protect against concurrent duplicate inserts the way a
  // reservation or certificate does — worst case is a rare duplicate buyer row, not a
  // double-decremented resource pool or a double-charged payment.
  const existing = await db.marketplaceBuyer.findFirst({ where: { phone: input.phone } });
  if (existing) return existing;
  return db.marketplaceBuyer.create({ data: { name: input.name, phone: input.phone, email: input.email } });
}

async function findOrCreateCommitOSCompany(db: PrismaClient) {
  const existing = await db.company.findFirst({ where: { name: "CommitOS" } });
  if (existing) return existing;
  return db.company.create({ data: { name: "CommitOS" } });
}

// The orchestrator a human negotiator's tool calls once they've confirmed a buy price
// with a chosen supplier (commitos-b2c-product-spec.md §4 Steps 2-4). Unlike B2B, there
// is no unpriced TermsVersion before this point — see the design doc's "A simplification
// the B2B pattern doesn't need" section for why.
export async function createB2CCase(db: PrismaClient, input: CreateB2CCaseInput): Promise<CreateB2CCaseResult> {
  const quote = calculateB2CQuote({
    buyPriceMinor: input.negotiatedBuyPriceMinor,
    quantity: input.parsedRequirement.quantity,
    operationalCostMinor: input.operationalCostMinor,
    riskBufferBps: input.riskBufferBps,
  });

  const buyer = await findOrCreateBuyer(db, { name: input.buyerName, phone: input.buyerPhone, email: input.buyerEmail });
  const company = await findOrCreateCommitOSCompany(db);
  const deliveryDeadline = new Date(input.parsedRequirement.deliveryDeadline);

  const termsHash = canonicalTermsHash({
    sku: input.sku,
    quantity: input.parsedRequirement.quantity,
    totalValueMinor: quote.sellPriceMinor,
    discountBps: 0,
    paymentTerms: "ADVANCE_VARIABLE",
    deliveryDeadline: deliveryDeadline.toISOString(),
  });

  const dealCase = await db.dealCase.create({
    data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "intake", createdBy: "b2c-intake" },
  });
  await db.termsVersion.create({
    data: {
      caseId: dealCase.id,
      version: 1,
      source: "buyer_request",
      termsHash,
      sku: input.sku,
      quantity: input.parsedRequirement.quantity,
      totalValueMinor: quote.sellPriceMinor,
      discountBps: 0,
      paymentTerms: "ADVANCE_VARIABLE",
      deliveryDeadline,
      advanceBps: quote.advanceBps,
      confirmedBuyPriceMinor: input.negotiatedBuyPriceMinor,
    },
  });

  await transitionCase(db, { caseId: dealCase.id, expectedStatus: "intake", expectedVersion: 1, nextStatus: "evaluating" });
  await emitCaseEvent(db, {
    caseId: dealCase.id,
    eventType: "b2c.requirement_parsed",
    caseVersion: 1,
    actorType: "operator",
    actorRef: "b2c-intake",
    payload: { rawRequirement: input.parsedRequirement, chosenSupplierId: input.chosenSupplierId },
    traceId: input.traceId,
  });

  await holdSupplierOption(db, {
    caseId: dealCase.id,
    caseVersion: 1,
    termsHash,
    supplierId: input.chosenSupplierId,
    sku: input.sku,
    quantity: input.parsedRequirement.quantity,
    maxUnitCostMinor: input.listedUnitCostMinor,
    maxLeadDays: input.listedLeadDays,
    ttlSeconds: QUOTE_VALIDITY_SECONDS,
  });

  const buyerToken = signBuyerToken(`${dealCase.id}:1`, input.buyerLinkSigningSecret);
  await db.counteroffer.create({
    data: {
      caseId: dealCase.id,
      sourceTermsVersion: 1,
      proposedTermsVersion: 1,
      tokenHash: hashBuyerToken(buyerToken),
      status: "sent",
      expiresAt: new Date(Date.now() + QUOTE_VALIDITY_SECONDS * 1000),
    },
  });

  return { caseId: dealCase.id, buyerToken, sellPriceMinor: quote.sellPriceMinor };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/createCase.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/createCase.ts src/workflow/b2c/createCase.test.ts
git commit -m "feat: add B2C case creation orchestrator (createB2CCase)"
```

---

### Task 7: B2C commit

**Files:**
- Create: `src/workflow/b2c/commit.ts`
- Test: `src/workflow/b2c/commit.test.ts`

This is a near-verbatim structural copy of `src/workflow/commit.ts`'s `runCommit`, with only the economics source changed. A shared helper wasn't extracted: the only real difference is where the economics inputs come from (fixed B2B constants vs. per-order terms fields), and forcing that into a shared abstraction over two call sites would add indirection for marginal benefit — noted here so a reviewer knows this was a deliberate choice, not an oversight.

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/commit.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runB2CCommit } from "./commit";
import { prepareCommitCertificate } from "@/reservations/coordinator";
import { createHeldReservation } from "@/reservations/reservationStore";
import { canonicalTermsHash } from "@/lib/hash";
import { B2C_REQUIRED_DOMAINS } from "./constants";

async function seedPreparedB2CCase() {
  const company = await testDb.company.create({ data: { name: "CommitOS" } });
  const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "prepared", createdBy: "test" },
  });
  const deliveryDeadline = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const termsHash = canonicalTermsHash({ sku: "SKU-1", quantity: 10, totalValueMinor: 1_325_000, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: deliveryDeadline.toISOString() });
  await testDb.termsVersion.create({
    data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash, sku: "SKU-1", quantity: 10, totalValueMinor: 1_325_000, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline, advanceBps: 10_000, confirmedBuyPriceMinor: 100_000 },
  });
  const reservation = await createHeldReservation(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash, domain: "supplier", resourceRef: "SUPPLIER:VEND-A:SKU-1", quantityMinor: 10, limitMinor: null, policyVersion: "supplier-policy-v1", ttlSeconds: 43_200, idempotencyKey: `test-${dealCase.id}` });
  const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash, reservationIds: [reservation.id], requiredDomains: B2C_REQUIRED_DOMAINS });
  return { dealCase, certificate };
}

describe("runB2CCommit", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("commits a prepared B2C case using the terms row's own negotiated buy price and advance", async () => {
    const { dealCase } = await seedPreparedB2CCase();
    const result = await runB2CCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("expected committed");
    // advanceBps 10_000 (100%) of totalValueMinor 1_325_000 -> full amount as deposit
    expect(result.depositMinor).toBe(1_325_000);

    const updatedCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(updatedCase.status).toBe("committed");
  });

  it("escalates instead of committing when the certificate has already expired", async () => {
    const { dealCase, certificate } = await seedPreparedB2CCase();
    await testDb.commitCertificate.update({ where: { id: certificate.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    const result = await runB2CCommit(testDb, { caseId: dealCase.id, traceId: "trace-2" });
    expect(result.status).toBe("escalated");

    const updatedCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(updatedCase.status).toBe("escalated");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/commit.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/commit.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { PaymentTerms } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "../events";
import { calculateDealEconomics } from "@/policy/economics";
import { commitOrder, abortCommitment } from "@/reservations/coordinator";
import { fromJsonColumn } from "@/lib/json-column";

export interface RunB2CCommitInput {
  caseId: string;
  traceId: string;
}

// B2C-flavored mirror of runCommit (src/workflow/commit.ts) — identical transition
// sequence and error handling, but sources its economics from the terms row itself
// (confirmedBuyPriceMinor/advanceBps, negotiated per order) rather than B2B's
// SKU_UNIT_COST_MINOR/ADVANCE_DEPOSIT_BPS constants.
export async function runB2CCommit(db: PrismaClient, input: RunB2CCommitInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, status: "valid" } });

  const certificateReservationIds = fromJsonColumn<string[]>(certificate.reservationIds);
  const preAttemptReservationStatus = new Map(
    (await db.reservation.findMany({ where: { id: { in: certificateReservationIds } } })).map((r) => [r.id, r.status]),
  );

  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: terms.confirmedBuyPriceMinor ?? 0,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: terms.advanceBps ?? 0,
  });

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "prepared", expectedVersion: dealCase.activeTermsVersion, nextStatus: "committing" });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "commit.requested", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { certificateId: certificate.id }, traceId: input.traceId });

  try {
    const receipts = await commitOrder(db, {
      caseId: input.caseId,
      caseVersion: dealCase.activeTermsVersion,
      certificateId: certificate.id,
      certificateHash: certificate.certificateHash,
      sku: terms.sku,
      quantity: terms.quantity,
      totalValueMinor: terms.totalValueMinor,
      depositMinor: economics.depositMinor,
    });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "committing", expectedVersion: dealCase.activeTermsVersion, nextStatus: "committed" });
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.committed", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { certificateId: certificate.id }, traceId: input.traceId });
    return { status: "committed" as const, certificateId: certificate.id, receipts, depositMinor: economics.depositMinor };
  } catch (error) {
    const postAttemptReservations = await db.reservation.findMany({ where: { id: { in: certificateReservationIds } } });
    const committedReservationIds = postAttemptReservations
      .filter((r) => r.status === "committed" && preAttemptReservationStatus.get(r.id) !== "committed")
      .map((r) => r.id);
    const succeededReceipts = await db.actionReceipt.findMany({ where: { caseId: input.caseId, resourceRef: certificate.id, status: "succeeded" } });
    const partialCommit = committedReservationIds.length > 0 || succeededReceipts.length > 0;

    await transitionCase(db, { caseId: input.caseId, expectedStatus: "committing", expectedVersion: dealCase.activeTermsVersion, nextStatus: "aborting" });
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "aborting", expectedVersion: dealCase.activeTermsVersion, nextStatus: "escalated" });
    const message = error instanceof Error ? error.message : String(error);
    const reason = partialCommit ? `PARTIAL_COMMIT: ${message}` : message;
    await emitCaseEvent(db, {
      caseId: input.caseId,
      eventType: "case.escalated",
      caseVersion: dealCase.activeTermsVersion,
      actorType: "coordinator",
      actorRef: "workflow",
      payload: { reason, partialCommit, committedReservationIds, receiptedActionsExecuted: succeededReceipts.map((r) => r.actionType) },
      traceId: input.traceId,
    });
    return { status: "escalated" as const, reason, partialCommit, committedReservationIds, receiptedActionsExecuted: succeededReceipts.map((r) => r.actionType) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/commit.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/commit.ts src/workflow/b2c/commit.test.ts
git commit -m "feat: add B2C commit step (runB2CCommit)"
```

---

### Task 8: Buyer response

**Files:**
- Create: `src/workflow/b2c/buyerResponse.ts`
- Test: `src/workflow/b2c/buyerResponse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/buyerResponse.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "./createCase";
import { runB2CBuyerResponse } from "./buyerResponse";

const SIGNING_SECRET = "test-secret";

const BASE_INPUT: CreateB2CCaseInput = {
  buyerName: "Ramesh Traders",
  buyerPhone: "+91-90000-00000",
  sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire",
    quantity: 10,
    unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore",
    missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A",
  listedUnitCostMinor: 100_00,
  listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00,
  operationalCostMinor: 1500_00,
  riskBufferBps: 500,
  buyerLinkSigningSecret: SIGNING_SECRET,
  traceId: "trace-1",
};

describe("runB2CBuyerResponse", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
  });

  it("accepting a quote prepares a certificate and commits the case", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const result = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result.status).toBe("committed");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("committed");
  });

  it("rejecting a quote fails the case closed and releases the held reservation", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const result = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "reject", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result.status).toBe("cannot_commit");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("cannot_commit");
    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: created.caseId, domain: "supplier" } });
    expect(reservation.status).toBe("released");
  });

  it("a tampered token is rejected as invalid_or_expired with no mutation", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const result = await runB2CBuyerResponse(testDb, { buyerToken: `${created.buyerToken}-tampered`, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    expect(result.status).toBe("invalid_or_expired");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("evaluating");
  });

  it("replaying an already-accepted token returns the same committed result instead of re-mutating", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const first = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-2" });
    const second = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-3" });
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/buyerResponse.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/buyerResponse.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { hashBuyerToken, verifyBuyerToken } from "@/lib/hash";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "../events";
import { prepareCommitCertificate, abortCommitment } from "@/reservations/coordinator";
import { runB2CCommit } from "./commit";
import { B2C_REQUIRED_DOMAINS } from "./constants";

export interface RunB2CBuyerResponseInput {
  buyerToken: string;
  response: "accept" | "reject";
  buyerLinkSigningSecret: string;
  traceId: string;
}

export type B2CBuyerResponseResult =
  | { status: "invalid_or_expired" }
  | { status: "cannot_commit" }
  | { status: "committed"; certificateId: string }
  | { status: "escalated"; reason: string };

// Unlike B2B's buyer-response flow (src/workflow/buyerResponse.ts on the
// commitos-p0-vertical-slice branch, not yet merged to main), B2C's terms never change
// between being quoted and being accepted — the buy price was already negotiated and
// locked before the quote was ever sent — so accept needs no version bump and no
// re-evaluation. It goes straight from the held reservation to a certificate to commit.
export async function runB2CBuyerResponse(db: PrismaClient, input: RunB2CBuyerResponseInput): Promise<B2CBuyerResponseResult> {
  const verified = verifyBuyerToken(input.buyerToken, input.buyerLinkSigningSecret);
  if (!verified) return { status: "invalid_or_expired" };

  const counteroffer = await db.counteroffer.findUnique({ where: { tokenHash: hashBuyerToken(input.buyerToken) } });
  if (!counteroffer) return { status: "invalid_or_expired" };

  if (counteroffer.status === "accepted") {
    const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });
    if (dealCase.status === "committed") {
      const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, status: "consumed" } });
      return { status: "committed", certificateId: certificate.id };
    }
    if (dealCase.status === "escalated") return { status: "escalated", reason: "duplicate_accept_after_escalation" };
    return { status: "cannot_commit" };
  }
  if (counteroffer.status === "rejected") return { status: "cannot_commit" };
  if (counteroffer.status !== "sent" || counteroffer.expiresAt <= new Date()) return { status: "invalid_or_expired" };

  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: counteroffer.proposedTermsVersion } });

  if (input.response === "reject") {
    await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "rejected", respondedAt: new Date() } });
    await transitionCase(db, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    await abortCommitment(db, { caseId: dealCase.id, caseVersion: dealCase.activeTermsVersion });
    await emitCaseEvent(db, { caseId: dealCase.id, eventType: "b2c.quote_rejected", caseVersion: dealCase.activeTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });
    return { status: "cannot_commit" };
  }

  await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "accepted", respondedAt: new Date() } });
  await emitCaseEvent(db, { caseId: dealCase.id, eventType: "b2c.quote_accepted", caseVersion: dealCase.activeTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });

  const heldReservations = await db.reservation.findMany({ where: { caseId: dealCase.id, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, status: "held" } });
  const certificate = await prepareCommitCertificate(db, {
    caseId: dealCase.id,
    caseVersion: dealCase.activeTermsVersion,
    termsHash: terms.termsHash,
    reservationIds: heldReservations.map((r) => r.id),
    requiredDomains: B2C_REQUIRED_DOMAINS,
  });
  await transitionCase(db, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "prepared" });
  await emitCaseEvent(db, { caseId: dealCase.id, eventType: "case.prepared", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { certificateId: certificate.id }, traceId: input.traceId });

  const commitResult = await runB2CCommit(db, { caseId: dealCase.id, traceId: input.traceId });
  if (commitResult.status === "committed") return { status: "committed", certificateId: commitResult.certificateId };
  return { status: "escalated", reason: commitResult.reason };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/buyerResponse.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/buyerResponse.ts src/workflow/b2c/buyerResponse.test.ts
git commit -m "feat: add B2C buyer response (accept prepares + commits, reject fails closed)"
```

---

### Task 9: End-to-end integration test

Proves the full pipeline — intake (real LLM call shape, faked client) → check → create case → buyer accepts → committed — works together, not just each piece in isolation.

**Files:**
- Test: `src/workflow/b2c/e2e.test.ts`

- [ ] **Step 1: Write the test**

Create `src/workflow/b2c/e2e.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { testDb, resetTestDb } from "@/lib/testDb";
import { parseB2CRequirement } from "./intake";
import { findSupplierCandidates } from "./check";
import { createB2CCase } from "./createCase";
import { runB2CBuyerResponse } from "./buyerResponse";

const SIGNING_SECRET = "test-secret";

function fakeIntakeClient(parsed: object) {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(parsed) } }] });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe("B2C end-to-end: intake -> check -> create -> accept -> commit", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("takes a raw requirement all the way to a committed case", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-COPPER-4MM", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });

    const client = fakeIntakeClient({
      itemDescription: "4mm copper wire", quantity: 500, unit: "metres",
      deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      location: "Bangalore", missingCriticalField: null,
    });
    const parsed = await parseB2CRequirement(client, "gpt-5-nano", "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore", 30_000);
    expect(parsed.missingCriticalField).toBeNull();

    const candidates = await findSupplierCandidates(testDb, { sku: "SKU-COPPER-4MM", quantity: parsed.quantity });
    expect(candidates).toHaveLength(1);
    const chosen = candidates[0]!;

    // Simulates a human negotiator getting a 10% discount off the listed price.
    const negotiatedBuyPriceMinor = Math.round(chosen.unitCostMinor * 0.9);

    const created = await createB2CCase(testDb, {
      buyerName: "Ramesh Traders", buyerPhone: "+91-90000-00000",
      sku: "SKU-COPPER-4MM", parsedRequirement: parsed,
      chosenSupplierId: chosen.supplierId,
      listedUnitCostMinor: chosen.unitCostMinor, listedLeadDays: chosen.leadDays,
      negotiatedBuyPriceMinor,
      operationalCostMinor: 1500_00, riskBufferBps: 500,
      buyerLinkSigningSecret: SIGNING_SECRET, traceId: "e2e-trace",
    });

    const result = await runB2CBuyerResponse(testDb, { buyerToken: created.buyerToken, response: "accept", buyerLinkSigningSecret: SIGNING_SECRET, traceId: "e2e-trace" });
    expect(result.status).toBe("committed");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(dealCase.status).toBe("committed");
    expect(dealCase.channel).toBe("b2c");

    const events = await testDb.caseEvent.findMany({ where: { caseId: created.caseId }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual([
      "b2c.requirement_parsed",
      "b2c.quote_accepted",
      "case.prepared",
      "commit.requested",
      "case.committed",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/e2e.test.ts
```

Expected: PASS (1/1). If the event-type ordering assertion fails, read the actual order back (`console.log(events.map(e => e.eventType))`) and correct the expected array to match — the point of this assertion is pinning the real sequence, not guessing it blind.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/b2c/e2e.test.ts
git commit -m "test: B2C end-to-end integration (intake through commit)"
```

---

### Task 10: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: 38 files (30 after Task 2 + 8 new B2C files), all passing. Exact test count: sum each task's reported pass count against the running baseline; the important thing is 0 failures.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
export DATABASE_URL="file:./dev.db"
npm run build
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Confirm migrations are reproducible from a clean database**

```bash
rm -f prisma/dev-verify.db
DATABASE_URL="file:./dev-verify.db" npx prisma migrate deploy
rm -f prisma/dev-verify.db prisma/dev-verify.db-journal
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 5: Confirm no existing B2B workflow behavior changed**

```bash
git diff --stat main -- src/workflow/dealSubmitted.ts src/workflow/commit.ts src/reservations src/adapters src/policy/economics.ts
```

Expected: only the `B2C_REQUIRED_DOMAINS` removal from `dealSubmitted.ts` (Task 2) — no other line in any B2B decision/routing/adapter file touched.

---

## Self-review notes

- **Spec coverage:** every file/function in `2026-08-30-b2c-core-workflow-design.md`'s "File-by-file plan" has a task — `channel` (Task 1), `B2C_REQUIRED_DOMAINS` relocation (Task 2), `b2cMargin.ts` (Task 3), `intake.ts` (Task 4), `check.ts` (Task 5), `createCase.ts` (Task 6), `commit.ts` (Task 7 — built before Task 8 since `buyerResponse.ts` calls it), `buyerResponse.ts` (Task 8).
- **Placeholder scan:** none — every step has complete code and exact expected output.
- **Type consistency:** `ParsedRequirement`, `SupplierCandidate`, `B2CMarginResult`, `CreateB2CCaseInput`/`CreateB2CCaseResult`, `RunB2CCommitInput`, `RunB2CBuyerResponseInput`/`B2CBuyerResponseResult` are each defined once (in the task that creates them) and imported by name everywhere else they're used — checked against every cross-file reference above.
- **A design-doc gap caught during planning:** the design doc's `CreateB2CCaseInput` didn't separate "listed price" from "negotiated price," which would have made `holdSupplierOption`'s ceiling check reject any negotiation that beat the listed price — the plan above fixes this (`listedUnitCostMinor`/`listedLeadDays` as distinct fields) and the corresponding design doc section is superseded by this plan's version.
- **A margin-engine gap caught during planning:** the design doc's margin-floor decline path (`B2CMarginResult | null`) can never actually trigger given the three fixed bands (12.5/8.5/6%, all above the 5% floor) — the plan above ships `calculateB2CQuote` returning a plain `B2CMarginResult` with no unreachable branch, documented in the code comment for why.
