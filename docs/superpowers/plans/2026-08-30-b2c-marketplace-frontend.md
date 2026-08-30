# B2C Marketplace Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, working operator UI for the B2C marketplace flow — port the mockup's marketplace screen to React inside `app/`, driven by the actual B2C backend (intake → check → negotiation brief → create case → buyer accept/reject → commit) instead of a demo timer, per `docs/superpowers/specs/2026-08-30-b2c-marketplace-frontend-design.md`.

**Architecture:** New files under `src/lib/openaiClient.ts`, `src/workflow/b2c/negotiationBrief.ts`, `src/workflow/b2c/deriveMarketState.ts`, `src/app/api/b2c/**`, and `src/app/market/**`. No existing backend file's behavior changes.

**Tech Stack:** Next.js 14 App Router, React 18, Prisma/SQLite, Zod, OpenAI SDK, Vitest, TypeScript. Working directory for every command: `/Users/eidoviscontact/Novel/Novel/.worktrees/b2c-marketplace-frontend/app`.

**A note on visual fidelity:** the mockup's onboarding "guide" panel, the manual `noMatch` demo toggle, and the `/data`/`/profile` screens are intentionally not ported (see the design doc's "Explicitly Out of Scope"). Colors, fonts, copy, and the core find→negotiate→commit layout are carried over faithfully; some decorative/demo-only chrome is simplified.

---

### Task 1: OpenAI client helper

**Files:**
- Create: `src/lib/openaiClient.ts`
- Test: `src/lib/openaiClient.test.ts`

Every route handler that needs a real LLM call constructs its client through this one helper, so the required env vars (`OPENAI_API_KEY`, `OPENAI_MODEL_ID`, optional `OPENAI_REQUEST_TIMEOUT_MS`) are checked in one place with one clear error, not scattered across call sites. `.env.example` already lists these three names.

- [ ] **Step 1: Write the failing test**

Create `src/lib/openaiClient.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { getOpenAIClient } from "./openaiClient";

describe("getOpenAIClient", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("throws when OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    expect(() => getOpenAIClient()).toThrow(/OPENAI_API_KEY/);
  });

  it("throws when OPENAI_MODEL_ID is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_MODEL_ID;
    expect(() => getOpenAIClient()).toThrow(/OPENAI_MODEL_ID/);
  });

  it("returns a client, modelId, and a 30s default timeout when only the required vars are set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    delete process.env.OPENAI_REQUEST_TIMEOUT_MS;
    const result = getOpenAIClient();
    expect(result.modelId).toBe("gpt-5-nano");
    expect(result.timeoutMs).toBe(30_000);
    expect(result.client).toBeTruthy();
  });

  it("uses OPENAI_REQUEST_TIMEOUT_MS when set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    process.env.OPENAI_REQUEST_TIMEOUT_MS = "5000";
    expect(getOpenAIClient().timeoutMs).toBe(5000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/lib/openaiClient.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/openaiClient.ts`:

```typescript
import OpenAI from "openai";

// Single place that reads the OpenAI env vars and constructs a client — every route
// handler that needs a real LLM call (intake parsing, negotiation briefs) goes through
// this instead of constructing its own client, so a missing env var fails loudly here,
// once, instead of surfacing as a confusing downstream SDK error.
export function getOpenAIClient(): { client: OpenAI; modelId: string; timeoutMs: number } {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelId = process.env.OPENAI_MODEL_ID;
  if (!apiKey) throw new Error("getOpenAIClient: OPENAI_API_KEY is not set");
  if (!modelId) throw new Error("getOpenAIClient: OPENAI_MODEL_ID is not set");
  const timeoutMsRaw = process.env.OPENAI_REQUEST_TIMEOUT_MS;
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 30_000;
  return { client: new OpenAI({ apiKey }), modelId, timeoutMs };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/lib/openaiClient.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/openaiClient.ts src/lib/openaiClient.test.ts
git commit -m "feat: add getOpenAIClient helper for route handlers"
```

---

### Task 2: Negotiation brief generator

**Files:**
- Create: `src/workflow/b2c/negotiationBriefJsonSchema.ts`
- Create: `src/workflow/b2c/negotiationBrief.ts`
- Test: `src/workflow/b2c/negotiationBrief.test.ts`

Per `commitos-b2c-product-spec.md` §Step 3, before the human negotiator contacts a supplier, an "AI negotiation assistant" prepares a brief. Three fields are computed from real data (BATNA, walk-away price, historical pricing); three are LLM judgment/writing (market price estimate, suggested opening price, negotiation levers). This function is read-only and advisory — it persists nothing, and `createB2CCase` (already built) is unaffected; the human still enters whatever price they actually got.

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/negotiationBrief.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { testDb, resetTestDb } from "@/lib/testDb";
import { generateNegotiationBrief } from "./negotiationBrief";
import { ToolError } from "@/lib/types";

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const LLM_REPLY = {
  marketPriceRangeNote: "Similar copper wire has traded 95-105 per unit recently.",
  suggestedOpeningUnitCostMinor: 85_00,
  negotiationLevers: ["Offer a repeat-order commitment", "Mention a competing quote at 90_00"],
};

describe("generateNegotiationBrief", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("computes BATNA from the other candidates and a walk-away price 8% below the listed price", async () => {
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] }]);
    const brief = await generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-1", itemDescription: "4mm copper wire", quantity: 500,
      deliveryDeadline: "2026-09-15", chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00,
      otherCandidates: [{ supplierId: "VEND-B", unitCostMinor: 95_00, leadDays: 12, availableQuantity: 500, freshnessTier: null, isStale: false }],
    });
    expect(brief.batna).toEqual([{ supplierId: "VEND-B", unitCostMinor: 95_00, leadDays: 12 }]);
    expect(brief.walkAwayUnitCostMinor).toBe(92_00);
    expect(brief.marketPriceRangeNote).toBe(LLM_REPLY.marketPriceRangeNote);
    expect(brief.suggestedOpeningUnitCostMinor).toBe(85_00);
    expect(brief.negotiationLevers).toEqual(LLM_REPLY.negotiationLevers);
  });

  it("returns null historical pricing when this supplier+sku has never been reserved before", async () => {
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] }]);
    const brief = await generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-NEW", itemDescription: "steel rod", quantity: 10,
      deliveryDeadline: "2026-09-15", chosenSupplierId: "VEND-NEW", chosenListedUnitCostMinor: 100_00,
      otherCandidates: [],
    });
    expect(brief.historicalPricing).toBeNull();
  });

  it("returns real historical pricing from a prior confirmed order with this exact supplier+sku", async () => {
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Old Buyer", phone: "+91-90000-00099" } });
    const priorCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "committed", createdBy: "test" } });
    await testDb.termsVersion.create({ data: { caseId: priorCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "SKU-HIST", quantity: 10, totalValueMinor: 200_00, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: new Date(), confirmedBuyPriceMinor: 88_00 } });
    await testDb.reservation.create({ data: { caseId: priorCase.id, caseVersion: 1, termsHash: "hash-1", domain: "supplier", resourceRef: "SUPPLIER:VEND-A:SKU-HIST", status: "committed", policyVersion: "supplier-policy-v1", expiresAt: new Date(Date.now() + 100_000), idempotencyKey: "hist-1" } });

    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] }]);
    const brief = await generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-HIST", itemDescription: "widget", quantity: 10,
      deliveryDeadline: "2026-09-15", chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00,
      otherCandidates: [],
    });
    expect(brief.historicalPricing).toEqual([{ unitCostMinor: 88_00, confirmedAt: expect.any(String) }]);
  });

  it("wraps a network failure as ToolError PROVIDER_UNAVAILABLE", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-1", itemDescription: "x", quantity: 1, deliveryDeadline: "2026-09-15",
      chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
    })).rejects.toThrow(ToolError);
  });

  it("wraps a non-JSON response as ToolError INVALID_INPUT", async () => {
    const client = fakeClient([{ choices: [{ message: { content: "not json" } }] }]);
    await expect(generateNegotiationBrief(testDb, client, "gpt-5-nano", 30_000, {
      sku: "SKU-1", itemDescription: "x", quantity: 1, deliveryDeadline: "2026-09-15",
      chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
    })).rejects.toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/negotiationBrief.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/negotiationBriefJsonSchema.ts`:

```typescript
// Hand-written JSON Schema mirror of the LLM-produced fields in NegotiationBrief
// (negotiationBrief.ts) — BATNA, walk-away price, and historical pricing are computed
// deterministically from real data and are never asked of the model. Same OpenAI
// structured-outputs strict-mode convention as
// src/workflow/b2c/parsedRequirementJsonSchema.ts.
export const NEGOTIATION_BRIEF_LLM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marketPriceRangeNote: { type: "string" },
    suggestedOpeningUnitCostMinor: { type: "integer" },
    negotiationLevers: { type: "array", items: { type: "string" } },
  },
  required: ["marketPriceRangeNote", "suggestedOpeningUnitCostMinor", "negotiationLevers"],
} as const;
```

Create `src/workflow/b2c/negotiationBrief.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type OpenAI from "openai";
import { z } from "zod";
import { ToolError } from "@/lib/types";
import type { SupplierCandidate } from "./check";
import { NEGOTIATION_BRIEF_LLM_JSON_SCHEMA } from "./negotiationBriefJsonSchema";

// Below this fraction of the chosen candidate's listed price, the order is declined —
// a flat policy percentage standing in for "walk-away price, fixed by category" (the
// product's own framing, commitos-b2c-product-spec.md §Step 3) until categories are
// actually modeled.
const WALKAWAY_DISCOUNT_BPS = 800; // 8%

export interface NegotiationBriefInput {
  sku: string;
  itemDescription: string;
  quantity: number;
  deliveryDeadline: string;
  chosenSupplierId: string;
  chosenListedUnitCostMinor: number;
  otherCandidates: SupplierCandidate[];
}

const NegotiationBriefLlmSchema = z.object({
  marketPriceRangeNote: z.string(),
  suggestedOpeningUnitCostMinor: z.number().int().positive(),
  negotiationLevers: z.array(z.string()),
});

export interface NegotiationBrief {
  batna: { supplierId: string; unitCostMinor: number; leadDays: number }[];
  buyerDeadline: string;
  walkAwayUnitCostMinor: number;
  historicalPricing: { unitCostMinor: number; confirmedAt: string }[] | null;
  marketPriceRangeNote: string;
  suggestedOpeningUnitCostMinor: number;
  negotiationLevers: string[];
}

const NEGOTIATION_BRIEF_SYSTEM_PROMPT =
  "You are the negotiation assistant for a B2C industrial-goods marketplace. A human " +
  "negotiator is about to contact a supplier to get the best buy price for an item. " +
  "Given the item, quantity, the supplier's listed price, other suppliers who could " +
  "also fulfill this order, and any historical pricing, provide: a plausible market " +
  "price range for this item as a short note (not a guarantee), a suggested opening " +
  "price to start the negotiation at (same minor-unit currency as the listed price, " +
  "always below it), and 2-4 short negotiation levers (e.g. volume commitment, repeat " +
  "order potential, a competing quote).";

// Finds prior confirmed buy prices for this exact supplier+sku, via the reservation
// resourceRef convention "SUPPLIER:<supplierId>:<sku>" (src/adapters/supplierAdapter.ts)
// — TermsVersion has no direct supplierId column, since B2C discovers the supplier live
// per order rather than from a catalog (see TermsVersion.confirmedBuyPriceMinor's own
// schema comment).
async function findHistoricalPricing(
  db: PrismaClient,
  input: { supplierId: string; sku: string },
): Promise<{ unitCostMinor: number; confirmedAt: string }[] | null> {
  const priorReservations = await db.reservation.findMany({
    where: { domain: "supplier", resourceRef: `SUPPLIER:${input.supplierId}:${input.sku}` },
    select: { caseId: true, caseVersion: true },
  });
  if (priorReservations.length === 0) return null;

  const history: { unitCostMinor: number; confirmedAt: string }[] = [];
  for (const reservation of priorReservations) {
    const terms = await db.termsVersion.findFirst({
      where: { caseId: reservation.caseId, version: reservation.caseVersion, confirmedBuyPriceMinor: { not: null } },
    });
    if (terms?.confirmedBuyPriceMinor != null) {
      history.push({ unitCostMinor: terms.confirmedBuyPriceMinor, confirmedAt: terms.createdAt.toISOString() });
    }
  }
  return history.length > 0 ? history : null;
}

// Prepares the brief a human negotiator reviews before contacting a supplier
// (commitos-b2c-product-spec.md §Step 3). Read-only and advisory: it persists nothing
// and does not negotiate on its own behalf — "The AI does not negotiate autonomously in
// Phase 1." The negotiator still records whatever price they actually got via
// createB2CCase's negotiatedBuyPriceMinor input, independent of this brief.
export async function generateNegotiationBrief(
  db: PrismaClient,
  client: OpenAI,
  modelId: string,
  timeoutMs: number,
  input: NegotiationBriefInput,
): Promise<NegotiationBrief> {
  const batna = input.otherCandidates.map((c) => ({ supplierId: c.supplierId, unitCostMinor: c.unitCostMinor, leadDays: c.leadDays }));
  const walkAwayUnitCostMinor = Math.round((input.chosenListedUnitCostMinor * (10_000 - WALKAWAY_DISCOUNT_BPS)) / 10_000);
  const historicalPricing = await findHistoricalPricing(db, { supplierId: input.chosenSupplierId, sku: input.sku });

  const userMessage = JSON.stringify({
    itemDescription: input.itemDescription,
    quantity: input.quantity,
    deliveryDeadline: input.deliveryDeadline,
    chosenSupplierListedUnitCostMinor: input.chosenListedUnitCostMinor,
    otherSuppliers: batna,
    historicalPricing,
  });

  let response;
  try {
    response = await client.chat.completions.create(
      {
        model: modelId,
        messages: [
          { role: "system", content: NEGOTIATION_BRIEF_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_schema", json_schema: { name: "negotiation_brief", strict: true, schema: NEGOTIATION_BRIEF_LLM_JSON_SCHEMA } },
      },
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new ToolError("PROVIDER_UNAVAILABLE", `Negotiation brief call failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  const raw = response.choices[0]!.message.content ?? "{}";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new ToolError("INVALID_INPUT", `Negotiation brief response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, false);
  }
  const parsed = NegotiationBriefLlmSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ToolError("INVALID_INPUT", `Negotiation brief response failed validation: ${parsed.error.message}`, false);
  }

  return {
    batna,
    buyerDeadline: input.deliveryDeadline,
    walkAwayUnitCostMinor,
    historicalPricing,
    marketPriceRangeNote: parsed.data.marketPriceRangeNote,
    suggestedOpeningUnitCostMinor: parsed.data.suggestedOpeningUnitCostMinor,
    negotiationLevers: parsed.data.negotiationLevers,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/negotiationBrief.test.ts
```

Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/negotiationBriefJsonSchema.ts src/workflow/b2c/negotiationBrief.ts src/workflow/b2c/negotiationBrief.test.ts
git commit -m "feat: add B2C negotiation brief generator"
```

---

### Task 3: `deriveMarketState` — the UI-state derivation function

**Files:**
- Create: `src/workflow/b2c/deriveMarketState.ts`
- Test: `src/workflow/b2c/deriveMarketState.test.ts`

The mockup's `renderVals()` derives everything the UI shows from `state.mstage` (0–7). The real backend's states don't partition cleanly into 8 numbered buckets (an `escalated` case, for instance, isn't on the mockup's original happy-path spectrum at all), so this uses **named stages** instead of the mockup's raw numbers — a deliberate, documented simplification, not a partial port. The mapping still drives the same kind of UI (a live-updating stage label, dots, and figures).

- [ ] **Step 1: Write the failing test**

Create `src/workflow/b2c/deriveMarketState.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveMarketState } from "./deriveMarketState";
import { toJsonColumn } from "@/lib/json-column";

function event(eventType: string, payload: unknown = {}) {
  return { eventType, payload: toJsonColumn(payload) };
}

describe("deriveMarketState", () => {
  it("is awaiting_buyer_response right after a quote is sent, before any buyer action", () => {
    const state = deriveMarketState({ status: "evaluating" }, [event("b2c.requirement_parsed")], 1_325_000);
    expect(state.stage).toBe("awaiting_buyer_response");
    expect(state.sellPriceMinor).toBe(1_325_000);
  });

  it("is preparing once the buyer has accepted but before commit completes", () => {
    const state = deriveMarketState(
      { status: "evaluating" },
      [event("b2c.requirement_parsed"), event("b2c.quote_accepted"), event("case.prepared")],
      1_325_000,
    );
    expect(state.stage).toBe("preparing");
  });

  it("is committed when the case status says so, regardless of event history", () => {
    const state = deriveMarketState(
      { status: "committed" },
      [event("b2c.requirement_parsed"), event("case.committed")],
      1_325_000,
    );
    expect(state.stage).toBe("committed");
    expect(state.certificateReady).toBe(true);
  });

  it("is declined when the buyer rejected the quote", () => {
    const state = deriveMarketState(
      { status: "cannot_commit" },
      [event("b2c.requirement_parsed"), event("b2c.quote_rejected")],
      1_325_000,
    );
    expect(state.stage).toBe("declined");
    expect(state.sellPriceMinor).toBeNull();
  });

  it("is escalated and surfaces the recorded reason when the commit fails after the supplier already committed", () => {
    const state = deriveMarketState(
      { status: "escalated" },
      [event("case.escalated", { reason: "PARTIAL_COMMIT: sandbox order failed" })],
      1_325_000,
    );
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("PARTIAL_COMMIT: sandbox order failed");
  });

  it("falls back to a generic reason when an escalated case has no case.escalated event on record", () => {
    const state = deriveMarketState({ status: "escalated" }, [], 1_325_000);
    expect(state.stage).toBe("escalated");
    expect(state.reason).toBe("Unknown reason");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/workflow/b2c/deriveMarketState.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/workflow/b2c/deriveMarketState.ts`:

```typescript
import { fromJsonColumn } from "@/lib/json-column";

export type MarketStage = "awaiting_buyer_response" | "preparing" | "committed" | "declined" | "escalated";

export interface MarketViewState {
  stage: MarketStage;
  label: string;
  certificateReady: boolean;
  sellPriceMinor: number | null;
  reason: string | null;
}

const STAGE_LABELS: Record<MarketStage, string> = {
  awaiting_buyer_response: "Quote sent — waiting for the buyer to respond.",
  preparing: "Buyer accepted — committing the supplier order.",
  committed: "Committed — the buyer has a dated certificate.",
  declined: "Declined — the buyer did not accept this quote.",
  escalated: "Needs attention — the commit did not complete cleanly.",
};

// The direct analog of the mockup's renderVals(), but computed from real DealCase +
// CaseEvent rows instead of a demo timer's this.state.mstage. Named stages instead of
// the mockup's raw 0-7 numbers: the real state machine doesn't partition into 8 equal
// buckets (escalated, in particular, isn't on the original happy-path spectrum at all).
export function deriveMarketState(
  dealCase: { status: string },
  events: { eventType: string; payload: string }[],
  termsTotalValueMinor: number | null,
): MarketViewState {
  if (dealCase.status === "committed") {
    return { stage: "committed", label: STAGE_LABELS.committed, certificateReady: true, sellPriceMinor: termsTotalValueMinor, reason: null };
  }
  if (dealCase.status === "escalated") {
    const escalatedEvent = [...events].reverse().find((e) => e.eventType === "case.escalated");
    const reason = escalatedEvent ? (fromJsonColumn<{ reason?: string }>(escalatedEvent.payload).reason ?? "Unknown reason") : "Unknown reason";
    return { stage: "escalated", label: STAGE_LABELS.escalated, certificateReady: false, sellPriceMinor: null, reason };
  }
  if (dealCase.status === "cannot_commit") {
    return { stage: "declined", label: STAGE_LABELS.declined, certificateReady: false, sellPriceMinor: null, reason: null };
  }
  const eventTypes = new Set(events.map((e) => e.eventType));
  if (eventTypes.has("case.prepared")) {
    return { stage: "preparing", label: STAGE_LABELS.preparing, certificateReady: false, sellPriceMinor: termsTotalValueMinor, reason: null };
  }
  return { stage: "awaiting_buyer_response", label: STAGE_LABELS.awaiting_buyer_response, certificateReady: false, sellPriceMinor: termsTotalValueMinor, reason: null };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/workflow/b2c/deriveMarketState.test.ts
```

Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/b2c/deriveMarketState.ts src/workflow/b2c/deriveMarketState.test.ts
git commit -m "feat: add deriveMarketState UI-state derivation"
```

---

### Task 4: Route handler — `POST /api/b2c/intake`

**Files:**
- Create: `src/app/api/b2c/intake/route.ts`
- Test: `src/app/api/b2c/intake/route.test.ts`

**A gap worth knowing about before writing this task:** `parseB2CRequirement` extracts an `itemDescription` (free text, e.g. "4mm copper wire"), but `findSupplierCandidates` needs an exact `sku` string to query `SupplierOption` rows — there is no fuzzy-matching or catalog-lookup step anywhere in the codebase that turns free text into a SKU code, and building one is out of scope here. So this route takes `sku` as a **required, separately-supplied field** (the operator types or picks it), not something derived from `rawText`. This mirrors the already-established pattern of the operator manually supplying the negotiated price later — a human fills the gap the backend doesn't automate.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/b2c/intake/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

const mockCreate = vi.fn();
vi.mock("@/lib/openaiClient", () => ({
  getOpenAIClient: () => ({ client: { chat: { completions: { create: mockCreate } } }, modelId: "gpt-5-nano", timeoutMs: 30_000 }),
}));

import { testDb, resetTestDb } from "@/lib/testDb";
import { POST } from "./route";

const PARSED = {
  itemDescription: "4mm copper wire", quantity: 500, unit: "metres",
  deliveryDeadline: "2026-09-15", location: "Bangalore", missingCriticalField: null,
};

describe("POST /api/b2c/intake", () => {
  beforeEach(async () => {
    await resetTestDb();
    mockCreate.mockReset();
  });

  it("returns the parsed requirement and ranked candidates for a valid request", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(PARSED) } }] });

    const request = new Request("http://localhost/api/b2c/intake", {
      method: "POST",
      body: JSON.stringify({ rawText: "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore", sku: "SKU-1" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.parsedRequirement).toEqual(PARSED);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].supplierId).toBe("VEND-A");
  });

  it("returns 400 when rawText is missing", async () => {
    const request = new Request("http://localhost/api/b2c/intake", { method: "POST", body: JSON.stringify({ sku: "SKU-1" }) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 502 when the LLM call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));
    const request = new Request("http://localhost/api/b2c/intake", { method: "POST", body: JSON.stringify({ rawText: "some text", sku: "SKU-1" }) });
    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/app/api/b2c/intake/route.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/b2c/intake/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { parseB2CRequirement } from "@/workflow/b2c/intake";
import { findSupplierCandidates } from "@/workflow/b2c/check";
import { ToolError } from "@/lib/types";

// sku is a required, separately-supplied field, not derived from rawText — there is no
// free-text-to-SKU matching step anywhere in this codebase (see the plan's Task 4 notes
// for why). The operator supplies it directly, the same way they later supply the
// negotiated price: a human fills the gap the backend doesn't automate.
export async function POST(request: Request) {
  const body = await request.json();
  const rawText = typeof body?.rawText === "string" ? body.rawText : null;
  const sku = typeof body?.sku === "string" ? body.sku : null;
  if (!rawText) return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 });

  try {
    const { client, modelId, timeoutMs } = getOpenAIClient();
    const parsedRequirement = await parseB2CRequirement(client, modelId, rawText, timeoutMs);
    const candidates = await findSupplierCandidates(db, { sku, quantity: parsedRequirement.quantity });
    return NextResponse.json({ parsedRequirement, candidates });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 502 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/app/api/b2c/intake/route.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/b2c/intake/route.ts src/app/api/b2c/intake/route.test.ts
git commit -m "feat: add POST /api/b2c/intake route handler"
```

---

### Task 5: Route handler — `POST /api/b2c/negotiation-brief`

**Files:**
- Create: `src/app/api/b2c/negotiation-brief/route.ts`
- Test: `src/app/api/b2c/negotiation-brief/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/b2c/negotiation-brief/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

const mockCreate = vi.fn();
vi.mock("@/lib/openaiClient", () => ({
  getOpenAIClient: () => ({ client: { chat: { completions: { create: mockCreate } } }, modelId: "gpt-5-nano", timeoutMs: 30_000 }),
}));

import { resetTestDb } from "@/lib/testDb";
import { POST } from "./route";

const LLM_REPLY = { marketPriceRangeNote: "note", suggestedOpeningUnitCostMinor: 85_00, negotiationLevers: ["lever one"] };

describe("POST /api/b2c/negotiation-brief", () => {
  beforeEach(async () => {
    await resetTestDb();
    mockCreate.mockReset();
  });

  it("returns a brief for a valid request", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(LLM_REPLY) } }] });
    const request = new Request("http://localhost/api/b2c/negotiation-brief", {
      method: "POST",
      body: JSON.stringify({
        sku: "SKU-1", itemDescription: "4mm copper wire", quantity: 500, deliveryDeadline: "2026-09-15",
        chosenSupplierId: "VEND-A", chosenListedUnitCostMinor: 100_00, otherCandidates: [],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.brief.walkAwayUnitCostMinor).toBe(92_00);
    expect(body.brief.marketPriceRangeNote).toBe("note");
  });

  it("returns 400 when a required field is missing", async () => {
    const request = new Request("http://localhost/api/b2c/negotiation-brief", { method: "POST", body: JSON.stringify({ sku: "SKU-1" }) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/app/api/b2c/negotiation-brief/route.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/b2c/negotiation-brief/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { generateNegotiationBrief } from "@/workflow/b2c/negotiationBrief";
import { ToolError } from "@/lib/types";
import type { SupplierCandidate } from "@/workflow/b2c/check";

const REQUIRED_FIELDS = ["sku", "itemDescription", "quantity", "deliveryDeadline", "chosenSupplierId", "chosenListedUnitCostMinor", "otherCandidates"] as const;

export async function POST(request: Request) {
  const body = await request.json();
  for (const field of REQUIRED_FIELDS) {
    if (body?.[field] === undefined) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  try {
    const { client, modelId, timeoutMs } = getOpenAIClient();
    const brief = await generateNegotiationBrief(db, client, modelId, timeoutMs, {
      sku: body.sku,
      itemDescription: body.itemDescription,
      quantity: body.quantity,
      deliveryDeadline: body.deliveryDeadline,
      chosenSupplierId: body.chosenSupplierId,
      chosenListedUnitCostMinor: body.chosenListedUnitCostMinor,
      otherCandidates: body.otherCandidates as SupplierCandidate[],
    });
    return NextResponse.json({ brief });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 502 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/app/api/b2c/negotiation-brief/route.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/b2c/negotiation-brief/route.ts src/app/api/b2c/negotiation-brief/route.test.ts
git commit -m "feat: add POST /api/b2c/negotiation-brief route handler"
```

---

### Task 6: Route handler — `POST /api/b2c/cases`

**Files:**
- Create: `src/app/api/b2c/cases/route.ts`
- Test: `src/app/api/b2c/cases/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/b2c/cases/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { POST } from "./route";

const BASE_BODY = {
  buyerName: "Ramesh Traders", buyerPhone: "+91-90000-00000", sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire", quantity: 10, unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore", missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A", listedUnitCostMinor: 100_00, listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00, operationalCostMinor: 1500_00, riskBufferBps: 500,
};

describe("POST /api/b2c/cases", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    process.env.BUYER_LINK_SIGNING_SECRET = "test-secret";
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  it("creates a case and returns a buyer link", async () => {
    const request = new Request("http://localhost/api/b2c/cases", { method: "POST", body: JSON.stringify(BASE_BODY) });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.caseId).toBeTruthy();
    expect(body.buyerLink).toContain("/market/");
    expect(body.buyerLink).toContain("/accept?token=");

    const dealCase = await testDb.dealCase.findUniqueOrThrow({ where: { id: body.caseId } });
    expect(dealCase.channel).toBe("b2c");
  });

  it("returns 400 when the supplier hold fails (price moved)", async () => {
    const request = new Request("http://localhost/api/b2c/cases", { method: "POST", body: JSON.stringify({ ...BASE_BODY, listedUnitCostMinor: 10_00 }) });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/app/api/b2c/cases/route.test.ts
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/b2c/cases/route.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createB2CCase, type CreateB2CCaseInput } from "@/workflow/b2c/createCase";
import { ToolError } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json();
  const secret = process.env.BUYER_LINK_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "BUYER_LINK_SIGNING_SECRET is not set" }, { status: 500 });

  const input: CreateB2CCaseInput = {
    buyerName: body.buyerName,
    buyerPhone: body.buyerPhone,
    buyerEmail: body.buyerEmail,
    sku: body.sku,
    parsedRequirement: body.parsedRequirement,
    chosenSupplierId: body.chosenSupplierId,
    listedUnitCostMinor: body.listedUnitCostMinor,
    listedLeadDays: body.listedLeadDays,
    negotiatedBuyPriceMinor: body.negotiatedBuyPriceMinor,
    operationalCostMinor: body.operationalCostMinor,
    riskBufferBps: body.riskBufferBps,
    buyerLinkSigningSecret: secret,
    traceId: randomUUID(),
  };

  try {
    const result = await createB2CCase(db, input);
    const baseUrl = process.env.APP_BASE_URL ?? "";
    const buyerLink = `${baseUrl}/market/${result.caseId}/accept?token=${encodeURIComponent(result.buyerToken)}`;
    return NextResponse.json({ caseId: result.caseId, sellPriceMinor: result.sellPriceMinor, buyerLink });
  } catch (error) {
    if (error instanceof ToolError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
```

Note: `createB2CCase` throws a plain `Error` (not always `ToolError`) on the hardened hold-failure path (Task 6 of the core-workflow plan, commit `319ec0d`) — the `catch` block here returns 400 for any thrown error, not just `ToolError`, so that path is still handled correctly. Confirm this against `src/workflow/b2c/createCase.ts` before implementing.

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- src/app/api/b2c/cases/route.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/b2c/cases/route.ts src/app/api/b2c/cases/route.test.ts
git commit -m "feat: add POST /api/b2c/cases route handler"
```

---

### Task 7: Route handler — `GET /api/b2c/cases/[id]`

**Files:**
- Create: `src/app/api/b2c/cases/[id]/route.ts`
- Test: `src/app/api/b2c/cases/[id]/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/b2c/cases/[id]/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { GET } from "./route";

describe("GET /api/b2c/cases/[id]", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns the derived state and event list for an existing case", async () => {
    const company = await testDb.company.create({ data: { name: "CommitOS" } });
    const buyer = await testDb.marketplaceBuyer.create({ data: { name: "Ramesh Traders", phone: "+91-90000-00000" } });
    const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "evaluating", createdBy: "test" } });
    await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "SKU-1", quantity: 10, totalValueMinor: 1_325_000, discountBps: 0, paymentTerms: "ADVANCE_VARIABLE", deliveryDeadline: new Date() } });
    await testDb.caseEvent.create({ data: { caseId: dealCase.id, sequence: 1, eventType: "b2c.requirement_parsed", caseVersion: 1, actorType: "operator", actorRef: "b2c-intake", payload: "{}", traceId: "t1" } });

    const response = await GET(new Request(`http://localhost/api/b2c/cases/${dealCase.id}`), { params: { id: dealCase.id } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.stage).toBe("awaiting_buyer_response");
    expect(body.eventTypes).toEqual(["b2c.requirement_parsed"]);
  });

  it("returns 404 for an unknown case id", async () => {
    const response = await GET(new Request("http://localhost/api/b2c/cases/nonexistent"), { params: { id: "nonexistent" } });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- "src/app/api/b2c/cases/[id]/route.test.ts"
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/b2c/cases/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveMarketState } from "@/workflow/b2c/deriveMarketState";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const dealCase = await db.dealCase.findUnique({ where: { id: params.id } });
  if (!dealCase) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const events = await db.caseEvent.findMany({ where: { caseId: dealCase.id }, orderBy: { sequence: "asc" } });
  const terms = await db.termsVersion.findFirst({ where: { caseId: dealCase.id, version: dealCase.activeTermsVersion } });
  const state = deriveMarketState({ status: dealCase.status }, events, terms?.totalValueMinor ?? null);
  return NextResponse.json({ state, eventTypes: events.map((e) => e.eventType) });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- "src/app/api/b2c/cases/[id]/route.test.ts"
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/b2c/cases/[id]/route.ts" "src/app/api/b2c/cases/[id]/route.test.ts"
git commit -m "feat: add GET /api/b2c/cases/[id] route handler"
```

---

### Task 8: Route handler — `POST /api/b2c/cases/[id]/respond`

**Files:**
- Create: `src/app/api/b2c/cases/[id]/respond/route.ts`
- Test: `src/app/api/b2c/cases/[id]/respond/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/b2c/cases/[id]/respond/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { createB2CCase, type CreateB2CCaseInput } from "@/workflow/b2c/createCase";
import { POST } from "./route";

const SIGNING_SECRET = "test-secret";
const BASE_INPUT: CreateB2CCaseInput = {
  buyerName: "Ramesh Traders", buyerPhone: "+91-90000-00000", sku: "SKU-1",
  parsedRequirement: {
    itemDescription: "4mm copper wire", quantity: 10, unit: "metres",
    deliveryDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Bangalore", missingCriticalField: null,
  },
  chosenSupplierId: "VEND-A", listedUnitCostMinor: 100_00, listedLeadDays: 10,
  negotiatedBuyPriceMinor: 90_00, operationalCostMinor: 1500_00, riskBufferBps: 500,
  buyerLinkSigningSecret: SIGNING_SECRET, traceId: "trace-1",
};

describe("POST /api/b2c/cases/[id]/respond", () => {
  beforeEach(async () => {
    await resetTestDb();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-A", sku: "SKU-1", availableQuantity: 1000, unitCostMinor: 100_00, leadDays: 10, optionTtlSeconds: 900, status: "available" } });
    process.env.BUYER_LINK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("accepts a quote and returns the committed result", async () => {
    const created = await createB2CCase(testDb, BASE_INPUT);
    const request = new Request(`http://localhost/api/b2c/cases/${created.caseId}/respond`, {
      method: "POST",
      body: JSON.stringify({ buyerToken: created.buyerToken, response: "accept" }),
    });
    const response = await POST(request, { params: { id: created.caseId } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.status).toBe("committed");
  });

  it("returns 400 for an invalid response value", async () => {
    const request = new Request("http://localhost/api/b2c/cases/x/respond", { method: "POST", body: JSON.stringify({ buyerToken: "t", response: "maybe" }) });
    const response = await POST(request, { params: { id: "x" } });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- "src/app/api/b2c/cases/[id]/respond/route.test.ts"
```

Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/b2c/cases/[id]/respond/route.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runB2CBuyerResponse } from "@/workflow/b2c/buyerResponse";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const secret = process.env.BUYER_LINK_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "BUYER_LINK_SIGNING_SECRET is not set" }, { status: 500 });
  if (body.response !== "accept" && body.response !== "reject") {
    return NextResponse.json({ error: "response must be 'accept' or 'reject'" }, { status: 400 });
  }

  const result = await runB2CBuyerResponse(db, {
    buyerToken: body.buyerToken,
    response: body.response,
    buyerLinkSigningSecret: secret,
    traceId: randomUUID(),
  });
  void params; // caseId is derived from buyerToken, not the URL, but the URL still carries it for readability
  return NextResponse.json({ result });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- "src/app/api/b2c/cases/[id]/respond/route.test.ts"
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/b2c/cases/[id]/respond/route.ts" "src/app/api/b2c/cases/[id]/respond/route.test.ts"
git commit -m "feat: add POST /api/b2c/cases/[id]/respond route handler"
```

---

### Task 9: Fonts + shared style constants

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/market/styles.ts`

Loads the mockup's three Google Fonts and centralizes its color palette so every component below references the same values instead of copy-pasting hex codes.

- [ ] **Step 1: Update the root layout**

Read `src/app/layout.tsx` first to see its current content, then add the font `<link>` tags inside `<head>`. If the file doesn't already have a `<head>` element, add one. The three fonts, matching the mockup exactly:

```tsx
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
<link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600&family=Source+Serif+4:wght@500&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Create the shared style constants**

Create `src/app/market/styles.ts`:

```typescript
// Color palette and font stacks lifted directly from the mockup (Novel Workspace.dc.html)
// so every ported component references the same values instead of copy-pasting hex codes.
export const INK = "#191A17";
export const SUB = "#585A50";
export const MUTE = "#8D8F82";
export const LINE = "#E4E2D9";
export const GREEN = "#1F5B4B";
export const OK = "#1F6B52";
export const WARN = "#A26A16";
export const BAD = "#96352C";

export const SANS = "'Familjen Grotesk', sans-serif";
export const SERIF = "'Source Serif 4', Georgia, serif";
export const MONO = "'IBM Plex Mono', monospace";
```

- [ ] **Step 3: Verify the app still builds**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/market/styles.ts
git commit -m "feat: load mockup fonts and centralize its color palette"
```

---

### Task 10: `Composer` component (compose → candidates → brief → create case)

**Files:**
- Create: `src/app/market/Composer.tsx`

Client component holding the pre-case-creation flow as local state (compose text + SKU → parse & find suppliers → pick one → review negotiation brief → enter negotiated price + buyer details → create the case). This is new UI, not in the original mockup (which only shows a single hardcoded demo case) — it's the part that makes the demo real.

- [ ] **Step 1: Implement**

Create `src/app/market/Composer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { INK, SUB, MUTE, LINE, GREEN, SANS, SERIF, MONO } from "./styles";

type Candidate = { supplierId: string; unitCostMinor: number; leadDays: number; availableQuantity: number; isStale: boolean };
type ParsedRequirement = { itemDescription: string; quantity: number; unit: string; deliveryDeadline: string; location: string; missingCriticalField: string | null };
type Brief = {
  batna: { supplierId: string; unitCostMinor: number; leadDays: number }[];
  walkAwayUnitCostMinor: number;
  historicalPricing: { unitCostMinor: number; confirmedAt: string }[] | null;
  marketPriceRangeNote: string;
  suggestedOpeningUnitCostMinor: number;
  negotiationLevers: string[];
};

// Fixed policy inputs to the margin engine — not operator-editable in this demo. A real
// deployment would set these per category/order-type; here they're constants matching
// what the backend's own tests already use.
const OPERATIONAL_COST_MINOR = 1500_00;
const RISK_BUFFER_BPS = 500;

const label = { font: `400 10.5px ${MONO}`, letterSpacing: ".14em", color: MUTE, textTransform: "uppercase" as const };
const box = { border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 14px", font: `400 15px ${SANS}`, width: "100%" };

export function Composer({ onCaseCreated }: { onCaseCreated: (result: { caseId: string; buyerLink: string }) => void }) {
  const [phase, setPhase] = useState<"compose" | "candidates" | "no_match" | "brief" | "creating">("compose");
  const [rawText, setRawText] = useState("");
  const [sku, setSku] = useState("");
  const [parsedRequirement, setParsedRequirement] = useState<ParsedRequirement | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [negotiatedPrice, setNegotiatedPrice] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function findSuppliers() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/b2c/intake", { method: "POST", body: JSON.stringify({ rawText, sku }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not parse this request.");
      setParsedRequirement(body.parsedRequirement);
      setCandidates(body.candidates);
      setPhase(body.candidates.length === 0 ? "no_match" : "candidates");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickCandidate(candidate: Candidate) {
    if (!parsedRequirement) return;
    setError(null);
    setBusy(true);
    setChosen(candidate);
    try {
      const res = await fetch("/api/b2c/negotiation-brief", {
        method: "POST",
        body: JSON.stringify({
          sku, itemDescription: parsedRequirement.itemDescription, quantity: parsedRequirement.quantity,
          deliveryDeadline: parsedRequirement.deliveryDeadline, chosenSupplierId: candidate.supplierId,
          chosenListedUnitCostMinor: candidate.unitCostMinor,
          otherCandidates: candidates.filter((c) => c.supplierId !== candidate.supplierId),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not prepare a negotiation brief.");
      setBrief(body.brief);
      setPhase("brief");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndSend() {
    if (!parsedRequirement || !chosen) return;
    const negotiatedBuyPriceMinor = Math.round(Number(negotiatedPrice) * 100);
    if (!Number.isFinite(negotiatedBuyPriceMinor) || negotiatedBuyPriceMinor <= 0) {
      setError("Enter the negotiated price as a positive number.");
      return;
    }
    setError(null);
    setBusy(true);
    setPhase("creating");
    try {
      const res = await fetch("/api/b2c/cases", {
        method: "POST",
        body: JSON.stringify({
          buyerName, buyerPhone, sku, parsedRequirement, chosenSupplierId: chosen.supplierId,
          listedUnitCostMinor: chosen.unitCostMinor, listedLeadDays: chosen.leadDays,
          negotiatedBuyPriceMinor, operationalCostMinor: OPERATIONAL_COST_MINOR, riskBufferBps: RISK_BUFFER_BPS,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create this case.");
      onCaseCreated({ caseId: body.caseId, buyerLink: body.buyerLink });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("brief");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "42px 40px" }}>
      <h2 style={{ font: `500 34px/1.2 ${SERIF}`, letterSpacing: "-.012em", margin: 0, color: INK }}>Marketplace</h2>
      <p style={{ font: `400 16.5px/1.75 ${SANS}`, color: SUB, margin: "14px 0 0" }}>
        Describe what a buyer needs. Novel searches your supplier network, and you negotiate the buy price with an AI-prepared brief before quoting the buyer.
      </p>

      {error && <div style={{ marginTop: 20, padding: "12px 16px", border: `1px solid ${LINE}`, borderRadius: 8, color: "#96352C", font: `400 14px ${SANS}` }}>{error}</div>}

      {phase === "compose" && (
        <div style={{ marginTop: 28 }}>
          <div style={label}>Raw request</div>
          <textarea style={{ ...box, marginTop: 6, minHeight: 90, resize: "vertical" }} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore" />
          <div style={{ ...label, marginTop: 16 }}>SKU</div>
          <input style={{ ...box, marginTop: 6 }} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-COPPER-4MM" />
          <button disabled={busy || !rawText || !sku} onClick={findSuppliers} style={{ marginTop: 20, font: `500 14px ${SANS}`, color: "#fff", background: GREEN, border: "none", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}>
            {busy ? "Searching…" : "Find suppliers"}
          </button>
        </div>
      )}

      {phase === "no_match" && (
        <div style={{ marginTop: 28, padding: "20px 0", borderTop: `1px solid ${LINE}` }}>
          <div style={{ font: `500 21px/1.3 ${SERIF}`, color: INK }}>Nobody in the network makes this.</div>
          <p style={{ font: `400 15px/1.7 ${SANS}`, color: SUB, marginTop: 10 }}>No supplier could fulfill this SKU at the requested quantity. Logged as a sourcing signal, not quoted to the buyer.</p>
          <button onClick={() => setPhase("compose")} style={{ marginTop: 16, font: `500 13.5px ${SANS}`, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 18px", cursor: "pointer" }}>Try another request</button>
        </div>
      )}

      {phase === "candidates" && (
        <div style={{ marginTop: 28, padding: "20px 0", borderTop: `1px solid ${LINE}` }}>
          <div style={{ font: `600 17px ${SANS}`, color: INK }}>{candidates.length} supplier{candidates.length === 1 ? "" : "s"} found, ranked by cost then lead time</div>
          {candidates.map((c) => (
            <div key={c.supplierId} style={{ display: "flex", alignItems: "baseline", gap: 16, padding: "14px 0", borderBottom: `1px solid #EDEAE1` }}>
              <span style={{ flex: 1, font: `400 15px ${SANS}`, color: INK }}>{c.supplierId}{c.isStale ? " (stale data)" : ""}</span>
              <span style={{ font: `400 14px ${MONO}`, color: SUB }}>₹{(c.unitCostMinor / 100).toFixed(2)} · {c.leadDays}d</span>
              <button disabled={busy} onClick={() => pickCandidate(c)} style={{ font: `500 13px ${SANS}`, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 7, padding: "7px 14px", cursor: "pointer" }}>Choose</button>
            </div>
          ))}
        </div>
      )}

      {phase === "brief" && brief && chosen && (
        <div style={{ marginTop: 28, padding: "20px 0", borderTop: `1px solid ${LINE}` }}>
          <div style={{ font: `600 17px ${SANS}`, color: INK }}>Negotiation brief — {chosen.supplierId}</div>
          <p style={{ font: `400 15px/1.7 ${SANS}`, color: SUB, marginTop: 8 }}>{brief.marketPriceRangeNote}</p>
          <div style={{ display: "flex", gap: 40, marginTop: 14, flexWrap: "wrap" }}>
            <div><div style={label}>Suggested opening</div><div style={{ font: `500 20px ${SERIF}`, marginTop: 6 }}>₹{(brief.suggestedOpeningUnitCostMinor / 100).toFixed(2)}</div></div>
            <div><div style={label}>Walk-away</div><div style={{ font: `500 20px ${SERIF}`, marginTop: 6, color: "#96352C" }}>₹{(brief.walkAwayUnitCostMinor / 100).toFixed(2)}</div></div>
            <div><div style={label}>Listed</div><div style={{ font: `500 20px ${SERIF}`, marginTop: 6 }}>₹{(chosen.unitCostMinor / 100).toFixed(2)}</div></div>
          </div>
          {brief.historicalPricing && (
            <p style={{ font: `400 13px ${SANS}`, color: MUTE, marginTop: 10 }}>Last confirmed with this supplier: ₹{(brief.historicalPricing[0]!.unitCostMinor / 100).toFixed(2)}</p>
          )}
          <ul style={{ font: `400 14px/1.7 ${SANS}`, color: SUB, marginTop: 10, paddingLeft: 18 }}>
            {brief.negotiationLevers.map((lever, i) => <li key={i}>{lever}</li>)}
          </ul>

          <div style={{ marginTop: 20 }}>
            <div style={label}>Confirmed buy price (₹/unit)</div>
            <input style={{ ...box, marginTop: 6, maxWidth: 200 }} value={negotiatedPrice} onChange={(e) => setNegotiatedPrice(e.target.value)} placeholder="90.00" />
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={label}>Buyer name</div>
            <input style={{ ...box, marginTop: 6 }} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Ramesh Traders" />
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={label}>Buyer phone</div>
            <input style={{ ...box, marginTop: 6 }} value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="+91-90000-00000" />
          </div>
          <button disabled={busy || !negotiatedPrice || !buyerName || !buyerPhone} onClick={confirmAndSend} style={{ marginTop: 18, font: `500 14px ${SANS}`, color: "#fff", background: GREEN, border: "none", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}>
            Confirm and send quote to buyer
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/market/Composer.tsx
git commit -m "feat: add Composer component (intake through case creation)"
```

---

### Task 11: `LiveProgress` component (polling view)

**Files:**
- Create: `src/app/market/LiveProgress.tsx`

- [ ] **Step 1: Implement**

Create `src/app/market/LiveProgress.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { INK, SUB, MUTE, LINE, OK, WARN, BAD, SANS, SERIF, MONO } from "./styles";

type MarketViewState = {
  stage: "awaiting_buyer_response" | "preparing" | "committed" | "declined" | "escalated";
  label: string;
  certificateReady: boolean;
  sellPriceMinor: number | null;
  reason: string | null;
};

const STAGE_DOT_COLOR: Record<MarketViewState["stage"], string> = {
  awaiting_buyer_response: INK,
  preparing: INK,
  committed: OK,
  declined: MUTE,
  escalated: WARN,
};

const TERMINAL_STAGES = new Set(["committed", "declined", "escalated"]);

export function LiveProgress({ caseId, buyerLink, onNewRequest }: { caseId: string; buyerLink: string; onNewRequest: () => void }) {
  const [state, setState] = useState<MarketViewState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const res = await fetch(`/api/b2c/cases/${caseId}`);
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json();
        setState(body.state);
      }
    }
    poll();
    const interval = setInterval(() => {
      if (state && TERMINAL_STAGES.has(state.stage)) return;
      poll();
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, state?.stage]);

  if (!state) {
    return <div style={{ maxWidth: 760, margin: "0 auto", padding: "42px 40px", font: `400 15px ${SANS}`, color: SUB }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "42px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: STAGE_DOT_COLOR[state.stage] }} />
        <span style={{ font: `400 14.5px ${SANS}`, color: SUB }}>{state.label}</span>
      </div>

      {state.sellPriceMinor != null && (
        <div style={{ marginTop: 20 }}>
          <div style={{ font: `400 10.5px ${MONO}`, letterSpacing: ".14em", color: MUTE, textTransform: "uppercase" }}>Buyer pays</div>
          <div style={{ font: `500 34px ${SERIF}`, marginTop: 8, color: INK }}>₹{(state.sellPriceMinor / 100).toFixed(2)}</div>
        </div>
      )}

      {state.stage === "committed" && (
        <div style={{ marginTop: 24, padding: "20px 0", borderTop: `1px solid ${LINE}` }}>
          <div style={{ font: `400 11px ${MONO}`, letterSpacing: ".16em", color: MUTE }}>WHAT THE BUYER RECEIVES</div>
          <p style={{ font: `400 16px/1.75 ${SANS}`, color: SUB, marginTop: 10 }}>One promise, dated and certified. The supplier committed first — the certificate is the last thing created, not the first.</p>
        </div>
      )}

      {state.stage === "escalated" && (
        <div style={{ marginTop: 24, padding: "16px", border: `1px solid ${BAD}`, borderRadius: 8 }}>
          <div style={{ font: `600 14px ${SANS}`, color: BAD }}>This needs your attention</div>
          <p style={{ font: `400 14px/1.6 ${SANS}`, color: SUB, marginTop: 6 }}>{state.reason}</p>
        </div>
      )}

      {state.stage === "declined" && (
        <div style={{ marginTop: 24, font: `400 15px/1.7 ${SANS}`, color: SUB }}>The buyer did not accept this quote.</div>
      )}

      <div style={{ marginTop: 24, padding: "16px 0", borderTop: `1px solid ${LINE}` }}>
        <div style={{ font: `400 11px ${MONO}`, letterSpacing: ".16em", color: MUTE }}>BUYER LINK</div>
        <div style={{ font: `400 13px ${MONO}`, color: SUB, marginTop: 8, wordBreak: "break-all" }}>{buyerLink}</div>
      </div>

      <button onClick={onNewRequest} style={{ marginTop: 24, font: `500 13.5px ${SANS}`, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 18px", cursor: "pointer" }}>New request</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/market/LiveProgress.tsx
git commit -m "feat: add LiveProgress polling component"
```

---

### Task 12: `/market` page

**Files:**
- Create: `src/app/market/page.tsx`

- [ ] **Step 1: Implement**

Create `src/app/market/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Composer } from "./Composer";
import { LiveProgress } from "./LiveProgress";

export default function MarketPage() {
  const [active, setActive] = useState<{ caseId: string; buyerLink: string } | null>(null);

  if (active) {
    return <LiveProgress caseId={active.caseId} buyerLink={active.buyerLink} onNewRequest={() => setActive(null)} />;
  }
  return <Composer onCaseCreated={setActive} />;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors — this also confirms Composer's updated prop type lines up with page.tsx's usage.

- [ ] **Step 3: Manual smoke test**

```bash
export DATABASE_URL="file:./dev.db"
npm run dev
```

Open `http://localhost:3000/market`, paste a raw requirement, and confirm the composer flow renders (it won't complete a real request yet without seeded `SupplierOption` rows and real env vars — that's covered in Task 14's full walkthrough). Stop the dev server (Ctrl+C) once the page renders without a crash.

- [ ] **Step 4: Commit**

```bash
git add src/app/market/Composer.tsx src/app/market/page.tsx
git commit -m "feat: add /market page, wiring Composer to LiveProgress"
```

---

### Task 13: `/market/[caseId]/accept` buyer-facing page

**Files:**
- Create: `src/app/market/[caseId]/accept/page.tsx`

- [ ] **Step 1: Implement**

Create `src/app/market/[caseId]/accept/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { INK, SUB, GREEN, BAD, SANS, SERIF } from "../../styles";

export default function AcceptPage({ params }: { params: { caseId: string } }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [result, setResult] = useState<{ status: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function respond(response: "accept" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/b2c/cases/${params.caseId}/respond`, { method: "POST", body: JSON.stringify({ buyerToken: token, response }) });
      const body = await res.json();
      setResult(body.result);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: SUB }}>This link is missing its token.</div>;
  }

  if (result?.status === "invalid_or_expired") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: BAD }}>This link has expired or is no longer valid.</div>;
  }
  if (result?.status === "committed") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `500 21px/1.3 ${SERIF}`, color: INK }}>Confirmed — your order is committed.</div>;
  }
  if (result?.status === "cannot_commit") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: SUB }}>This quote has been declined.</div>;
  }
  if (result?.status === "escalated") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: BAD }}>Something went wrong completing your order — Novel's team has been notified.</div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px" }}>
      <h2 style={{ font: `500 27px/1.3 ${SERIF}`, color: INK, margin: 0 }}>Your quote from Novel</h2>
      <p style={{ font: `400 15px/1.7 ${SANS}`, color: SUB, marginTop: 12 }}>Review the quote sent to you and accept or decline below.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button disabled={busy} onClick={() => respond("accept")} style={{ font: `500 14px ${SANS}`, color: "#fff", background: GREEN, border: "none", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}>Accept</button>
        <button disabled={busy} onClick={() => respond("reject")} style={{ font: `500 14px ${SANS}`, background: "transparent", border: "1px solid #E4E2D9", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}>Decline</button>
      </div>
    </div>
  );
}
```

Note: `params.caseId` comes from this page's own dynamic route segment (`[caseId]`) and is threaded into the respond URL for a well-formed, readable request — even though (per Task 8) the case is actually resolved server-side from `buyerToken`, not the URL param. Confirm this against Task 8's implementation before writing this file.

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/market/[caseId]/accept/page.tsx"
git commit -m "feat: add buyer-facing accept/reject page"
```

---

### Task 14: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
export DATABASE_URL="file:./test.db"
npm test
```

Expected: 0 failures. Count should be the pre-existing 186 plus every new test file's count from Tasks 1–8 above.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
export DATABASE_URL="file:./dev.db"
npm run build
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Real end-to-end manual walkthrough**

This is the actual "the demo must be testable" check — a real LLM call, a real DB, a real browser.

```bash
export DATABASE_URL="file:./dev.db"
npx prisma migrate deploy
npx prisma studio &   # optional, to seed/inspect data visually
```

Seed at least one `SupplierOption` row for a SKU you'll test with (via Prisma Studio, or a one-off script). Set `.env.local` with real `OPENAI_API_KEY`, `OPENAI_MODEL_ID` (the model confirmed accessible earlier this session — check for the exact value used, since the project's API key was found to only have access to a non-default model), `OPENAI_REQUEST_TIMEOUT_MS=30000`, `BUYER_LINK_SIGNING_SECRET` (any random string), `APP_BASE_URL=http://localhost:3000`.

```bash
npm run dev
```

Walk through, in a real browser:
1. Open `/market`, paste a raw requirement matching your seeded SKU, submit.
2. Confirm real candidates appear.
3. Pick one, confirm a real negotiation brief appears (market note, opening price, walk-away price, levers).
4. Enter a negotiated price below the listed price, plus buyer name/phone, confirm.
5. Confirm the live progress view appears and shows "awaiting_buyer_response" with a real buyer link.
6. Open the buyer link in a second tab, click Accept.
7. Confirm the first tab's polling view updates to "committed" within ~5 seconds, without a page refresh.

- [ ] **Step 5: Report results**

Record: full test count and pass/fail, typecheck result, build result, and a plain description of what happened at each of the 7 walkthrough steps (including the exact real sell price, negotiation brief content, and any error encountered) — this is the artifact that proves "the demo is testable," not just that tests pass.

---

## Self-review notes

- **Spec coverage:** every piece named in `docs/superpowers/specs/2026-08-30-b2c-marketplace-frontend-design.md` has a task — the OpenAI client helper, the negotiation brief generator (Task 2), `deriveMarketState` (Task 3), all five route handlers (Tasks 4–8), fonts/palette (Task 9), the composer and live-progress components (Tasks 10–12), the buyer page (Task 13), and full verification (Task 14).
- **A gap caught while writing this plan, not before:** `parseB2CRequirement` never produces a catalog `sku`, only a free-text `itemDescription` — there is no fuzzy-matching step anywhere in the codebase, and building one is out of scope. Task 4 makes `sku` a required, separately-supplied field instead of silently assuming a matching step exists. Flagged to the user in the same turn this plan was written.
- **A design mistake caught during self-review, before any implementer would have seen it:** an earlier draft of Task 12 had `Composer` report only a `caseId` to its parent and separately tried to thread the buyer link through a module-level `let` variable — shared mutable state that breaks under concurrent requests. Fixed by having `Composer`'s `onCaseCreated` prop (Task 10) carry `{ caseId, buyerLink }` together from the start, since both values come back in the same `/api/b2c/cases` response anyway.
- **Placeholder scan:** no other TBDs; two tasks (6, 13) explicitly ask the implementer to confirm one real detail against already-built code (whether `createB2CCase` always throws `ToolError` vs. a plain `Error`; whether `[id]` is actually used server-side in the respond route) rather than asserting it blind — these are flagged, not guessed.
- **Type consistency:** `MarketViewState`/`MarketStage` (Task 3) are duplicated as a plain type literal in `LiveProgress.tsx` (Task 11) rather than imported, since client components can't import from `src/workflow/b2c/*` without bundling server-only Prisma types into the client — this is a deliberate boundary, not an oversight, and is safe because the route handler (Task 7) is the single place that actually calls `deriveMarketState` and serializes its result as JSON.
