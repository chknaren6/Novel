# CommitOS P0 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable CommitOS: six OpenAI-backed role agents behind a deterministic workflow that turn one buyer request into a receipted `committed`, `cannot_commit`, or `repaired` case, covering all three known-answer fixtures from `06-EVALUATION-AND-TEST-SPEC.md`.

**Architecture:** One Next.js (App Router, TypeScript) app in `app/`. Prisma + SQLite is the durable store (schema is Postgres-shaped so swapping to real Supabase later is a datasource change, not a rewrite). A `ModelGateway` interface has two implementations: `OpenAIModelGateway` (real calls, using the user-supplied `OPENAI_API_KEY`) and `FakeModelGateway` (deterministic, no network, used by the fast test suite) — this is the same swap point the spec reserves for the organizer's ApplyBee/Hive gateway. Stripe and Supabase Auth are mocked in-process (`StripeMockAdapter`, single seeded operator) since no real credentials were provided; both are named as explicit follow-ups, not silently dropped. Deterministic code (policy, state transitions, reservations, certificates, receipts) never depends on the LLM; role agents only ever *propose* — code decides.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Prisma + SQLite, Zod, `openai` SDK, Vitest.

**Deferred (not in this plan, call out explicitly when done):** real Supabase Postgres/Auth, real Stripe test-mode keys, production deployment, ROI/landing/GTM pages, submission evidence package generation, five validation interviews. These are P1/operational items from `07-` and `08-`, not P0 product behavior.

---

## Design notes carried into every task

- **Money** is integer minor units (paise), currency fixed to `"INR"`. **Quantities** are integers. All timestamps UTC.
- **Model-facing output is a subset of `DomainDecision`.** The model (real or fake) only ever returns `RoleModelOutput` (`decision`, `constraints`, `reservationRequests`, `counterterms`, `evidenceRefs`, `explanation`). Code fills in `decisionId`, `caseId`, `caseVersion`, `termsHash`, `role`, `expiresAt` — the model can never invent an id, version, hash, or date. This matches "Every other field is machine-validated" in `03-AGENT-ARCHITECTURE.md`.
- **Roles invoke their own scoped hold tool.** Per `05-TOOL-CONTRACTS.md` ("during its bounded run"), `ModelGateway.runRole()` runs a real one-round tool-calling loop: the model may call at most one mutation tool (its own scoped hold), executed server-side, before producing its final structured decision. `FakeModelGateway` runs the *same* tool-execution code, deciding which tool to call with simple deterministic rules instead of an LLM call, so both gateways exercise identical server-side hold logic.
- **Only the coordinator mints/consumes/breaks/compensates certificates.** Roles never get those tools.
- **Test strategy:** pure policy/state logic gets fast Vitest unit tests with no DB. DB-touching code (adapters, coordinator, workflow handlers) gets Vitest integration tests against a throwaway SQLite file reset per test file. UI gets smoke render tests only — the correctness burden lives in the layers below it.

---

## Task list (33 tasks)

1. Scaffold Next.js + TypeScript + Vitest + Prisma + env files
2. Shared enums, types, and Zod schemas
3. Money, hash, and id helpers
4. Prisma schema, migration, db client
5. Case event log helper
6. Deterministic economics engine
7. Credit policy engine
8. Case status transition guard
9. Reservation and certificate lifecycle guards
10. Idempotency key derivation
11. Inventory hold adapter
12. Supplier option hold adapter
13. Logistics delivery-slot hold adapter
14. Credit envelope hold
15. Action receipt helper
16. Commit-side effect adapters (sandbox ERP/CRM, Stripe mock, outbox)
17. Reservation coordinator: prepare / commit / abort
18. Reservation coordinator: break / compensate / verify
19. ModelGateway interface, RoleModelOutput schema, FakeModelGateway
20. OpenAI-backed ModelGateway
21. Role tool permissions and read tools
22. Role configs and role runtime
23. Fixture world-state and seed script
24. Workflow: `deal.submitted` (initial evaluation) — includes buyer link signing and `create_counteroffer`
25. Workflow: commit (`commitOrder`) — reusable by any `prepared` case
26. Workflow: buyer response — reruns all roles, mints certificate, then calls Task 25's commit
27. Workflow: supplier disruption and repair
28. Case 2 (stale supplier hold) integration test
29. Case API + Protected Promise API routes
30. Buyer API routes
31. Evaluation runner script (3 cases × 3 runs)
32. Operator UI
33. Buyer UI

Tasks 1–23 have no UI and no LLM network dependency (Task 20's real network call is smoke-tested separately from its unit-level contract). Tasks 24–28 are where the three known-answer cases actually start passing end to end. Do not skip ahead — later tasks assume earlier ones are green.

---

### Task 1: Scaffold Next.js + TypeScript + Vitest + Prisma + env files

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/next.config.mjs`
- Create: `app/.gitignore`
- Create: `app/.env.example`
- Create: `app/.env.local`
- Create: `app/vitest.config.ts`
- Create: `app/src/app/layout.tsx`
- Create: `app/src/app/page.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "commitos",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "seed": "tsx prisma/seed.ts",
    "evaluate": "tsx scripts/evaluate.ts"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@prisma/client": "5.18.0",
    "zod": "3.23.8",
    "openai": "4.56.0"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "@types/node": "20.14.15",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "prisma": "5.18.0",
    "vitest": "2.0.5",
    "tsx": "4.16.5",
    "dotenv": "16.4.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd app && npm install`
Expected: `node_modules/` created, lockfile written, no errors.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 5: Create `.gitignore`**

```text
node_modules/
.next/
dev.db
dev.db-journal
test-*.db
test-*.db-journal
.env.local
*.tsbuildinfo
submission/
```

- [ ] **Step 6: Create `.env.example` (names only, per `02-TECHNICAL-SPEC.md` — never commit real values here)**

```text
DATABASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL_ID=
OPENAI_REQUEST_TIMEOUT_MS=
APP_BASE_URL=
BUYER_LINK_SIGNING_SECRET=
MODEL_GATEWAY=
```

- [ ] **Step 7: Create `.env.local` with real local values**

```text
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY="<REDACTED — set your real key directly in app/.env.local, never commit it or paste it into this plan>"
OPENAI_MODEL_ID="gpt-4o-mini"
OPENAI_REQUEST_TIMEOUT_MS="20000"
APP_BASE_URL="http://localhost:3000"
BUYER_LINK_SIGNING_SECRET="local-dev-signing-secret-change-me"
MODEL_GATEWAY="openai"
```

`.gitignore` already excludes `.env.local`. Confirm before any commit: `git status` must never show this file as staged.

- [ ] **Step 8: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
```

- [ ] **Step 9: Create minimal Next.js app shell**

`src/app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:

```tsx
export default function HomePage() {
  return <main>CommitOS — scaffold boots.</main>;
}
```

- [ ] **Step 10: Verify the app boots**

Run: `cd app && npm run dev` (then Ctrl+C once you see "Ready")
Expected: dev server starts on port 3000 with no compile errors.

- [ ] **Step 11: Commit**

```bash
cd app
git add package.json package-lock.json tsconfig.json next.config.mjs .gitignore .env.example vitest.config.ts src/app/layout.tsx src/app/page.tsx
git commit -m "chore: scaffold Next.js + TypeScript + Vitest + Prisma deps"
```

Do not stage `.env.local` — it is gitignored and holds the real API key.

---

### Task 2: Shared enums, types, and Zod schemas

**Files:**
- Create: `app/src/lib/types.ts`
- Test: `app/src/lib/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/types.test.ts
import { describe, it, expect } from "vitest";
import { RoleModelOutputSchema, DomainDecisionSchema, RoleIdSchema } from "./types";

describe("RoleIdSchema", () => {
  it("accepts the six locked roles and rejects others", () => {
    for (const role of ["sales", "finance", "inventory", "procurement", "logistics", "risk"]) {
      expect(RoleIdSchema.parse(role)).toBe(role);
    }
    expect(() => RoleIdSchema.parse("marketing")).toThrow();
  });
});

describe("RoleModelOutputSchema", () => {
  it("accepts a minimal valid model output", () => {
    const parsed = RoleModelOutputSchema.parse({
      decision: "approve",
      constraints: [],
      reservationRequests: [],
      counterterms: [],
      evidenceRefs: ["EVID-1"],
      explanation: "Stock covers the request.",
    });
    expect(parsed.decision).toBe("approve");
  });

  it("rejects a decision value outside the enum", () => {
    expect(() =>
      RoleModelOutputSchema.parse({
        decision: "maybe",
        constraints: [],
        reservationRequests: [],
        counterterms: [],
        evidenceRefs: [],
        explanation: "",
      }),
    ).toThrow();
  });
});

describe("DomainDecisionSchema", () => {
  it("extends RoleModelOutput with server-assigned identity fields", () => {
    const parsed = DomainDecisionSchema.parse({
      decisionId: "DEC-1",
      caseId: "CASE-1",
      caseVersion: 1,
      termsHash: "hash-1",
      role: "finance",
      decision: "veto",
      constraints: [
        { domain: "finance", code: "CREDIT_POLICY_BREACH", severity: "blocking", message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-2"] },
      ],
      reservationRequests: [],
      counterterms: [{ field: "payment_terms", proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
      evidenceRefs: ["EVID-2"],
      expiresAt: new Date().toISOString(),
      explanation: "Net-60 breaches credit policy; 30% advance is within policy.",
    });
    expect(parsed.role).toBe("finance");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/types.test.ts`
Expected: FAIL — `./types` has no exported member (module doesn't exist yet).

- [ ] **Step 3: Write `src/lib/types.ts`**

```typescript
import { z } from "zod";

export const RoleIdSchema = z.enum([
  "sales",
  "finance",
  "inventory",
  "procurement",
  "logistics",
  "risk",
]);
export type RoleId = z.infer<typeof RoleIdSchema>;

export const DecisionSchema = z.enum(["approve", "counter", "veto", "unavailable"]);
export type Decision = z.infer<typeof DecisionSchema>;

export const ReservationDomainSchema = z.enum(["credit", "inventory", "supplier", "logistics"]);
export type ReservationDomain = z.infer<typeof ReservationDomainSchema>;

export const ReservationStatusSchema = z.enum([
  "requested",
  "held",
  "committed",
  "released",
  "expired",
  "failed",
]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const CertificateStatusSchema = z.enum([
  "draft",
  "valid",
  "consumed",
  "broken",
  "compensated",
  "superseded",
]);
export type CertificateStatus = z.infer<typeof CertificateStatusSchema>;

export const ReceiptStatusSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "compensation_pending",
  "compensated",
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const ReceiptProviderSchema = z.enum([
  "sandbox_erp",
  "sandbox_crm",
  "inventory",
  "supplier",
  "logistics",
  "stripe",
  "outbox",
]);
export type ReceiptProvider = z.infer<typeof ReceiptProviderSchema>;

export const CaseStatusSchema = z.enum([
  "intake",
  "evaluating",
  "negotiating",
  "prepared",
  "committing",
  "committed",
  "cannot_commit",
  "aborting",
  "repair_needed",
  "compensating",
  "repaired",
  "escalated",
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const PaymentTermsSchema = z.enum(["NET_60", "ADVANCE_30", "OTHER_BOUNDED"]);
export type PaymentTerms = z.infer<typeof PaymentTermsSchema>;

export const TermsSourceSchema = z.enum([
  "buyer_request",
  "sales_normalization",
  "counteroffer",
  "buyer_acceptance",
  "repair",
]);
export type TermsSource = z.infer<typeof TermsSourceSchema>;

export const CounterofferStatusSchema = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);
export type CounterofferStatus = z.infer<typeof CounterofferStatusSchema>;

export const ToolErrorCodeSchema = z.enum([
  "FORBIDDEN_TOOL",
  "STALE_CASE_VERSION",
  "TERMS_HASH_MISMATCH",
  "RESOURCE_UNAVAILABLE",
  "POLICY_VIOLATION",
  "RESERVATION_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "PROVIDER_UNAVAILABLE",
  "INVALID_INPUT",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export class ToolError extends Error {
  code: ToolErrorCode;
  retryable: boolean;
  evidenceRefs: string[];
  constructor(code: ToolErrorCode, message: string, retryable: boolean, evidenceRefs: string[] = []) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.evidenceRefs = evidenceRefs;
  }
}

const ConstraintFindingSchema = z.object({
  domain: RoleIdSchema,
  code: z.string(),
  severity: z.enum(["info", "blocking"]),
  message: z.string(),
  evidenceRefs: z.array(z.string()),
});
export type ConstraintFinding = z.infer<typeof ConstraintFindingSchema>;

const ReservationRequestSchema = z.object({
  domain: ReservationDomainSchema,
  resourceRef: z.string(),
  quantity: z.number().int().nullable(),
  limitMinor: z.number().int().nullable(),
  ttlSeconds: z.number().int().positive(),
});
export type ReservationRequest = z.infer<typeof ReservationRequestSchema>;

const CountertermSchema = z.object({
  field: z.enum(["payment_terms", "quantity", "delivery_deadline", "discount_bps"]),
  proposedValue: z.string(),
  rationale: z.string(),
});
export type Counterterm = z.infer<typeof CountertermSchema>;

// What a role agent (real or fake) is allowed to produce. Every other DomainDecision
// field is assigned by server code, never trusted from the model.
export const RoleModelOutputSchema = z.object({
  decision: DecisionSchema,
  constraints: z.array(ConstraintFindingSchema),
  reservationRequests: z.array(ReservationRequestSchema),
  counterterms: z.array(CountertermSchema),
  evidenceRefs: z.array(z.string()),
  explanation: z.string(),
});
export type RoleModelOutput = z.infer<typeof RoleModelOutputSchema>;

export const DomainDecisionSchema = RoleModelOutputSchema.extend({
  decisionId: z.string(),
  caseId: z.string(),
  caseVersion: z.number().int(),
  termsHash: z.string(),
  role: RoleIdSchema,
  expiresAt: z.string(),
});
export type DomainDecision = z.infer<typeof DomainDecisionSchema>;

export interface DealTerms {
  sku: string;
  quantity: number;
  currency: "INR";
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: PaymentTerms;
  deliveryDeadline: string;
}

export interface Evidence<T> {
  evidenceId: string;
  observedAt: string;
  source: string;
  data: T;
}

export interface MutationReceipt<T> {
  receiptId: string;
  idempotencyKey: string;
  status: "succeeded" | "failed";
  providerRef: string | null;
  occurredAt: string;
  data: T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/types.test.ts
git commit -m "feat: shared enums, DomainDecision, and RoleModelOutput schemas"
```

---

### Task 3: Money, hash, and id helpers

**Files:**
- Create: `app/src/lib/money.ts`
- Create: `app/src/lib/hash.ts`
- Create: `app/src/lib/ids.ts`
- Test: `app/src/lib/money.test.ts`
- Test: `app/src/lib/hash.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/money.test.ts
import { describe, it, expect } from "vitest";
import { rupeesToMinor, bpsOf, applyDiscountBps } from "./money";

describe("money helpers", () => {
  it("converts whole rupees to minor units", () => {
    expect(rupeesToMinor(1_470_000)).toBe(147_000_000);
  });

  it("computes basis points of a minor-unit amount, rounding down", () => {
    expect(bpsOf(147_000_000, 1000)).toBe(14_700_000); // 10% of ₹14.7L
  });

  it("applies a discount in basis points", () => {
    expect(applyDiscountBps(147_000_000, 1000)).toBe(147_000_000 - 14_700_000);
  });
});
```

```typescript
// src/lib/hash.ts test
// src/lib/hash.test.ts
import { describe, it, expect } from "vitest";
import { canonicalTermsHash, signBuyerToken, hashBuyerToken } from "./hash";

describe("canonicalTermsHash", () => {
  it("is stable for the same terms regardless of key order", () => {
    const a = canonicalTermsHash({
      sku: "MAT-10001",
      quantity: 350,
      totalValueMinor: 147_000_000,
      discountBps: 1000,
      paymentTerms: "NET_60",
      deliveryDeadline: "2026-09-12T00:00:00.000Z",
    });
    const b = canonicalTermsHash({
      deliveryDeadline: "2026-09-12T00:00:00.000Z",
      paymentTerms: "NET_60",
      discountBps: 1000,
      totalValueMinor: 147_000_000,
      quantity: 350,
      sku: "MAT-10001",
    });
    expect(a).toBe(b);
  });

  it("changes when a material field changes", () => {
    const base = { sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60" as const, deliveryDeadline: "2026-09-12T00:00:00.000Z" };
    const changed = canonicalTermsHash({ ...base, paymentTerms: "ADVANCE_30" });
    expect(canonicalTermsHash(base)).not.toBe(changed);
  });
});

describe("buyer token signing", () => {
  it("hashes a signed token deterministically for the same secret", () => {
    const secret = "test-secret";
    const token = signBuyerToken("offer-123", secret);
    expect(hashBuyerToken(token)).toBe(hashBuyerToken(token));
  });

  it("produces different tokens for different offers", () => {
    const secret = "test-secret";
    expect(signBuyerToken("offer-1", secret)).not.toBe(signBuyerToken("offer-2", secret));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/money.test.ts src/lib/hash.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `src/lib/money.ts`**

```typescript
// All money is integer minor units (paise). Never use floating point for currency.
export function rupeesToMinor(rupees: number): number {
  return Math.round(rupees * 100);
}

export function bpsOf(amountMinor: number, bps: number): number {
  return Math.floor((amountMinor * bps) / 10_000);
}

export function applyDiscountBps(amountMinor: number, discountBps: number): number {
  return amountMinor - bpsOf(amountMinor, discountBps);
}
```

- [ ] **Step 4: Write `src/lib/hash.ts`**

```typescript
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PaymentTerms } from "./types";

export interface CanonicalTermsInput {
  sku: string;
  quantity: number;
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: PaymentTerms;
  deliveryDeadline: string;
}

// Canonical hash of every field that affects a promise. A certificate and every
// reservation it covers must reference the same hash (04-DATA-AND-STATE-SPEC.md).
export function canonicalTermsHash(terms: CanonicalTermsInput): string {
  const canonical = JSON.stringify({
    sku: terms.sku,
    quantity: terms.quantity,
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    paymentTerms: terms.paymentTerms,
    deliveryDeadline: terms.deliveryDeadline,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function certificateHash(input: { caseId: string; termsHash: string; reservationIds: string[] }): string {
  const canonical = JSON.stringify({
    caseId: input.caseId,
    termsHash: input.termsHash,
    reservationIds: [...input.reservationIds].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// Buyer tokens are random and signed; only the hash is ever persisted (spec: "Buyer
// tokens are stored as hashes"). The signature lets us reject a tampered token before
// even hitting the database.
export function signBuyerToken(offerId: string, secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${offerId}.${nonce}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyBuyerToken(token: string, secret: string): { offerId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [offerId, nonce, signature] = parts;
  const expected = createHmac("sha256", secret).update(`${offerId}.${nonce}`).digest("hex");
  if (expected.length !== signature.length) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return null;
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  if (!timingSafeEqual(a, b)) return null;
  return { offerId };
}

export function hashBuyerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 5: Write `src/lib/ids.ts`**

```typescript
import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/money.test.ts src/lib/hash.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/lib/hash.ts src/lib/hash.test.ts src/lib/ids.ts
git commit -m "feat: money, canonical terms hash, and buyer token signing helpers"
```

---

### Task 4: Prisma schema, migration, db client

**Files:**
- Create: `app/prisma/schema.prisma`
- Create: `app/src/lib/db.ts`

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Company {
  id        String     @id @default(uuid())
  name      String
  createdAt DateTime   @default(now())
  customers Customer[]
  cases     DealCase[]
}

model Operator {
  id    String @id @default(uuid())
  email String @unique
  name  String
}

model Customer {
  id                      String   @id @default(uuid())
  companyId               String
  company                 Company  @relation(fields: [companyId], references: [id])
  name                    String
  creditLimitMinor        Int
  currentExposureMinor    Int
  overdueReceivablesMinor Int
  allowedPaymentTerms     Json
  policyVersion           String
}

model InventoryPosition {
  id                 String    @id @default(uuid())
  sku                String
  warehouseId        String
  availableQuantity  Int
  earliestHoldExpiry DateTime?
}

model SupplierOption {
  id                String @id @default(uuid())
  supplierId        String
  sku               String
  availableQuantity Int
  unitCostMinor     Int
  leadDays          Int
  optionTtlSeconds  Int
  status            String
}

model DeliveryPlanOption {
  id                String   @id @default(uuid())
  planId            String   @unique
  originWarehouseId String
  destinationId     String
  deliveredQuantity Int
  deliveryDate      DateTime
  costMinor         Int
  splitShipment     Boolean
  capacityRemaining Int
}

model DealCase {
  id                 String              @id @default(uuid())
  companyId          String
  company            Company             @relation(fields: [companyId], references: [id])
  customerId         String
  fixtureId          String?
  activeTermsVersion Int
  status             String
  createdBy          String
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  termsVersions      TermsVersion[]
  decisions          DomainDecision[]
  reservations       Reservation[]
  certificates       CommitCertificate[]
  receipts           ActionReceipt[]
  events             CaseEvent[]
  counteroffers      Counteroffer[]
}

model TermsVersion {
  id               String   @id @default(uuid())
  caseId           String
  case             DealCase @relation(fields: [caseId], references: [id])
  version          Int
  parentVersion    Int?
  source           String
  termsHash        String
  sku              String
  quantity         Int
  currency         String   @default("INR")
  totalValueMinor  Int
  discountBps      Int
  paymentTerms     String
  deliveryDeadline DateTime
  createdAt        DateTime @default(now())

  @@unique([caseId, version])
}

model DomainDecision {
  id               String   @id @default(uuid())
  caseId           String
  case             DealCase @relation(fields: [caseId], references: [id])
  caseVersion      Int
  termsHash        String
  role             String
  decision         String
  payload          Json
  evidenceRefs     Json
  expiresAt        DateTime
  modelId          String
  gatewayRequestId String?
  traceId          String
  createdAt        DateTime @default(now())
}

model Reservation {
  id             String   @id @default(uuid())
  caseId         String
  case           DealCase @relation(fields: [caseId], references: [id])
  caseVersion    Int
  termsHash      String
  domain         String
  resourceRef    String
  quantityMinor  Int?
  limitMinor     Int?
  status         String
  policyVersion  String
  expiresAt      DateTime
  idempotencyKey String   @unique
  receiptId      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model CommitCertificate {
  id                      String    @id @default(uuid())
  caseId                  String
  case                    DealCase  @relation(fields: [caseId], references: [id])
  caseVersion             Int
  termsHash               String
  reservationIds          Json
  policyVersions          Json
  validUntil              DateTime
  status                  String
  supersedesCertificateId String?
  certificateHash         String
  createdAt               DateTime  @default(now())
  consumedAt              DateTime?
  brokenAt                DateTime?
}

model ActionReceipt {
  id                 String   @id @default(uuid())
  caseId             String
  case               DealCase @relation(fields: [caseId], references: [id])
  caseVersion        Int
  actionType         String
  resourceRef        String
  idempotencyKey     String   @unique
  requestHash        String
  status             String
  provider           String
  providerReceiptRef String?
  responsePayload    Json
  attemptCount       Int      @default(1)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model CaseEvent {
  id          String   @id @default(uuid())
  caseId      String
  case        DealCase @relation(fields: [caseId], references: [id])
  sequence    Int
  eventType   String
  caseVersion Int
  actorType   String
  actorRef    String
  payload     Json
  traceId     String
  createdAt   DateTime @default(now())

  @@unique([caseId, sequence])
}

model Counteroffer {
  id                   String    @id @default(uuid())
  caseId               String
  case                 DealCase  @relation(fields: [caseId], references: [id])
  sourceTermsVersion   Int
  proposedTermsVersion Int
  tokenHash            String    @unique
  status               String
  expiresAt            DateTime
  respondedAt          DateTime?
  createdAt            DateTime  @default(now())
}

// Sandbox "production-shaped" adapters (02-TECHNICAL-SPEC.md "Sandbox ERP/CRM,
// supplier, and logistics adapters backed by Postgres tables"). These are commit-side
// effects, distinct from the reservation tables above.
model SandboxOrder {
  id              String   @id @default(uuid())
  caseId          String
  certificateId   String
  sku             String
  quantity        Int
  totalValueMinor Int
  status          String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model CrmStageEvent {
  id        String   @id @default(uuid())
  caseId    String
  stage     String
  note      String
  createdAt DateTime @default(now())
}

model StripeCheckoutMock {
  id              String   @id @default(uuid())
  caseId          String
  certificateId   String
  amountMinor     Int
  status          String
  stripeSessionId String   @unique
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model OutboxMessage {
  id            String   @id @default(uuid())
  caseId        String
  messageType   String
  certificateId String?
  correctsId    String?
  payload       Json
  createdAt     DateTime @default(now())
}
```

- [ ] **Step 2: Generate the client and run the first migration**

Run: `cd app && npx prisma migrate dev --name init`
Expected: `dev.db` created, migration applied, "Your database is now in sync with your schema."

- [ ] **Step 3: Write `src/lib/db.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 4: Verify the client compiles against the schema**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/db.ts
git commit -m "feat: Prisma schema for case, terms, decision, reservation, certificate, receipt, event, counteroffer"
```

---

### Task 5: Test database helper and case event log

Every task from here on that touches the database uses a second SQLite file (`test.db`) so tests never depend on or corrupt `dev.db`.

**Files:**
- Create: `app/src/lib/testDb.ts`
- Create: `app/src/workflow/events.ts`
- Test: `app/src/workflow/events.test.ts`

- [ ] **Step 1: Push the schema to a dedicated test database**

Run: `cd app && DATABASE_URL="file:./test.db" npx prisma db push --skip-generate --accept-data-loss`
Expected: "Your database is now in sync with your schema." Re-run this command any time `schema.prisma` changes.

- [ ] **Step 2: Write `src/lib/testDb.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

// A second Prisma client pointed at test.db, independent of the dev singleton in db.ts,
// so the test suite never touches dev.db.
export const testDb = new PrismaClient({
  datasources: { db: { url: "file:./test.db" } },
});

export async function resetTestDb() {
  await testDb.$transaction([
    testDb.outboxMessage.deleteMany(),
    testDb.stripeCheckoutMock.deleteMany(),
    testDb.crmStageEvent.deleteMany(),
    testDb.sandboxOrder.deleteMany(),
    testDb.caseEvent.deleteMany(),
    testDb.actionReceipt.deleteMany(),
    testDb.reservation.deleteMany(),
    testDb.commitCertificate.deleteMany(),
    testDb.counteroffer.deleteMany(),
    testDb.domainDecision.deleteMany(),
    testDb.termsVersion.deleteMany(),
    testDb.dealCase.deleteMany(),
    testDb.deliveryPlanOption.deleteMany(),
    testDb.supplierOption.deleteMany(),
    testDb.inventoryPosition.deleteMany(),
    testDb.customer.deleteMany(),
    testDb.company.deleteMany(),
    testDb.operator.deleteMany(),
  ]);
}
```

- [ ] **Step 3: Write the failing test for the event log**

```typescript
// src/workflow/events.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { emitCaseEvent } from "./events";

describe("emitCaseEvent", () => {
  beforeEach(resetTestDb);

  it("assigns a strictly increasing sequence per case", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });

    const first = await emitCaseEvent(testDb, {
      caseId: dealCase.id,
      eventType: "deal.submitted",
      caseVersion: 1,
      actorType: "operator",
      actorRef: "seed",
      payload: { note: "first" },
      traceId: "trace-1",
    });
    const second = await emitCaseEvent(testDb, {
      caseId: dealCase.id,
      eventType: "finance.decided",
      caseVersion: 1,
      actorType: "agent",
      actorRef: "finance",
      payload: { note: "second" },
      traceId: "trace-1",
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
  });

  it("keeps sequences independent across cases", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const caseA = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "C-A", activeTermsVersion: 1, status: "intake", createdBy: "seed" } });
    const caseB = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "C-B", activeTermsVersion: 1, status: "intake", createdBy: "seed" } });

    const a1 = await emitCaseEvent(testDb, { caseId: caseA.id, eventType: "deal.submitted", caseVersion: 1, actorType: "operator", actorRef: "seed", payload: {}, traceId: "t" });
    const b1 = await emitCaseEvent(testDb, { caseId: caseB.id, eventType: "deal.submitted", caseVersion: 1, actorType: "operator", actorRef: "seed", payload: {}, traceId: "t" });

    expect(a1.sequence).toBe(1);
    expect(b1.sequence).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npx vitest run src/workflow/events.test.ts`
Expected: FAIL — `./events` does not exist.

- [ ] **Step 5: Write `src/workflow/events.ts`**

```typescript
import type { PrismaClient, Prisma } from "@prisma/client";

export interface EmitCaseEventInput {
  caseId: string;
  eventType: string;
  caseVersion: number;
  actorType: "operator" | "buyer" | "agent" | "coordinator" | "adapter" | "scheduler";
  actorRef: string;
  payload: Record<string, unknown>;
  traceId: string;
}

// Client here can be `db`, `testDb`, or a `$transaction` callback client — every caller
// runs this inside the same transaction as the state mutation it is logging, so the
// event log and the state it describes are always consistent.
type Db = PrismaClient | Prisma.TransactionClient;

// `sequence` is unique per case and provides the stable evidence timeline
// (04-DATA-AND-STATE-SPEC.md). Computed as max(sequence)+1 inside the caller's
// transaction so concurrent writers to different cases never contend.
export async function emitCaseEvent(db: Db, input: EmitCaseEventInput) {
  const last = await db.caseEvent.findFirst({
    where: { caseId: input.caseId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  return db.caseEvent.create({
    data: {
      caseId: input.caseId,
      sequence,
      eventType: input.eventType,
      caseVersion: input.caseVersion,
      actorType: input.actorType,
      actorRef: input.actorRef,
      payload: input.payload as Prisma.InputJsonValue,
      traceId: input.traceId,
    },
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/workflow/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/testDb.ts src/workflow/events.ts src/workflow/events.test.ts
git commit -m "feat: test database helper and per-case sequential event log"
```

---

### Task 6: Deterministic economics engine

This is the `calculate_deal_economics` deterministic tool from `05-TOOL-CONTRACTS.md`. The model never computes money; this is the only place revenue, cost, margin, and deposit are calculated.

**Note on the fixture numbers below:** the worked example is now drawn from real ERP rows in `/Users/eidoviscontact/Documents/Novel/Data/*.csv` rather than an invented fixture. `MAT-10001` ("Schneider Electric MCB 32A") has `MARA.NETPR = 4200` rupees/unit; at a 350-unit order that is `totalValueMinor = 350 × 4200 × 100 = 147_000_000`. `depositMinor = round(totalValueMinor * 0.30) = 44_100_000` (₹4.41L). The per-unit cost is `MBEW.STPRS = 2933.12` rupees for `MAT-10001`, i.e. `unitCostMinor = 293_312`, which this engine (revenue taken as `totalValueMinor` before backing out a list price, not net-of-discount) computes to a contribution margin of `30.16%` — comfortably above `MBEW.FLOOR_MARGIN = 0.1774` (the 17.74% floor) for this SKU. Every figure below is independently reproducible from those CSV rows; none are staged.

**Files:**
- Create: `app/src/policy/economics.ts`
- Test: `app/src/policy/economics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/policy/economics.test.ts
import { describe, it, expect } from "vitest";
import { calculateDealEconomics } from "./economics";

describe("calculateDealEconomics", () => {
  it("matches the Case 1 fixture: 350 units of MAT-10001 at real ERP pricing, 10% discount, 30% deposit", () => {
    const result = calculateDealEconomics({
      totalValueMinor: 147_000_000, // 350 x MARA.NETPR (Rs 4,200) x 100
      discountBps: 1000,
      quantity: 350,
      unitCostMinor: 293_312, // MBEW.STPRS for MAT-10001 (Rs 2,933.12)
      paymentTerms: "ADVANCE_30",
      depositBps: 3000,
    });

    expect(result.revenueMinor).toBe(147_000_000);
    expect(result.depositMinor).toBe(44_100_000); // Rs 4,41,000 = Rs 4.41L
    expect(result.costMinor).toBe(102_659_200);
    expect(result.contributionMinor).toBe(44_340_800);
    expect(result.contributionMarginBps).toBeGreaterThan(1774); // above the 17.74% MBEW.FLOOR_MARGIN floor
    expect(result.creditExposureMinor).toBe(147_000_000 - 44_100_000);
  });

  it("exposes full revenue as credit exposure under NET_60 (no deposit reduces it)", () => {
    const result = calculateDealEconomics({
      totalValueMinor: 147_000_000,
      discountBps: 1000,
      quantity: 350,
      unitCostMinor: 293_312,
      paymentTerms: "NET_60",
      depositBps: 0,
    });
    expect(result.creditExposureMinor).toBe(147_000_000);
    expect(result.depositMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/policy/economics.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/policy/economics.ts`**

```typescript
import type { PaymentTerms } from "@/lib/types";

export interface DealEconomicsInput {
  totalValueMinor: number;
  discountBps: number;
  quantity: number;
  unitCostMinor: number;
  paymentTerms: PaymentTerms;
  depositBps: number;
}

export interface DealEconomics {
  revenueMinor: number;
  listPriceMinor: number;
  discountCostMinor: number;
  costMinor: number;
  contributionMinor: number;
  contributionMarginBps: number;
  depositMinor: number;
  creditExposureMinor: number;
}

// The sole source of truth for money. Neither role agents nor the UI recompute these
// figures; every consumer reads this output (05-TOOL-CONTRACTS.md: "The model supplies
// no calculated totals").
export function calculateDealEconomics(input: DealEconomicsInput): DealEconomics {
  const revenueMinor = input.totalValueMinor;
  const listPriceMinor = Math.round(revenueMinor / (1 - input.discountBps / 10_000));
  const discountCostMinor = listPriceMinor - revenueMinor;
  const costMinor = input.unitCostMinor * input.quantity;
  const contributionMinor = revenueMinor - costMinor;
  const contributionMarginBps =
    revenueMinor === 0 ? 0 : Math.round((contributionMinor * 10_000) / revenueMinor);
  const depositMinor = Math.round((revenueMinor * input.depositBps) / 10_000);
  const creditExposureMinor =
    input.paymentTerms === "NET_60" ? revenueMinor : revenueMinor - depositMinor;

  return {
    revenueMinor,
    listPriceMinor,
    discountCostMinor,
    costMinor,
    contributionMinor,
    contributionMarginBps,
    depositMinor,
    creditExposureMinor,
  };
}

// Per-SKU unit cost is a policy/fixture constant, not user input — it lives here next
// to the engine that consumes it rather than threaded through every API call.
// Task 23 documents how 293_312 (MBEW.STPRS) was chosen for MAT-10001.
export const SKU_UNIT_COST_MINOR: Record<string, number> = {
  "MAT-10001": 293_312,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/policy/economics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/policy/economics.ts src/policy/economics.test.ts
git commit -m "feat: deterministic deal economics engine"
```

---

### Task 7: Credit policy engine

**Files:**
- Create: `app/src/policy/credit.ts`
- Test: `app/src/policy/credit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/policy/credit.test.ts
import { describe, it, expect } from "vitest";
import { evaluateCreditPolicy } from "./credit";

const baseCustomer = {
  creditLimitMinor: 200_000_000, // Rs 20L (KNKK.KLIMK for CUST-1010 = 2,000,000 rupees)
  currentExposureMinor: 0,
  overdueReceivablesMinor: 0,
  allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"],
};

describe("evaluateCreditPolicy", () => {
  it("rejects NET_60 when it is not in the customer's allowed terms", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      paymentTerms: "NET_60",
      newExposureMinor: 147_000_000,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("PAYMENT_TERMS_NOT_ALLOWED");
  });

  it("approves ADVANCE_30 when the reduced exposure fits inside the credit limit", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      paymentTerms: "ADVANCE_30",
      newExposureMinor: 102_900_000, // 147L total minus 44.1L deposit
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBe("WITHIN_POLICY");
    expect(result.headroomMinor).toBe(200_000_000 - 102_900_000);
  });

  it("rejects when overdue receivables exist regardless of exposure", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      overdueReceivablesMinor: 1,
      paymentTerms: "ADVANCE_30",
      newExposureMinor: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("OVERDUE_RECEIVABLES_BLOCK");
  });

  it("rejects when exposure would exceed the credit limit", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      paymentTerms: "ADVANCE_30",
      newExposureMinor: 250_000_000,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("CREDIT_LIMIT_EXCEEDED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/policy/credit.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/policy/credit.ts`**

```typescript
import type { PaymentTerms } from "@/lib/types";

export interface CreditPolicyInput {
  creditLimitMinor: number;
  currentExposureMinor: number;
  overdueReceivablesMinor: number;
  allowedPaymentTerms: string[];
  paymentTerms: PaymentTerms;
  newExposureMinor: number; // DealEconomics.creditExposureMinor for the proposed terms
}

export type CreditPolicyCode =
  | "WITHIN_POLICY"
  | "PAYMENT_TERMS_NOT_ALLOWED"
  | "CREDIT_LIMIT_EXCEEDED"
  | "OVERDUE_RECEIVABLES_BLOCK";

export interface CreditPolicyResult {
  passed: boolean;
  code: CreditPolicyCode;
  totalExposureMinor: number;
  headroomMinor: number;
}

export function evaluateCreditPolicy(input: CreditPolicyInput): CreditPolicyResult {
  if (input.overdueReceivablesMinor > 0) {
    return {
      passed: false,
      code: "OVERDUE_RECEIVABLES_BLOCK",
      totalExposureMinor: input.currentExposureMinor,
      headroomMinor: input.creditLimitMinor - input.currentExposureMinor,
    };
  }
  if (!input.allowedPaymentTerms.includes(input.paymentTerms)) {
    return {
      passed: false,
      code: "PAYMENT_TERMS_NOT_ALLOWED",
      totalExposureMinor: input.currentExposureMinor,
      headroomMinor: input.creditLimitMinor - input.currentExposureMinor,
    };
  }
  const totalExposureMinor = input.currentExposureMinor + input.newExposureMinor;
  const headroomMinor = input.creditLimitMinor - totalExposureMinor;
  if (headroomMinor < 0) {
    return { passed: false, code: "CREDIT_LIMIT_EXCEEDED", totalExposureMinor, headroomMinor };
  }
  return { passed: true, code: "WITHIN_POLICY", totalExposureMinor, headroomMinor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/policy/credit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/policy/credit.ts src/policy/credit.test.ts
git commit -m "feat: deterministic credit policy engine"
```

---

### Task 8: Case status transition guard

**Files:**
- Create: `app/src/state/transitions.ts`
- Test: `app/src/state/transitions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/state/transitions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { assertValidTransition, transitionCase, InvalidTransitionError } from "./transitions";
import { ToolError } from "@/lib/types";

describe("assertValidTransition", () => {
  it("allows the documented happy-path transitions", () => {
    expect(() => assertValidTransition("intake", "evaluating")).not.toThrow();
    expect(() => assertValidTransition("evaluating", "negotiating")).not.toThrow();
    expect(() => assertValidTransition("negotiating", "evaluating")).not.toThrow();
    expect(() => assertValidTransition("evaluating", "prepared")).not.toThrow();
    expect(() => assertValidTransition("prepared", "committing")).not.toThrow();
    expect(() => assertValidTransition("committing", "committed")).not.toThrow();
    expect(() => assertValidTransition("committed", "repair_needed")).not.toThrow();
    expect(() => assertValidTransition("repair_needed", "compensating")).not.toThrow();
    expect(() => assertValidTransition("compensating", "repaired")).not.toThrow();
  });

  it("rejects an arbitrary status update", () => {
    expect(() => assertValidTransition("intake", "committed")).toThrow(InvalidTransitionError);
    expect(() => assertValidTransition("cannot_commit", "evaluating")).toThrow(InvalidTransitionError);
  });

  it("only allows evaluating -> repaired when explicitly processing a repair version", () => {
    expect(() => assertValidTransition("evaluating", "repaired")).toThrow(InvalidTransitionError);
    expect(() => assertValidTransition("evaluating", "repaired", { isRepairVersion: true })).not.toThrow();
  });
});

describe("transitionCase", () => {
  beforeEach(resetTestDb);

  it("updates status only when the expected status and version both match", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });

    await transitionCase(testDb, { caseId: dealCase.id, expectedStatus: "intake", expectedVersion: 1, nextStatus: "evaluating" });

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("evaluating");
  });

  it("throws STALE_CASE_VERSION when the current status no longer matches", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
    });

    await expect(
      transitionCase(testDb, { caseId: dealCase.id, expectedStatus: "intake", expectedVersion: 1, nextStatus: "evaluating" }),
    ).rejects.toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/state/transitions.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/state/transitions.ts`**

```typescript
import type { PrismaClient, Prisma } from "@prisma/client";
import { type CaseStatus, ToolError } from "@/lib/types";

type Db = PrismaClient | Prisma.TransactionClient;

// Allowed transitions from 04-DATA-AND-STATE-SPEC.md. `evaluating -> repaired` is a
// special case documented separately in the spec ("evaluating → repaired when
// processing a repair version") and is gated by the `isRepairVersion` flag below rather
// than being unconditionally listed here.
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake: ["evaluating"],
  evaluating: ["negotiating", "prepared", "cannot_commit"],
  negotiating: ["evaluating", "cannot_commit"],
  prepared: ["committing", "aborting"],
  committing: ["committed", "aborting"],
  aborting: ["cannot_commit", "escalated"],
  committed: ["repair_needed"],
  cannot_commit: [],
  repair_needed: ["compensating", "escalated"],
  compensating: ["evaluating", "repaired", "escalated"],
  repaired: [],
  escalated: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: CaseStatus, to: CaseStatus) {
    super(`Cannot transition case from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

export interface TransitionOptions {
  isRepairVersion?: boolean;
}

export function assertValidTransition(from: CaseStatus, to: CaseStatus, options: TransitionOptions = {}): void {
  if (from === "evaluating" && to === "repaired") {
    if (!options.isRepairVersion) throw new InvalidTransitionError(from, to);
    return;
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new InvalidTransitionError(from, to);
}

export interface TransitionCaseInput {
  caseId: string;
  expectedStatus: CaseStatus;
  expectedVersion: number;
  nextStatus: CaseStatus;
  isRepairVersion?: boolean;
}

// The one function allowed to change `deal_case.status`. It verifies the transition is
// legal, then performs an optimistic-concurrency update: the WHERE clause must match
// both the expected status and the expected case version, or zero rows update and we
// treat that as a stale version (04-DATA-AND-STATE-SPEC.md "Concurrency control").
export async function transitionCase(db: Db, input: TransitionCaseInput): Promise<void> {
  assertValidTransition(input.expectedStatus, input.nextStatus, { isRepairVersion: input.isRepairVersion });
  const result = await db.dealCase.updateMany({
    where: { id: input.caseId, status: input.expectedStatus, activeTermsVersion: input.expectedVersion },
    data: { status: input.nextStatus },
  });
  if (result.count === 0) {
    throw new ToolError(
      "STALE_CASE_VERSION",
      `Case ${input.caseId} is not in status "${input.expectedStatus}" at version ${input.expectedVersion}`,
      true,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/state/transitions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/transitions.ts src/state/transitions.test.ts
git commit -m "feat: case status transition guard with optimistic concurrency"
```

---

### Task 9: Reservation and certificate lifecycle guards

**Files:**
- Create: `app/src/state/reservationLifecycle.ts`
- Create: `app/src/state/certificateLifecycle.ts`
- Test: `app/src/state/reservationLifecycle.test.ts`
- Test: `app/src/state/certificateLifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/state/reservationLifecycle.test.ts
import { describe, it, expect } from "vitest";
import { assertValidReservationTransition } from "./reservationLifecycle";
import { ToolError } from "@/lib/types";

describe("assertValidReservationTransition", () => {
  it("allows requested -> held -> committed", () => {
    expect(() => assertValidReservationTransition("requested", "held")).not.toThrow();
    expect(() => assertValidReservationTransition("held", "committed")).not.toThrow();
  });

  it("allows held -> released and held -> expired", () => {
    expect(() => assertValidReservationTransition("held", "released")).not.toThrow();
    expect(() => assertValidReservationTransition("held", "expired")).not.toThrow();
  });

  it("rejects resurrecting a released or expired reservation", () => {
    expect(() => assertValidReservationTransition("released", "held")).toThrow(ToolError);
    expect(() => assertValidReservationTransition("expired", "held")).toThrow(ToolError);
  });

  it("rejects committing directly from requested", () => {
    expect(() => assertValidReservationTransition("requested", "committed")).toThrow(ToolError);
  });
});
```

```typescript
// src/state/certificateLifecycle.test.ts
import { describe, it, expect } from "vitest";
import { assertValidCertificateTransition } from "./certificateLifecycle";
import { ToolError } from "@/lib/types";

describe("assertValidCertificateTransition", () => {
  it("allows draft -> valid -> consumed -> broken -> compensated", () => {
    expect(() => assertValidCertificateTransition("draft", "valid")).not.toThrow();
    expect(() => assertValidCertificateTransition("valid", "consumed")).not.toThrow();
    expect(() => assertValidCertificateTransition("consumed", "broken")).not.toThrow();
    expect(() => assertValidCertificateTransition("broken", "compensated")).not.toThrow();
  });

  it("allows valid -> superseded", () => {
    expect(() => assertValidCertificateTransition("valid", "superseded")).not.toThrow();
  });

  it("rejects consuming a certificate that was never valid", () => {
    expect(() => assertValidCertificateTransition("draft", "consumed")).toThrow(ToolError);
  });

  it("rejects mutating a terminal certificate", () => {
    expect(() => assertValidCertificateTransition("compensated", "valid")).toThrow(ToolError);
    expect(() => assertValidCertificateTransition("superseded", "valid")).toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/state/reservationLifecycle.test.ts src/state/certificateLifecycle.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write `src/state/reservationLifecycle.ts`**

```typescript
import { type ReservationStatus, ToolError } from "@/lib/types";

// From 04-DATA-AND-STATE-SPEC.md "Reservation lifecycle". Release and expiry are
// terminal for that row; repair creates new reservation rows instead of reviving one.
const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  requested: ["held", "failed"],
  held: ["committed", "released", "expired", "failed"],
  committed: [],
  released: [],
  expired: [],
  failed: [],
};

export function assertValidReservationTransition(from: ReservationStatus, to: ReservationStatus): void {
  const allowed = RESERVATION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ToolError("POLICY_VIOLATION", `Cannot transition reservation from "${from}" to "${to}"`, false);
  }
}
```

- [ ] **Step 4: Write `src/state/certificateLifecycle.ts`**

```typescript
import { type CertificateStatus, ToolError } from "@/lib/types";

// From 04-DATA-AND-STATE-SPEC.md "Certificate lifecycle".
const CERTIFICATE_TRANSITIONS: Record<CertificateStatus, CertificateStatus[]> = {
  draft: ["valid"],
  valid: ["consumed", "superseded"],
  consumed: ["broken"],
  broken: ["compensated"],
  compensated: [],
  superseded: [],
};

export function assertValidCertificateTransition(from: CertificateStatus, to: CertificateStatus): void {
  const allowed = CERTIFICATE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ToolError("POLICY_VIOLATION", `Cannot transition certificate from "${from}" to "${to}"`, false);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run src/state/reservationLifecycle.test.ts src/state/certificateLifecycle.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/state/reservationLifecycle.ts src/state/reservationLifecycle.test.ts src/state/certificateLifecycle.ts src/state/certificateLifecycle.test.ts
git commit -m "feat: reservation and certificate lifecycle guards"
```

---

### Task 10: Idempotency key derivation

**Files:**
- Create: `app/src/policy/idempotency.ts`
- Test: `app/src/policy/idempotency.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/policy/idempotency.test.ts
import { describe, it, expect } from "vitest";
import { deriveIdempotencyKey } from "./idempotency";

describe("deriveIdempotencyKey", () => {
  const base = { caseId: "CASE-1", caseVersion: 1, actionType: "hold_inventory", resourceRef: "SKU:MAT-10001:WH-BLR" };

  it("is stable for identical input (a retry reuses the same key)", () => {
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey({ ...base }));
  });

  it("changes when the case version changes", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, caseVersion: 2 }));
  });

  it("changes when the action type changes", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, actionType: "hold_supplier_option" }));
  });

  it("changes when the resource reference changes", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, resourceRef: "SKU:MAT-10001:WH-MUM" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/policy/idempotency.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/policy/idempotency.ts`**

```typescript
import { createHash } from "node:crypto";

export interface IdempotencyKeyInput {
  caseId: string;
  caseVersion: number;
  actionType: string;
  resourceRef: string;
}

// Deterministic idempotency key derived from case, version, action type, and resource
// (02-TECHNICAL-SPEC.md "Transaction strategy"). Retries pass the identical input and
// therefore reuse the identical key, which is what lets the receipt table dedupe them.
export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const canonical = `${input.caseId}:${input.caseVersion}:${input.actionType}:${input.resourceRef}`;
  return createHash("sha256").update(canonical).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/policy/idempotency.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/policy/idempotency.ts src/policy/idempotency.test.ts
git commit -m "feat: deterministic idempotency key derivation"
```

---

### Task 11: Reservation store helper and inventory hold adapter

**Files:**
- Create: `app/src/reservations/reservationStore.ts`
- Create: `app/src/adapters/inventoryAdapter.ts`
- Test: `app/src/adapters/inventoryAdapter.test.ts`

Reservation domains hold different things in the same `quantityMinor`/`limitMinor` columns — inventory, supplier, and logistics reservations use `quantityMinor` for a raw unit count (the Prisma field name follows `04-DATA-AND-STATE-SPEC.md` verbatim even though only the credit domain's `limitMinor` is actually money); credit reservations use `limitMinor` for the held exposure in paise. "Only one of `quantity_minor` or `limit_minor` is meaningful for a given reservation type" per the spec.

- [ ] **Step 1: Write `src/reservations/reservationStore.ts`**

```typescript
import type { PrismaClient, Prisma } from "@prisma/client";
import type { ReservationDomain } from "@/lib/types";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateHeldReservationInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  domain: ReservationDomain;
  resourceRef: string;
  quantityMinor: number | null;
  limitMinor: number | null;
  policyVersion: string;
  ttlSeconds: number;
  idempotencyKey: string;
}

// Every hold adapter ends its transaction here. Idempotency is enforced by the unique
// constraint on `idempotencyKey`: a retry with the same key returns the row that
// already exists instead of creating a second one.
export async function createHeldReservation(db: Db, input: CreateHeldReservationInput) {
  const existing = await db.reservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  return db.reservation.create({
    data: {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      domain: input.domain,
      resourceRef: input.resourceRef,
      quantityMinor: input.quantityMinor,
      limitMinor: input.limitMinor,
      status: "held",
      policyVersion: input.policyVersion,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
    },
  });
}
```

- [ ] **Step 2: Write the failing test for the inventory adapter**

```typescript
// src/adapters/inventoryAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdInventory, releaseInventoryHold } from "./inventoryAdapter";
import { ToolError } from "@/lib/types";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 } });
  return dealCase;
}

describe("holdInventory", () => {
  beforeEach(resetTestDb);

  it("decrements availability and creates a held reservation", async () => {
    const dealCase = await seedCase();
    const reservation = await holdInventory(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 600,
    });
    expect(reservation.status).toBe("held");
    expect(reservation.quantityMinor).toBe(199);

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(0);
  });

  it("refuses to hold more than is available", async () => {
    const dealCase = await seedCase();
    await expect(
      holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 350, ttlSeconds: 600 }),
    ).rejects.toThrow(ToolError);
  });

  it("is idempotent under retry with the same case, version, and resource", async () => {
    const dealCase = await seedCase();
    const first = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    const second = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    expect(second.id).toBe(first.id);

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199 - 80); // decremented once, not twice
  });

  it("releases a held reservation and restores availability", async () => {
    const dealCase = await seedCase();
    const reservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 80, ttlSeconds: 600 });
    await releaseInventoryHold(testDb, reservation.id);
    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/adapters/inventoryAdapter.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Write `src/adapters/inventoryAdapter.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";

const INVENTORY_POLICY_VERSION = "inventory-policy-v1";

export interface HoldInventoryInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  sku: string;
  warehouseId: string;
  quantity: number;
  ttlSeconds: number;
}

// Atomic availability check and decrement-to-held transition
// (02-TECHNICAL-SPEC.md "Reservation coordinator").
export async function holdInventory(db: PrismaClient, input: HoldInventoryInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_inventory",
    resourceRef: `SKU:${input.sku}:${input.warehouseId}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    const position = await tx.inventoryPosition.findFirst({ where: { sku: input.sku, warehouseId: input.warehouseId } });
    if (!position) {
      throw new ToolError("RESOURCE_UNAVAILABLE", `No inventory position for ${input.sku} at ${input.warehouseId}`, false);
    }
    const decremented = await tx.inventoryPosition.updateMany({
      where: { id: position.id, availableQuantity: { gte: input.quantity } },
      data: { availableQuantity: { decrement: input.quantity } },
    });
    if (decremented.count === 0) {
      throw new ToolError(
        "RESOURCE_UNAVAILABLE",
        `Only ${position.availableQuantity} of ${input.quantity} units available for ${input.sku}`,
        false,
      );
    }
    return createHeldReservation(tx, {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      domain: "inventory",
      resourceRef: `SKU:${input.sku}:${input.warehouseId}`,
      quantityMinor: input.quantity,
      limitMinor: null,
      policyVersion: INVENTORY_POLICY_VERSION,
      ttlSeconds: input.ttlSeconds,
      idempotencyKey,
    });
  });
}

export async function releaseInventoryHold(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held") return reservation;
    const [, sku, warehouseId] = reservation.resourceRef.split(":");
    await tx.inventoryPosition.updateMany({
      where: { sku, warehouseId },
      data: { availableQuantity: { increment: reservation.quantityMinor ?? 0 } },
    });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/adapters/inventoryAdapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reservations/reservationStore.ts src/adapters/inventoryAdapter.ts src/adapters/inventoryAdapter.test.ts
git commit -m "feat: reservation store helper and inventory hold adapter"
```

---

### Task 12: Supplier option hold adapter

**Files:**
- Create: `app/src/adapters/supplierAdapter.ts`
- Test: `app/src/adapters/supplierAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/adapters/supplierAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdSupplierOption } from "./supplierAdapter";
import { ToolError } from "@/lib/types";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  await testDb.supplierOption.create({
    data: { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" },
  });
  return dealCase;
}

describe("holdSupplierOption", () => {
  beforeEach(resetTestDb);

  it("holds the option when cost and lead time are within policy", async () => {
    const dealCase = await seedCase();
    const reservation = await holdSupplierOption(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151,
      maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900,
    });
    expect(reservation.status).toBe("held");
    expect(reservation.quantityMinor).toBe(151);
  });

  it("refuses an option that exceeds the maximum permitted unit cost", async () => {
    const dealCase = await seedCase();
    await expect(
      holdSupplierOption(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151, maxUnitCostMinor: 250_000, maxLeadDays: 21, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses an option marked unavailable", async () => {
    const dealCase = await seedCase();
    await testDb.supplierOption.updateMany({ where: { supplierId: "VEND-2003" }, data: { status: "unavailable" } });
    await expect(
      holdSupplierOption(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/adapters/supplierAdapter.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/adapters/supplierAdapter.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";

const SUPPLIER_POLICY_VERSION = "supplier-policy-v1";

export interface HoldSupplierOptionInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  supplierId: string;
  sku: string;
  quantity: number;
  maxUnitCostMinor: number;
  maxLeadDays: number;
  ttlSeconds: number;
}

// Refuses an unavailable or changed option (05-TOOL-CONTRACTS.md "hold_supplier_option"):
// re-reads current supplier state rather than trusting whatever the model last saw.
export async function holdSupplierOption(db: PrismaClient, input: HoldSupplierOptionInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_supplier_option",
    resourceRef: `SUPPLIER:${input.supplierId}:${input.sku}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    const option = await tx.supplierOption.findFirst({ where: { supplierId: input.supplierId, sku: input.sku } });
    if (!option || option.status !== "available") {
      throw new ToolError("RESOURCE_UNAVAILABLE", `Supplier ${input.supplierId} option for ${input.sku} is not available`, false);
    }
    if (option.unitCostMinor > input.maxUnitCostMinor || option.leadDays > input.maxLeadDays) {
      throw new ToolError("POLICY_VIOLATION", `Supplier ${input.supplierId} option no longer matches required cost or lead time`, false);
    }
    const decremented = await tx.supplierOption.updateMany({
      where: { id: option.id, availableQuantity: { gte: input.quantity } },
      data: { availableQuantity: { decrement: input.quantity } },
    });
    if (decremented.count === 0) {
      throw new ToolError(
        "RESOURCE_UNAVAILABLE",
        `Only ${option.availableQuantity} of ${input.quantity} units available from ${input.supplierId}`,
        false,
      );
    }
    return createHeldReservation(tx, {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      domain: "supplier",
      resourceRef: `SUPPLIER:${input.supplierId}:${input.sku}`,
      quantityMinor: input.quantity,
      limitMinor: null,
      policyVersion: SUPPLIER_POLICY_VERSION,
      ttlSeconds: input.ttlSeconds,
      idempotencyKey,
    });
  });
}

export async function cancelSupplierOptionHold(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held" && reservation.status !== "committed") return reservation;
    const [, supplierId, sku] = reservation.resourceRef.split(":");
    await tx.supplierOption.updateMany({ where: { supplierId, sku }, data: { availableQuantity: { increment: reservation.quantityMinor ?? 0 } } });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/adapters/supplierAdapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/supplierAdapter.ts src/adapters/supplierAdapter.test.ts
git commit -m "feat: supplier option hold adapter"
```

---

### Task 13: Logistics delivery-slot hold adapter

**Files:**
- Create: `app/src/adapters/logisticsAdapter.ts`
- Test: `app/src/adapters/logisticsAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/adapters/logisticsAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdDeliverySlot } from "./logisticsAdapter";
import { ToolError } from "@/lib/types";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  await testDb.deliveryPlanOption.create({
    data: { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDate: new Date("2026-09-12"), costMinor: 4_00_000, splitShipment: true, capacityRemaining: 350 },
  });
  return dealCase;
}

describe("holdDeliverySlot", () => {
  beforeEach(resetTestDb);

  it("holds capacity on an existing plan", async () => {
    const dealCase = await seedCase();
    const reservation = await holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 });
    expect(reservation.status).toBe("held");

    const plan = await testDb.deliveryPlanOption.findUniqueOrThrow({ where: { planId: "RT-BLR-HYD" } });
    expect(plan.capacityRemaining).toBe(0);
  });

  it("refuses a plan with insufficient remaining capacity", async () => {
    const dealCase = await seedCase();
    await expect(
      holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "RT-BLR-HYD", quantity: 500, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses an unknown plan id", async () => {
    const dealCase = await seedCase();
    await expect(
      holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "PLAN-MISSING", quantity: 1, ttlSeconds: 900 }),
    ).rejects.toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/adapters/logisticsAdapter.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/adapters/logisticsAdapter.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";

const LOGISTICS_POLICY_VERSION = "logistics-policy-v1";

export interface HoldDeliverySlotInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  planId: string;
  quantity: number;
  ttlSeconds: number;
}

// Verifies the plan references backed origins and current slot capacity
// (05-TOOL-CONTRACTS.md "hold_delivery_slot"). The plan itself (which origins it draws
// from) is computed by the deterministic logistics read tool in Task 21, not chosen
// here — this function only reserves capacity on an already-selected plan.
export async function holdDeliverySlot(db: PrismaClient, input: HoldDeliverySlotInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_delivery_slot",
    resourceRef: `PLAN:${input.planId}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    const plan = await tx.deliveryPlanOption.findUnique({ where: { planId: input.planId } });
    if (!plan) {
      throw new ToolError("RESOURCE_UNAVAILABLE", `Delivery plan ${input.planId} not found`, false);
    }
    const decremented = await tx.deliveryPlanOption.updateMany({
      where: { planId: input.planId, capacityRemaining: { gte: input.quantity } },
      data: { capacityRemaining: { decrement: input.quantity } },
    });
    if (decremented.count === 0) {
      throw new ToolError("RESOURCE_UNAVAILABLE", `Delivery plan ${input.planId} cannot cover ${input.quantity} units`, false);
    }
    return createHeldReservation(tx, {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      domain: "logistics",
      resourceRef: `PLAN:${input.planId}`,
      quantityMinor: input.quantity,
      limitMinor: null,
      policyVersion: LOGISTICS_POLICY_VERSION,
      ttlSeconds: input.ttlSeconds,
      idempotencyKey,
    });
  });
}

export async function releaseDeliverySlot(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held" && reservation.status !== "committed") return reservation;
    const [, planId] = reservation.resourceRef.split(":");
    await tx.deliveryPlanOption.updateMany({ where: { planId }, data: { capacityRemaining: { increment: reservation.quantityMinor ?? 0 } } });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/adapters/logisticsAdapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/logisticsAdapter.ts src/adapters/logisticsAdapter.test.ts
git commit -m "feat: logistics delivery-slot hold adapter"
```

---

### Task 14: Credit envelope hold

**Files:**
- Create: `app/src/adapters/creditAdapter.ts`
- Test: `app/src/adapters/creditAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/adapters/creditAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { holdCreditEnvelope } from "./creditAdapter";
import { ToolError } from "@/lib/types";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
  });
  const customer = await testDb.customer.create({
    data: { companyId: company.id, name: "Beacon Electronics", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"], policyVersion: "credit-policy-v1" },
  });
  return { dealCase, customer };
}

describe("holdCreditEnvelope", () => {
  beforeEach(resetTestDb);

  it("holds the envelope and raises current exposure when within policy", async () => {
    const { dealCase, customer } = await seedCase();
    const reservation = await holdCreditEnvelope(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1",
      customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 102_900_000, ttlSeconds: 600,
    });
    expect(reservation.status).toBe("held");
    expect(reservation.limitMinor).toBe(102_900_000);

    const reloaded = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.currentExposureMinor).toBe(102_900_000);
  });

  it("refuses NET_60 when it is outside the customer's allowed payment terms", async () => {
    const { dealCase, customer } = await seedCase();
    await expect(
      holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "NET_60", exposureMinor: 147_000_000, ttlSeconds: 600 }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses exposure that would exceed the credit limit", async () => {
    const { dealCase, customer } = await seedCase();
    await expect(
      holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 250_000_000, ttlSeconds: 600 }),
    ).rejects.toThrow(ToolError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/adapters/creditAdapter.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/adapters/creditAdapter.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { ToolError, type PaymentTerms } from "@/lib/types";
import { createHeldReservation } from "@/reservations/reservationStore";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { evaluateCreditPolicy } from "@/policy/credit";

const CREDIT_POLICY_VERSION = "credit-policy-v1";

export interface HoldCreditEnvelopeInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  customerId: string;
  paymentTerms: PaymentTerms;
  exposureMinor: number;
  ttlSeconds: number;
}

// The server recomputes exposure and rejects mismatched policy or insufficient
// capacity (05-TOOL-CONTRACTS.md "hold_credit_envelope") — the model's decision is
// never trusted as the exposure calculation.
export async function holdCreditEnvelope(db: PrismaClient, input: HoldCreditEnvelopeInput) {
  const idempotencyKey = deriveIdempotencyKey({
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "hold_credit_envelope",
    resourceRef: `CUSTOMER:${input.customerId}`,
  });
  const existing = await db.reservation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
    const policyResult = evaluateCreditPolicy({
      creditLimitMinor: customer.creditLimitMinor,
      currentExposureMinor: customer.currentExposureMinor,
      overdueReceivablesMinor: customer.overdueReceivablesMinor,
      allowedPaymentTerms: customer.allowedPaymentTerms as string[],
      paymentTerms: input.paymentTerms,
      newExposureMinor: input.exposureMinor,
    });
    if (!policyResult.passed) {
      throw new ToolError("POLICY_VIOLATION", `Credit policy rejected exposure: ${policyResult.code}`, false, [`CUSTOMER:${input.customerId}`]);
    }
    await tx.customer.update({ where: { id: input.customerId }, data: { currentExposureMinor: { increment: input.exposureMinor } } });
    return createHeldReservation(tx, {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      domain: "credit",
      resourceRef: `CUSTOMER:${input.customerId}`,
      quantityMinor: null,
      limitMinor: input.exposureMinor,
      policyVersion: CREDIT_POLICY_VERSION,
      ttlSeconds: input.ttlSeconds,
      idempotencyKey,
    });
  });
}

export async function releaseCreditEnvelope(db: PrismaClient, reservationId: string) {
  return db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== "held") return reservation;
    const [, customerId] = reservation.resourceRef.split(":");
    await tx.customer.updateMany({ where: { id: customerId }, data: { currentExposureMinor: { decrement: reservation.limitMinor ?? 0 } } });
    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/adapters/creditAdapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/creditAdapter.ts src/adapters/creditAdapter.test.ts
git commit -m "feat: credit envelope hold adapter"
```

---

### Task 15: Action receipt helper

Every attempted effect gets one `action_receipt` row before the adapter runs, per `02-TECHNICAL-SPEC.md` "Transaction strategy". This task builds the wrapper every commit-side adapter (Task 16) and the coordinator (Tasks 17–18) call.

**Files:**
- Create: `app/src/receipts/actionReceipt.ts`
- Test: `app/src/receipts/actionReceipt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/receipts/actionReceipt.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runReceiptedAction } from "./actionReceipt";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  return testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "committing", createdBy: "seed" } });
}

describe("runReceiptedAction", () => {
  beforeEach(resetTestDb);

  it("records a succeeded receipt and returns the adapter's data", async () => {
    const dealCase = await seedCase();
    const result = await runReceiptedAction(testDb, {
      caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:1", provider: "sandbox_erp",
      idempotencyKey: "key-1", requestHash: "req-1",
      execute: async () => ({ providerRef: "SO-1001", data: { orderId: "SO-1001" } }),
    });
    expect(result.status).toBe("succeeded");

    const receipt = await testDb.actionReceipt.findUniqueOrThrow({ where: { idempotencyKey: "key-1" } });
    expect(receipt.status).toBe("succeeded");
    expect(receipt.attemptCount).toBe(1);
  });

  it("records a failed receipt when the adapter throws, and does not swallow the error", async () => {
    const dealCase = await seedCase();
    await expect(
      runReceiptedAction(testDb, {
        caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:2", provider: "sandbox_erp",
        idempotencyKey: "key-2", requestHash: "req-2",
        execute: async () => { throw new Error("adapter unavailable"); },
      }),
    ).rejects.toThrow("adapter unavailable");

    const receipt = await testDb.actionReceipt.findUniqueOrThrow({ where: { idempotencyKey: "key-2" } });
    expect(receipt.status).toBe("failed");
  });

  it("returns the existing receipt on retry instead of re-running the adapter", async () => {
    const dealCase = await seedCase();
    let calls = 0;
    const input = {
      caseId: dealCase.id, caseVersion: 1, actionType: "sandbox_order.create", resourceRef: "ORDER:3", provider: "sandbox_erp" as const,
      idempotencyKey: "key-3", requestHash: "req-3",
      execute: async () => { calls += 1; return { providerRef: "SO-1003", data: { orderId: "SO-1003" } }; },
    };
    await runReceiptedAction(testDb, input);
    await runReceiptedAction(testDb, input);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/receipts/actionReceipt.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/receipts/actionReceipt.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { ReceiptProvider } from "@/lib/types";

export interface RunReceiptedActionInput<T> {
  caseId: string;
  caseVersion: number;
  actionType: string;
  resourceRef: string;
  provider: ReceiptProvider;
  idempotencyKey: string;
  requestHash: string;
  execute: () => Promise<{ providerRef: string | null; data: T }>;
}

// Create one action_receipt row before attempting an effect; mark it succeeded or
// failed after the adapter returns; retries reuse the same idempotency key
// (02-TECHNICAL-SPEC.md "Transaction strategy"). Unlike reservations, a receipt is
// created eagerly as `pending` (not skipped on first sight) so a crash between
// "receipt created" and "adapter responded" is visible instead of silently retried
// as if nothing happened.
export async function runReceiptedAction<T>(db: PrismaClient, input: RunReceiptedActionInput<T>) {
  const existing = await db.actionReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && existing.status === "succeeded") return existing;

  const receipt =
    existing ??
    (await db.actionReceipt.create({
      data: {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        actionType: input.actionType,
        resourceRef: input.resourceRef,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        status: "pending",
        provider: input.provider,
        responsePayload: {},
      },
    }));

  try {
    const result = await input.execute();
    return db.actionReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "succeeded",
        providerReceiptRef: result.providerRef,
        responsePayload: result.data as object,
        attemptCount: { increment: existing ? 1 : 0 },
      },
    });
  } catch (error) {
    await db.actionReceipt.update({
      where: { id: receipt.id },
      data: { status: "failed", attemptCount: { increment: existing ? 1 : 0 } },
    });
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/receipts/actionReceipt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/receipts/actionReceipt.ts src/receipts/actionReceipt.test.ts
git commit -m "feat: idempotent receipted-action wrapper"
```

---

### Task 16: Commit-side effect adapters (sandbox ERP/CRM, Stripe mock, outbox)

These three adapters only ever run inside `runReceiptedAction` (Task 15) from the commit workflow (Task 26) — they are never called directly by a role agent. The Stripe adapter is a mock per the locked scope decision (no real Stripe test keys were provided); it is written behind the same shape a real `stripe` SDK call would have, so swapping in real Stripe later means replacing this one file, not the coordinator.

**Files:**
- Create: `app/src/adapters/sandboxErpAdapter.ts`
- Create: `app/src/adapters/stripeMockAdapter.ts`
- Create: `app/src/adapters/outboxAdapter.ts`
- Test: `app/src/adapters/sandboxErpAdapter.test.ts`
- Test: `app/src/adapters/stripeMockAdapter.test.ts`
- Test: `app/src/adapters/outboxAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/adapters/sandboxErpAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createSandboxOrder, updateCrmStage } from "./sandboxErpAdapter";

describe("sandboxErpAdapter", () => {
  beforeEach(resetTestDb);

  it("creates a sandbox order", async () => {
    const order = await createSandboxOrder(testDb, { caseId: "CASE-1", certificateId: "CERT-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000 });
    expect(order.status).toBe("accepted");
  });

  it("appends a CRM stage event without deleting prior history", async () => {
    await updateCrmStage(testDb, { caseId: "CASE-1", stage: "quote_sent", note: "Initial normalization" });
    await updateCrmStage(testDb, { caseId: "CASE-1", stage: "committed", note: "Certificate consumed" });
    const events = await testDb.crmStageEvent.findMany({ where: { caseId: "CASE-1" }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.stage)).toEqual(["quote_sent", "committed"]);
  });
});
```

```typescript
// src/adapters/stripeMockAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createDepositCheckout, expireCheckout } from "./stripeMockAdapter";
import { ToolError } from "@/lib/types";

describe("stripeMockAdapter", () => {
  beforeEach(resetTestDb);

  it("creates a checkout session for the deposit amount", async () => {
    const checkout = await createDepositCheckout(testDb, { caseId: "CASE-1", certificateId: "CERT-1", amountMinor: 44_100_000 });
    expect(checkout.status).toBe("created");
    expect(checkout.amountMinor).toBe(44_100_000);
  });

  it("expires a created checkout idempotently", async () => {
    const checkout = await createDepositCheckout(testDb, { caseId: "CASE-1", certificateId: "CERT-1", amountMinor: 44_100_000 });
    const expired = await expireCheckout(testDb, checkout.id);
    const expiredAgain = await expireCheckout(testDb, checkout.id);
    expect(expired.status).toBe("expired");
    expect(expiredAgain.status).toBe("expired");
  });

  it("refuses to expire a completed checkout (no test-mode refund path in this build)", async () => {
    const checkout = await createDepositCheckout(testDb, { caseId: "CASE-1", certificateId: "CERT-1", amountMinor: 44_100_000 });
    await testDb.stripeCheckoutMock.update({ where: { id: checkout.id }, data: { status: "completed" } });
    await expect(expireCheckout(testDb, checkout.id)).rejects.toThrow(ToolError);
  });
});
```

```typescript
// src/adapters/outboxAdapter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { sendBackedPromise, sendCorrection } from "./outboxAdapter";

describe("outboxAdapter", () => {
  beforeEach(resetTestDb);

  it("writes a backed promise message", async () => {
    const message = await sendBackedPromise(testDb, { caseId: "CASE-1", certificateId: "CERT-1", payload: { termsVersion: 2, checkoutUrl: "https://example.test/checkout" } });
    expect(message.messageType).toBe("backed_promise");
  });

  it("links a correction to the original without deleting it", async () => {
    const original = await sendBackedPromise(testDb, { caseId: "CASE-1", certificateId: "CERT-1", payload: {} });
    const correction = await sendCorrection(testDb, { caseId: "CASE-1", certificateId: "CERT-2", correctsId: original.id, payload: { reason: "supplier disruption repaired" } });
    expect(correction.correctsId).toBe(original.id);

    const stillThere = await testDb.outboxMessage.findUniqueOrThrow({ where: { id: original.id } });
    expect(stillThere).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/adapters/sandboxErpAdapter.test.ts src/adapters/stripeMockAdapter.test.ts src/adapters/outboxAdapter.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write `src/adapters/sandboxErpAdapter.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";

export interface CreateSandboxOrderInput {
  caseId: string;
  certificateId: string;
  sku: string;
  quantity: number;
  totalValueMinor: number;
}

export async function createSandboxOrder(db: PrismaClient, input: CreateSandboxOrderInput) {
  return db.sandboxOrder.create({ data: { ...input, status: "accepted" } });
}

export async function markSandboxOrderRepairPending(db: PrismaClient, caseId: string) {
  return db.sandboxOrder.updateMany({ where: { caseId }, data: { status: "repair_pending" } });
}

export async function markSandboxOrderRepaired(db: PrismaClient, caseId: string, newCertificateId: string) {
  return db.sandboxOrder.updateMany({ where: { caseId }, data: { status: "repaired", certificateId: newCertificateId } });
}

export interface UpdateCrmStageInput {
  caseId: string;
  stage: string;
  note: string;
}

// Append-only: CRM stage is a history of events, never an overwritten single field, so
// the repair timeline can show "with history" (04-DATA-AND-STATE-SPEC.md compensation table).
export async function updateCrmStage(db: PrismaClient, input: UpdateCrmStageInput) {
  return db.crmStageEvent.create({ data: input });
}
```

- [ ] **Step 4: Write `src/adapters/stripeMockAdapter.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ToolError } from "@/lib/types";

export interface CreateDepositCheckoutInput {
  caseId: string;
  certificateId: string;
  amountMinor: number;
}

// Mock Stripe test-mode checkout: no real credentials were provided (locked scope
// decision), so this simulates the session shape a real `stripe.checkout.sessions.create`
// call would return. Swapping to real Stripe later means replacing this file only.
export async function createDepositCheckout(db: PrismaClient, input: CreateDepositCheckoutInput) {
  return db.stripeCheckoutMock.create({
    data: {
      caseId: input.caseId,
      certificateId: input.certificateId,
      amountMinor: input.amountMinor,
      status: "created",
      stripeSessionId: `cs_test_mock_${randomUUID()}`,
    },
  });
}

export async function expireCheckout(db: PrismaClient, checkoutId: string) {
  const checkout = await db.stripeCheckoutMock.findUniqueOrThrow({ where: { id: checkoutId } });
  if (checkout.status === "expired") return checkout;
  if (checkout.status === "completed") {
    throw new ToolError(
      "PROVIDER_UNAVAILABLE",
      "Cannot expire a completed test checkout; this build has no idempotent test-mode refund path (04-DATA-AND-STATE-SPEC.md)",
      false,
    );
  }
  return db.stripeCheckoutMock.update({ where: { id: checkoutId }, data: { status: "expired" } });
}
```

- [ ] **Step 5: Write `src/adapters/outboxAdapter.ts`**

```typescript
import type { PrismaClient, Prisma } from "@prisma/client";

export interface SendBackedPromiseInput {
  caseId: string;
  certificateId: string;
  payload: Record<string, unknown>;
}

export async function sendBackedPromise(db: PrismaClient, input: SendBackedPromiseInput) {
  return db.outboxMessage.create({
    data: {
      caseId: input.caseId,
      messageType: "backed_promise",
      certificateId: input.certificateId,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
}

export interface SendCorrectionInput {
  caseId: string;
  certificateId: string;
  correctsId: string;
  payload: Record<string, unknown>;
}

// Never deletes or overwrites the original promise message
// (04-DATA-AND-STATE-SPEC.md compensation table, "Customer message").
export async function sendCorrection(db: PrismaClient, input: SendCorrectionInput) {
  return db.outboxMessage.create({
    data: {
      caseId: input.caseId,
      messageType: "correction",
      certificateId: input.certificateId,
      correctsId: input.correctsId,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd app && npx vitest run src/adapters/sandboxErpAdapter.test.ts src/adapters/stripeMockAdapter.test.ts src/adapters/outboxAdapter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/adapters/sandboxErpAdapter.ts src/adapters/stripeMockAdapter.ts src/adapters/outboxAdapter.ts src/adapters/*.test.ts
git commit -m "feat: commit-side effect adapters (sandbox ERP/CRM, mock Stripe, outbox)"
```

---

### Task 17: Reservation coordinator — prepare, commit, abort

"Only the coordinator may mint or consume certificates" (`03-AGENT-ARCHITECTURE.md`). This file is the one place allowed to call `assertValidCertificateTransition`, transition a reservation to `committed`, and call the commit-side adapters from Task 16.

**Files:**
- Create: `app/src/reservations/coordinator.ts`
- Test: `app/src/reservations/coordinator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/reservations/coordinator.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { prepareCommitCertificate, commitOrder, abortCommitment } from "./coordinator";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { ToolError } from "@/lib/types";

async function seedReadyCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" } });
  const customer = await testDb.customer.create({ data: { companyId: company.id, name: "Beacon", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: ["ADVANCE_30"], policyVersion: "credit-policy-v1" } });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 350 } });

  const inventoryReservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 350, ttlSeconds: 600 });
  const creditReservation = await holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 102_900_000, ttlSeconds: 600 });

  return { dealCase, customer, reservationIds: [inventoryReservation.id, creditReservation.id] };
}

describe("prepareCommitCertificate", () => {
  beforeEach(resetTestDb);

  it("issues a valid certificate when every required domain is held, fresh, and same terms hash", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"],
    });
    expect(certificate.status).toBe("valid");
  });

  it("refuses a reservation set missing a required domain", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    await expect(
      prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit", "logistics"] }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses a reservation bound to a different terms hash", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    await expect(
      prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-2", reservationIds, requiredDomains: ["inventory", "credit"] }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses an already-expired reservation", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    await testDb.reservation.update({ where: { id: reservationIds[0] }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(
      prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] }),
    ).rejects.toThrow(ToolError);
  });
});

describe("commitOrder", () => {
  beforeEach(resetTestDb);

  it("commits reservations, marks the certificate consumed, and writes required receipts exactly once", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });

    const result = await commitOrder(testDb, {
      caseId: dealCase.id, caseVersion: 1, certificateId: certificate.id, certificateHash: certificate.certificateHash,
      sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, depositMinor: 44_100_000,
    });
    expect(result.orderReceipt.status).toBe("succeeded");
    expect(result.checkoutReceipt.status).toBe("succeeded");
    expect(result.outboxReceipt.status).toBe("succeeded");

    const reloadedCert = await testDb.commitCertificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(reloadedCert.status).toBe("consumed");

    const reservations = await testDb.reservation.findMany({ where: { id: { in: reservationIds } } });
    expect(reservations.every((r) => r.status === "committed")).toBe(true);
  });

  it("refuses to consume a certificate whose hash does not match", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });
    await expect(
      commitOrder(testDb, { caseId: dealCase.id, caseVersion: 1, certificateId: certificate.id, certificateHash: "wrong-hash", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, depositMinor: 44_100_000 }),
    ).rejects.toThrow(ToolError);
  });
});

describe("abortCommitment", () => {
  beforeEach(resetTestDb);

  it("releases every held reservation for the case version and is idempotent on retry", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const first = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    const second = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0); // nothing left in "held" status to release

    const reservations = await testDb.reservation.findMany({ where: { id: { in: reservationIds } } });
    expect(reservations.every((r) => r.status === "released")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/reservations/coordinator.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/reservations/coordinator.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { ToolError, type ReservationDomain, type ReservationStatus } from "@/lib/types";
import { certificateHash as computeCertificateHash } from "@/lib/hash";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { assertValidCertificateTransition } from "@/state/certificateLifecycle";
import { assertValidReservationTransition } from "@/state/reservationLifecycle";
import { runReceiptedAction } from "@/receipts/actionReceipt";
import { createSandboxOrder, updateCrmStage } from "@/adapters/sandboxErpAdapter";
import { createDepositCheckout } from "@/adapters/stripeMockAdapter";
import { sendBackedPromise } from "@/adapters/outboxAdapter";
import { releaseInventoryHold } from "@/adapters/inventoryAdapter";
import { cancelSupplierOptionHold } from "@/adapters/supplierAdapter";
import { releaseDeliverySlot } from "@/adapters/logisticsAdapter";
import { releaseCreditEnvelope } from "@/adapters/creditAdapter";

export interface PrepareCertificateInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  reservationIds: string[];
  requiredDomains: ReservationDomain[];
}

// The coordinator may mark a certificate valid only when every listed invariant from
// 04-DATA-AND-STATE-SPEC.md "Certificate lifecycle" holds. This function checks all of
// them before creating the row at all, so an invalid attempt never becomes a `draft`
// certificate that has to be cleaned up.
export async function prepareCommitCertificate(db: PrismaClient, input: PrepareCertificateInput) {
  return db.$transaction(async (tx) => {
    const reservations = await tx.reservation.findMany({ where: { id: { in: input.reservationIds } } });
    if (reservations.length !== input.reservationIds.length) {
      throw new ToolError("INVALID_INPUT", "One or more reservation ids do not exist", false);
    }
    const now = new Date();
    for (const reservation of reservations) {
      if (reservation.caseId !== input.caseId || reservation.termsHash !== input.termsHash) {
        throw new ToolError("TERMS_HASH_MISMATCH", `Reservation ${reservation.id} does not match case ${input.caseId} / terms hash ${input.termsHash}`, false, [reservation.id]);
      }
      // A `held` reservation must belong to exactly this case version and be unexpired.
      // A `committed` reservation may belong to an *earlier* case version of the same
      // case: it already executed durably during a prior commit and does not need to
      // be re-verified or re-held during repair — 04-DATA-AND-STATE-SPEC.md "Inventory
      // and Finance decisions are reused only after freshness validation" (Case 3).
      // Re-holding it would double-count the resource, since the pool decrement from
      // the original hold is never restored for a committed reservation.
      if (reservation.status === "committed") continue;
      if (reservation.status !== "held") {
        throw new ToolError("RESERVATION_EXPIRED", `Reservation ${reservation.id} is not held (status=${reservation.status})`, true, [reservation.id]);
      }
      if (reservation.caseVersion !== input.caseVersion) {
        throw new ToolError("STALE_CASE_VERSION", `Held reservation ${reservation.id} belongs to a different case version than ${input.caseVersion}`, true, [reservation.id]);
      }
      if (reservation.expiresAt <= now) {
        throw new ToolError("RESERVATION_EXPIRED", `Reservation ${reservation.id} expired at ${reservation.expiresAt.toISOString()}`, true, [reservation.id]);
      }
    }
    const coveredDomains = new Set(reservations.map((r) => r.domain));
    for (const domain of input.requiredDomains) {
      if (!coveredDomains.has(domain)) {
        throw new ToolError("POLICY_VIOLATION", `No held reservation covers required domain "${domain}"`, false);
      }
    }
    // Only `held` reservations are still time-bound; a `committed` one (reused from an
    // earlier case version during repair) no longer has a meaningful expiry.
    const heldExpiries = reservations.filter((r) => r.status === "held").map((r) => r.expiresAt);
    const validUntil = heldExpiries.length > 0 ? heldExpiries.reduce((earliest, expiry) => (expiry < earliest ? expiry : earliest)) : new Date(Date.now() + 15 * 60 * 1000);
    const policyVersions = Object.fromEntries(reservations.map((r) => [r.domain, r.policyVersion]));
    const hash = computeCertificateHash({ caseId: input.caseId, termsHash: input.termsHash, reservationIds: input.reservationIds });

    assertValidCertificateTransition("draft", "valid");
    return tx.commitCertificate.create({
      data: {
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        termsHash: input.termsHash,
        reservationIds: input.reservationIds,
        policyVersions,
        validUntil,
        status: "valid",
        certificateHash: hash,
      },
    });
  });
}

export interface CommitOrderInput {
  caseId: string;
  caseVersion: number;
  certificateId: string;
  certificateHash: string;
  sku: string;
  quantity: number;
  totalValueMinor: number;
  depositMinor: number;
}

// Requires a valid certificate ID and certificate hash; commits sandbox order,
// allocation, CRM, Stripe checkout-release, and outbox actions through idempotent
// receipts (05-TOOL-CONTRACTS.md "commit_order"). Reservations move to `committed` and
// the certificate to `consumed` only after the required receipts succeed.
export async function commitOrder(db: PrismaClient, input: CommitOrderInput) {
  const certificate = await db.commitCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
  if (certificate.status !== "valid") {
    throw new ToolError("POLICY_VIOLATION", `Certificate ${input.certificateId} is not valid (status=${certificate.status})`, false);
  }
  if (certificate.certificateHash !== input.certificateHash) {
    throw new ToolError("TERMS_HASH_MISMATCH", "Supplied certificate hash does not match the stored certificate", false);
  }
  if (certificate.validUntil <= new Date()) {
    throw new ToolError("RESERVATION_EXPIRED", `Certificate ${input.certificateId} expired at ${certificate.validUntil.toISOString()}`, false);
  }

  const key = (actionType: string) =>
    deriveIdempotencyKey({ caseId: input.caseId, caseVersion: input.caseVersion, actionType, resourceRef: input.certificateId });

  const orderReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "sandbox_order.create",
    resourceRef: input.certificateId,
    provider: "sandbox_erp",
    idempotencyKey: key("sandbox_order.create"),
    requestHash: input.certificateHash,
    execute: async () => {
      const order = await createSandboxOrder(db, { caseId: input.caseId, certificateId: input.certificateId, sku: input.sku, quantity: input.quantity, totalValueMinor: input.totalValueMinor });
      await updateCrmStage(db, { caseId: input.caseId, stage: "committed", note: `Certificate ${input.certificateId} consumed` });
      return { providerRef: order.id, data: { orderId: order.id } };
    },
  });

  const checkoutReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "stripe.create_deposit_checkout",
    resourceRef: input.certificateId,
    provider: "stripe",
    idempotencyKey: key("stripe.create_deposit_checkout"),
    requestHash: input.certificateHash,
    execute: async () => {
      const checkout = await createDepositCheckout(db, { caseId: input.caseId, certificateId: input.certificateId, amountMinor: input.depositMinor });
      return { providerRef: checkout.stripeSessionId, data: { checkoutId: checkout.id, checkoutUrl: `https://checkout.stripe.test/mock/${checkout.stripeSessionId}` } };
    },
  });

  const reservationIds = certificate.reservationIds as string[];
  for (const reservationId of reservationIds) {
    await db.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      if (reservation.status === "committed") return;
      assertValidReservationTransition(reservation.status as ReservationStatus, "committed");
      await tx.reservation.update({ where: { id: reservationId }, data: { status: "committed" } });
    });
  }

  assertValidCertificateTransition("valid", "consumed");
  await db.commitCertificate.update({ where: { id: input.certificateId }, data: { status: "consumed", consumedAt: new Date() } });

  const outboxReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "outbox.send_backed_promise",
    resourceRef: input.certificateId,
    provider: "outbox",
    idempotencyKey: key("outbox.send_backed_promise"),
    requestHash: input.certificateHash,
    execute: async () => {
      const checkoutData = checkoutReceipt.responsePayload as { checkoutUrl: string };
      const message = await sendBackedPromise(db, {
        caseId: input.caseId,
        certificateId: input.certificateId,
        payload: { sku: input.sku, quantity: input.quantity, depositMinor: input.depositMinor, checkoutUrl: checkoutData.checkoutUrl },
      });
      return { providerRef: message.id, data: {} };
    },
  });

  return { orderReceipt, checkoutReceipt, outboxReceipt };
}

// Releases every still-held reservation for a preparation attempt. Repeated calls
// return existing release results — each release function is itself a no-op once a
// reservation is no longer `held` (05-TOOL-CONTRACTS.md "abort_commitment").
export async function abortCommitment(db: PrismaClient, input: { caseId: string; caseVersion: number }) {
  const reservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: input.caseVersion, status: "held" } });
  const results = [];
  for (const reservation of reservations) {
    switch (reservation.domain) {
      case "inventory":
        results.push(await releaseInventoryHold(db, reservation.id));
        break;
      case "supplier":
        results.push(await cancelSupplierOptionHold(db, reservation.id));
        break;
      case "logistics":
        results.push(await releaseDeliverySlot(db, reservation.id));
        break;
      case "credit":
        results.push(await releaseCreditEnvelope(db, reservation.id));
        break;
    }
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/reservations/coordinator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/reservations/coordinator.ts src/reservations/coordinator.test.ts
git commit -m "feat: reservation coordinator — prepare, commit, abort"
```

---

### Task 18: Reservation coordinator — break, compensate, verify

**Design note:** a `committed` reservation is terminal in `04-DATA-AND-STATE-SPEC.md` ("Reservation lifecycle") — compensation never mutates that row's status. Instead, per the spec's compensation table ("Inventory allocation: Release affected allocation **or create adjustment receipt**"), compensation is recorded as new `action_receipt` rows and, where the underlying resource pool is still meaningful (a logistics slot on a plan that other cases could use), a direct pool adjustment. A disrupted supplier's own availability is not restored — it is disrupted, not reusable.

**Files:**
- Modify: `app/src/reservations/coordinator.ts`
- Modify: `app/src/reservations/coordinator.test.ts`

- [ ] **Step 1: Append the failing tests**

```typescript
// append to src/reservations/coordinator.test.ts
import { breakCertificate, compensateCommitment, verifyTerminalState } from "./coordinator";
import { holdSupplierOption } from "@/adapters/supplierAdapter";
import { holdDeliverySlot } from "@/adapters/logisticsAdapter";

describe("breakCertificate", () => {
  beforeEach(resetTestDb);

  it("marks a consumed certificate broken without deleting it", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });
    await commitOrder(testDb, { caseId: dealCase.id, caseVersion: 1, certificateId: certificate.id, certificateHash: certificate.certificateHash, sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, depositMinor: 44_100_000 });

    const broken = await breakCertificate(testDb, { certificateId: certificate.id });
    expect(broken.status).toBe("broken");
    const stillThere = await testDb.commitCertificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(stillThere.reservationIds).toEqual(reservationIds);
  });

  it("is idempotent when called twice", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });
    await commitOrder(testDb, { caseId: dealCase.id, caseVersion: 1, certificateId: certificate.id, certificateHash: certificate.certificateHash, sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, depositMinor: 44_100_000 });
    await breakCertificate(testDb, { certificateId: certificate.id });
    const second = await breakCertificate(testDb, { certificateId: certificate.id });
    expect(second.status).toBe("broken");
  });
});

describe("compensateCommitment", () => {
  beforeEach(resetTestDb);

  it("records exactly one receipt per affected domain even if called twice", async () => {
    const { dealCase } = await seedReadyCase();
    await testDb.supplierOption.create({ data: { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" } });
    await testDb.deliveryPlanOption.create({ data: { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDate: new Date("2026-09-12"), costMinor: 400_000, splitShipment: true, capacityRemaining: 350 } });

    const supplierReservation = await holdSupplierOption(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", supplierId: "VEND-2003", sku: "MAT-10001", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 });
    const logisticsReservation = await holdDeliverySlot(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", planId: "RT-BLR-HYD", quantity: 151, ttlSeconds: 900 });
    await testDb.sandboxOrder.create({ data: { caseId: dealCase.id, certificateId: "CERT-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, status: "accepted" } });

    const input = { caseId: dealCase.id, caseVersion: 2, brokenCertificateId: "CERT-1", disruptedSupplierReservationId: supplierReservation.id, affectedLogisticsReservationIds: [logisticsReservation.id] };
    const first = await compensateCommitment(testDb, input);
    const second = await compensateCommitment(testDb, input);
    expect(first.supplierReceipt.status).toBe("succeeded");
    expect(second.supplierReceipt.id).toBe(first.supplierReceipt.id); // same receipt row, not a duplicate

    const plan = await testDb.deliveryPlanOption.findUniqueOrThrow({ where: { planId: "RT-BLR-HYD" } });
    expect(plan.capacityRemaining).toBe(350 - 151 + 151); // held then released back once, not twice
  });
});

describe("verifyTerminalState", () => {
  beforeEach(resetTestDb);

  it("reports current case, certificate, reservation, and receipt state without any model call", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });
    const report = await verifyTerminalState(testDb, dealCase.id);
    expect(report.caseId).toBe(dealCase.id);
    expect(report.certificates.map((c) => c.id)).toContain(certificate.id);
    expect(report.reservations).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/reservations/coordinator.test.ts`
Expected: FAIL — `breakCertificate`, `compensateCommitment`, `verifyTerminalState` are not exported yet.

- [ ] **Step 3: Append to `src/reservations/coordinator.ts`**

Add these imports to the top of the file:

```typescript
import { markSandboxOrderRepairPending } from "@/adapters/sandboxErpAdapter";
```

Append at the bottom of the file:

```typescript
// Requires a persisted disruption event and consumed certificate; marks the
// certificate broken without deleting committed history (05-TOOL-CONTRACTS.md
// "break_certificate"). Idempotent: breaking an already-broken certificate is a no-op.
export async function breakCertificate(db: PrismaClient, input: { certificateId: string }) {
  const certificate = await db.commitCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
  if (certificate.status === "broken") return certificate;
  if (certificate.status !== "consumed") {
    throw new ToolError("POLICY_VIOLATION", `Certificate ${input.certificateId} is not consumed (status=${certificate.status})`, false);
  }
  assertValidCertificateTransition("consumed", "broken");
  return db.commitCertificate.update({ where: { id: input.certificateId }, data: { status: "broken", brokenAt: new Date() } });
}

export interface CompensateCommitmentInput {
  caseId: string;
  caseVersion: number;
  brokenCertificateId: string;
  disruptedSupplierReservationId: string;
  affectedLogisticsReservationIds: string[];
}

// Executes the compensation matrix from 04-DATA-AND-STATE-SPEC.md. Every step is
// idempotency-keyed by case, version, action type, and resource, so calling this twice
// for the same disruption produces the same receipts, not duplicates.
export async function compensateCommitment(db: PrismaClient, input: CompensateCommitmentInput) {
  const key = (actionType: string, resourceRef: string) =>
    deriveIdempotencyKey({ caseId: input.caseId, caseVersion: input.caseVersion, actionType, resourceRef });

  const supplierReservation = await db.reservation.findUniqueOrThrow({ where: { id: input.disruptedSupplierReservationId } });
  const supplierReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "supplier.cancel_option",
    resourceRef: supplierReservation.resourceRef,
    provider: "supplier",
    idempotencyKey: key("supplier.cancel_option", supplierReservation.resourceRef),
    requestHash: input.brokenCertificateId,
    execute: async () => ({ providerRef: supplierReservation.resourceRef, data: { cancelledReservationId: supplierReservation.id } }),
  });

  const logisticsReceipts = [];
  for (const reservationId of input.affectedLogisticsReservationIds) {
    const reservation = await db.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    const receipt = await runReceiptedAction(db, {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      actionType: "logistics.release_slot",
      resourceRef: reservation.resourceRef,
      provider: "logistics",
      idempotencyKey: key("logistics.release_slot", reservation.resourceRef),
      requestHash: input.brokenCertificateId,
      execute: async () => {
        const [, planId] = reservation.resourceRef.split(":");
        await db.deliveryPlanOption.updateMany({ where: { planId }, data: { capacityRemaining: { increment: reservation.quantityMinor ?? 0 } } });
        return { providerRef: reservation.resourceRef, data: { releasedReservationId: reservation.id } };
      },
    });
    logisticsReceipts.push(receipt);
  }

  const orderReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "sandbox_order.repair_pending",
    resourceRef: input.caseId,
    provider: "sandbox_erp",
    idempotencyKey: key("sandbox_order.repair_pending", input.caseId),
    requestHash: input.brokenCertificateId,
    execute: async () => {
      await markSandboxOrderRepairPending(db, input.caseId);
      return { providerRef: null, data: {} };
    },
  });

  const crmReceipt = await runReceiptedAction(db, {
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    actionType: "crm.stage_update",
    resourceRef: input.caseId,
    provider: "sandbox_crm",
    idempotencyKey: key("crm.stage_update", input.caseId),
    requestHash: input.brokenCertificateId,
    execute: async () => {
      const event = await updateCrmStage(db, { caseId: input.caseId, stage: "repair_needed", note: `Certificate ${input.brokenCertificateId} broken by supplier disruption` });
      return { providerRef: event.id, data: {} };
    },
  });

  return { supplierReceipt, logisticsReceipts, orderReceipt, crmReceipt };
}

export interface TerminalStateReport {
  caseId: string;
  caseStatus: string;
  certificates: Array<{ id: string; status: string }>;
  reservations: Array<{ id: string; domain: string; status: string }>;
  receipts: Array<{ id: string; actionType: string; status: string }>;
}

// Reads database state and returns a deterministic expected-versus-actual report. It
// never asks an LLM to judge correctness (05-TOOL-CONTRACTS.md "verify_terminal_state")
// — the evaluation runner (Task 31) compares this report's fields directly.
export async function verifyTerminalState(db: PrismaClient, caseId: string): Promise<TerminalStateReport> {
  const [dealCase, certificates, reservations, receipts] = await Promise.all([
    db.dealCase.findUniqueOrThrow({ where: { id: caseId } }),
    db.commitCertificate.findMany({ where: { caseId } }),
    db.reservation.findMany({ where: { caseId } }),
    db.actionReceipt.findMany({ where: { caseId } }),
  ]);
  return {
    caseId,
    caseStatus: dealCase.status,
    certificates: certificates.map((c) => ({ id: c.id, status: c.status })),
    reservations: reservations.map((r) => ({ id: r.id, domain: r.domain, status: r.status })),
    receipts: receipts.map((r) => ({ id: r.id, actionType: r.actionType, status: r.status })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/reservations/coordinator.test.ts`
Expected: PASS (10 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/reservations/coordinator.ts src/reservations/coordinator.test.ts
git commit -m "feat: reservation coordinator — break, compensate, verify terminal state"
```

---

### Task 19: ModelGateway interface and FakeModelGateway

This is the swap point named in `02-TECHNICAL-SPEC.md` ("No product component imports an unverified organizer SDK directly"). `FakeModelGateway` is scripted per test — it is not meant to imitate a real role's judgment, only to drive server-side tool-execution code identically to how the real gateway would, deterministically and without a network call.

**Files:**
- Create: `app/src/gateway/modelGateway.ts`
- Create: `app/src/gateway/fakeGateway.ts`
- Test: `app/src/gateway/fakeGateway.test.ts`

- [ ] **Step 1: Write `src/gateway/modelGateway.ts`**

```typescript
import type { RoleId, RoleModelOutput } from "@/lib/types";

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  execute: (args: TArgs) => Promise<TResult>;
}

export interface RoleRunInput {
  role: RoleId;
  systemPrompt: string;
  // A pre-redacted, role-scoped snapshot of case facts — never the raw database row.
  contextSummary: Record<string, unknown>;
  readTools: ToolDefinition[];
  // At most one scoped mutation tool. Sales and Risk always pass null (03-AGENT-ARCHITECTURE.md).
  mutationTool: ToolDefinition | null;
  timeoutMs: number;
}

export interface RoleToolCallLog {
  name: string;
  args: unknown;
  result: unknown;
}

export interface RoleRunResult {
  output: RoleModelOutput;
  toolCalls: RoleToolCallLog[];
  modelId: string;
  gatewayRequestId: string | null;
}

// A role invokes at most one bounded reasoning/tool round (03-AGENT-ARCHITECTURE.md
// "Cost and latency controls"). Every implementation of this interface — real or fake —
// must therefore call each tool's `execute` at most once per `runRole` invocation.
export interface ModelGateway {
  runRole(input: RoleRunInput): Promise<RoleRunResult>;
}
```

- [ ] **Step 2: Write the failing test for `FakeModelGateway`**

```typescript
// src/gateway/fakeGateway.test.ts
import { describe, it, expect, vi } from "vitest";
import { FakeModelGateway } from "./fakeGateway";
import { ToolError } from "@/lib/types";
import type { RoleRunInput } from "./modelGateway";

function baseInput(overrides: Partial<RoleRunInput> = {}): RoleRunInput {
  return {
    role: "inventory",
    systemPrompt: "test prompt",
    contextSummary: {},
    readTools: [],
    mutationTool: { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute: vi.fn().mockResolvedValue({ reservationId: "RES-1" }) },
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("FakeModelGateway", () => {
  it("executes the scripted tool call exactly once and returns its result", async () => {
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_inventory", args: { quantity: 199 } },
      output: { decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: ["EVID-1"], explanation: "Held." },
    }));
    const result = await gateway.runRole(baseInput());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toEqual({ reservationId: "RES-1" });
    expect(result.output.decision).toBe("approve");
  });

  it("throws FORBIDDEN_TOOL when the script names a tool that was not offered", async () => {
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_supplier_option", args: {} },
      output: { decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: [], explanation: "" },
    }));
    await expect(gateway.runRole(baseInput())).rejects.toThrow(ToolError);
  });

  it("validates the scripted output against RoleModelOutputSchema", async () => {
    const gateway = new FakeModelGateway(() => ({
      toolCall: null,
      output: { decision: "maybe" as never, constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: [], explanation: "" },
    }));
    await expect(gateway.runRole(baseInput({ mutationTool: null }))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/gateway/fakeGateway.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Write `src/gateway/fakeGateway.ts`**

```typescript
import { RoleModelOutputSchema, ToolError, type RoleModelOutput } from "@/lib/types";
import type { ModelGateway, RoleRunInput, RoleRunResult } from "./modelGateway";

export interface ScriptedToolCall {
  name: string;
  args: unknown;
}

export interface ScriptedRoleRun {
  toolCall: ScriptedToolCall | null;
  output: RoleModelOutput;
}

export type FakeRoleScript = (input: RoleRunInput) => ScriptedRoleRun;

// A deterministic stand-in for the LLM's tool-use decision. It executes the *real*
// tool-execution code (the same `execute` functions the OpenAI gateway would call), so
// workflow and coordinator tests exercise identical server-side logic without a network
// call. It is not meant to encode business judgment — each test scripts its own roles.
export class FakeModelGateway implements ModelGateway {
  constructor(private readonly script: FakeRoleScript) {}

  async runRole(input: RoleRunInput): Promise<RoleRunResult> {
    const { toolCall, output } = this.script(input);
    const toolCalls: RoleRunResult["toolCalls"] = [];

    if (toolCall) {
      const tool =
        input.readTools.find((t) => t.name === toolCall.name) ??
        (input.mutationTool?.name === toolCall.name ? input.mutationTool : undefined);
      if (!tool) {
        throw new ToolError("FORBIDDEN_TOOL", `Role "${input.role}" attempted to call unregistered tool "${toolCall.name}"`, false);
      }
      const result = await tool.execute(toolCall.args);
      toolCalls.push({ name: toolCall.name, args: toolCall.args, result });
    }

    return {
      output: RoleModelOutputSchema.parse(output),
      toolCalls,
      modelId: "fake-model-v1",
      gatewayRequestId: null,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/gateway/fakeGateway.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/gateway/modelGateway.ts src/gateway/fakeGateway.ts src/gateway/fakeGateway.test.ts
git commit -m "feat: ModelGateway interface and scripted FakeModelGateway"
```

---

### Task 20: OpenAI-backed ModelGateway

Real network calls are not exercised by the fast test suite — this task tests the gateway's contract against an injected fake `openai` client (dependency injection), then Task 24's manual smoke-test step is the first place a real network call happens.

**Files:**
- Create: `app/src/gateway/roleModelOutputJsonSchema.ts`
- Create: `app/src/gateway/openaiGateway.ts`
- Test: `app/src/gateway/openaiGateway.test.ts`

- [ ] **Step 1: Write `src/gateway/roleModelOutputJsonSchema.ts`**

```typescript
// A hand-written JSON Schema mirror of RoleModelOutputSchema (src/lib/types.ts),
// shaped for OpenAI structured outputs strict mode: every object sets
// additionalProperties:false and lists every property as required.
export const ROLE_MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approve", "counter", "veto", "unavailable"] },
    constraints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: { type: "string", enum: ["sales", "finance", "inventory", "procurement", "logistics", "risk"] },
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "blocking"] },
          message: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["domain", "code", "severity", "message", "evidenceRefs"],
      },
    },
    reservationRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: { type: "string", enum: ["credit", "inventory", "supplier", "logistics"] },
          resourceRef: { type: "string" },
          quantity: { type: ["integer", "null"] },
          limitMinor: { type: ["integer", "null"] },
          ttlSeconds: { type: "integer" },
        },
        required: ["domain", "resourceRef", "quantity", "limitMinor", "ttlSeconds"],
      },
    },
    counterterms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: ["payment_terms", "quantity", "delivery_deadline", "discount_bps"] },
          proposedValue: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["field", "proposedValue", "rationale"],
      },
    },
    evidenceRefs: { type: "array", items: { type: "string" } },
    explanation: { type: "string" },
  },
  required: ["decision", "constraints", "reservationRequests", "counterterms", "evidenceRefs", "explanation"],
} as const;
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/gateway/openaiGateway.test.ts
import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIModelGateway } from "./openaiGateway";
import type { RoleRunInput } from "./modelGateway";

const VALID_OUTPUT = {
  decision: "approve",
  constraints: [],
  reservationRequests: [],
  counterterms: [],
  evidenceRefs: ["EVID-1"],
  explanation: "Stock covers the request.",
};

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function baseInput(overrides: Partial<RoleRunInput> = {}): RoleRunInput {
  return {
    role: "inventory",
    systemPrompt: "test prompt",
    contextSummary: { sku: "MAT-10001" },
    readTools: [],
    mutationTool: null,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("OpenAIModelGateway", () => {
  it("skips the tool round when no tools are offered and returns the parsed decision", async () => {
    const client = fakeClient([{ id: "resp-1", choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }] }]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");
    const result = await gateway.runRole(baseInput());
    expect(result.output.decision).toBe("approve");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.gatewayRequestId).toBe("resp-1");
  });

  it("executes a tool call from round one before requesting the final structured decision", async () => {
    const execute = vi.fn().mockResolvedValue({ reservationId: "RES-1" });
    const mutationTool = { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute };
    const client = fakeClient([
      { id: "resp-1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "hold_inventory", arguments: JSON.stringify({ quantity: 199 }) } }] } }] },
      { id: "resp-2", choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }] },
    ]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");
    const result = await gateway.runRole(baseInput({ mutationTool }));
    expect(execute).toHaveBeenCalledWith({ quantity: 199 });
    expect(result.toolCalls).toEqual([{ name: "hold_inventory", args: { quantity: 199 }, result: { reservationId: "RES-1" } }]);
    expect(result.output.decision).toBe("approve");
  });

  it("rejects a final response that does not validate against RoleModelOutputSchema", async () => {
    const client = fakeClient([{ id: "resp-1", choices: [{ message: { content: JSON.stringify({ decision: "maybe" }) } }] }]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");
    await expect(gateway.runRole(baseInput())).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/gateway/openaiGateway.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Write `src/gateway/openaiGateway.ts`**

```typescript
import type OpenAI from "openai";
import { RoleModelOutputSchema, type RoleModelOutput } from "@/lib/types";
import type { ModelGateway, RoleRunInput, RoleRunResult, ToolDefinition } from "./modelGateway";
import { ROLE_MODEL_OUTPUT_JSON_SCHEMA } from "./roleModelOutputJsonSchema";

function toOpenAITool(tool: ToolDefinition) {
  return { type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.parametersSchema } };
}

// Concrete ModelGateway backed by real OpenAI calls (locked scope decision: this
// substitutes for the organizer's ApplyBee/Hive gateway, which is undocumented outside
// its hackathon). Runs at most one tool-calling round, then a second call with no
// tools offered and response_format=json_schema for the final typed decision — this is
// the "one bounded reasoning/tool round plus one schema-repair retry" from
// 03-AGENT-ARCHITECTURE.md, with the schema-repair retry handled by the caller
// (roleRuntime.ts, Task 22) rather than inside the gateway itself.
export class OpenAIModelGateway implements ModelGateway {
  constructor(
    private readonly client: OpenAI,
    private readonly modelId: string,
  ) {}

  async runRole(input: RoleRunInput): Promise<RoleRunResult> {
    const tools = [...input.readTools, ...(input.mutationTool ? [input.mutationTool] : [])];
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: JSON.stringify(input.contextSummary) },
    ];

    const toolCalls: RoleRunResult["toolCalls"] = [];
    let gatewayRequestId: string | null = null;

    if (tools.length > 0) {
      const first = await this.client.chat.completions.create(
        { model: this.modelId, messages, tools: tools.map(toOpenAITool), tool_choice: "auto" },
        { timeout: input.timeoutMs },
      );
      gatewayRequestId = first.id;
      const message = first.choices[0]!.message;
      messages.push(message);

      const call = message.tool_calls?.[0];
      if (call && call.type === "function") {
        const tool = tools.find((t) => t.name === call.function.name);
        if (tool) {
          const args = JSON.parse(call.function.arguments || "{}");
          const result = await tool.execute(args);
          toolCalls.push({ name: tool.name, args, result });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
    }

    const final = await this.client.chat.completions.create(
      {
        model: this.modelId,
        messages: [...messages, { role: "user", content: "Return your final decision now as the required JSON object." }],
        response_format: { type: "json_schema", json_schema: { name: "role_model_output", strict: true, schema: ROLE_MODEL_OUTPUT_JSON_SCHEMA } },
      },
      { timeout: input.timeoutMs },
    );
    gatewayRequestId = final.id;

    const raw = final.choices[0]!.message.content ?? "{}";
    const output: RoleModelOutput = RoleModelOutputSchema.parse(JSON.parse(raw));

    return { output, toolCalls, modelId: this.modelId, gatewayRequestId };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/gateway/openaiGateway.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Manual smoke test against the real API (do this once, outside the automated suite)**

```bash
cd app
node --env-file=.env.local -e '
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
client.chat.completions.create({
  model: process.env.OPENAI_MODEL_ID,
  messages: [{ role: "user", content: "Reply with the single word: ready" }],
}).then(r => console.log(r.choices[0].message.content));
'
```

Expected: prints `ready` (or similar), confirming the API key and model id work before wiring real role calls in Task 24. This is a one-time manual check, not part of `npm test`.

- [ ] **Step 7: Commit**

```bash
git add src/gateway/roleModelOutputJsonSchema.ts src/gateway/openaiGateway.ts src/gateway/openaiGateway.test.ts
git commit -m "feat: OpenAI-backed ModelGateway with one bounded tool round"
```

---

### Task 21: Role tool permissions and read tools

**Files:**
- Create: `app/src/roles/toolPermissions.ts`
- Create: `app/src/roles/tools/readTools.ts`
- Test: `app/src/roles/toolPermissions.test.ts`
- Test: `app/src/roles/tools/readTools.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/roles/toolPermissions.test.ts
import { describe, it, expect } from "vitest";
import { isReadToolAllowed, MUTATION_TOOL_BY_ROLE } from "./toolPermissions";

describe("isReadToolAllowed", () => {
  it("allows Sales and Risk to read deal context, and no one else", () => {
    expect(isReadToolAllowed("sales", "get_deal_context")).toBe(true);
    expect(isReadToolAllowed("risk", "get_deal_context")).toBe(true);
    expect(isReadToolAllowed("finance", "get_deal_context")).toBe(false);
  });

  it("allows Inventory, Logistics, and Risk to read inventory positions", () => {
    expect(isReadToolAllowed("inventory", "get_inventory_positions")).toBe(true);
    expect(isReadToolAllowed("logistics", "get_inventory_positions")).toBe(true);
    expect(isReadToolAllowed("risk", "get_inventory_positions")).toBe(true);
    expect(isReadToolAllowed("procurement", "get_inventory_positions")).toBe(false);
  });
});

describe("MUTATION_TOOL_BY_ROLE", () => {
  it("gives exactly one scoped hold tool to Finance, Inventory, Procurement, and Logistics, and none to Sales or Risk", () => {
    expect(MUTATION_TOOL_BY_ROLE.finance).toBe("hold_credit_envelope");
    expect(MUTATION_TOOL_BY_ROLE.inventory).toBe("hold_inventory");
    expect(MUTATION_TOOL_BY_ROLE.procurement).toBe("hold_supplier_option");
    expect(MUTATION_TOOL_BY_ROLE.logistics).toBe("hold_delivery_slot");
    expect(MUTATION_TOOL_BY_ROLE.sales).toBeUndefined();
    expect(MUTATION_TOOL_BY_ROLE.risk).toBeUndefined();
  });
});
```

```typescript
// src/roles/tools/readTools.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { getDealContext, getCustomerCredit, getInventoryPositions, getSupplierOptions, getDeliveryOptions } from "./readTools";

describe("readTools", () => {
  beforeEach(resetTestDb);

  it("getDealContext returns the current active terms version, not a stale one", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 2, status: "evaluating", createdBy: "seed" } });
    await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
    await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 2, source: "counteroffer", termsHash: "hash-2", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "ADVANCE_30", deliveryDeadline: new Date("2026-09-12") } });

    const evidence = await getDealContext(testDb, dealCase.id);
    expect(evidence.data.currentTerms.paymentTerms).toBe("ADVANCE_30");
    expect(evidence.evidenceId).toMatch(/^EVID-/);
  });

  it("getCustomerCredit returns the customer's current policy fields", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const customer = await testDb.customer.create({ data: { companyId: company.id, name: "Beacon", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: ["ADVANCE_30"], policyVersion: "credit-policy-v1" } });
    const evidence = await getCustomerCredit(testDb, customer.id);
    expect(evidence.data.creditLimitMinor).toBe(200_000_000);
  });

  it("getInventoryPositions returns every warehouse position for the SKU", async () => {
    await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 } });
    const evidence = await getInventoryPositions(testDb, "MAT-10001");
    expect(evidence.data.positions).toHaveLength(1);
    expect(evidence.data.positions[0]!.availableQuantity).toBe(199);
  });

  it("getSupplierOptions returns every option for the SKU", async () => {
    await testDb.supplierOption.create({ data: { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" } });
    const evidence = await getSupplierOptions(testDb, "MAT-10001");
    expect(evidence.data.options).toHaveLength(1);
    expect(evidence.data.options[0]!.supplierId).toBe("VEND-2003");
  });

  it("getDeliveryOptions returns every plan for the destination", async () => {
    await testDb.deliveryPlanOption.create({ data: { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDate: new Date("2026-09-12"), costMinor: 400_000, splitShipment: true, capacityRemaining: 350 } });
    const evidence = await getDeliveryOptions(testDb, "ZONE-SOUTH");
    expect(evidence.data.plans).toHaveLength(1);
    expect(evidence.data.plans[0]!.splitShipment).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/roles/toolPermissions.test.ts src/roles/tools/readTools.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write `src/roles/toolPermissions.ts`**

```typescript
import type { RoleId } from "@/lib/types";

// From 05-TOOL-CONTRACTS.md "Read tools" — which roles may call which read tool.
export const READ_TOOL_PERMISSIONS: Record<string, RoleId[]> = {
  get_deal_context: ["sales", "risk"],
  get_customer_credit: ["finance", "risk"],
  get_inventory_positions: ["inventory", "logistics", "risk"],
  get_supplier_options: ["procurement", "risk"],
  get_delivery_options: ["logistics", "risk"],
};

export function isReadToolAllowed(role: RoleId, toolName: string): boolean {
  return READ_TOOL_PERMISSIONS[toolName]?.includes(role) ?? false;
}

// From 05-TOOL-CONTRACTS.md "Reservation tools" — at most one scoped mutation tool per
// role. Sales and Risk intentionally have none (03-AGENT-ARCHITECTURE.md: "Risk has no
// mutation tools"; Sales "cannot hold resources").
export const MUTATION_TOOL_BY_ROLE: Partial<Record<RoleId, string>> = {
  finance: "hold_credit_envelope",
  inventory: "hold_inventory",
  procurement: "hold_supplier_option",
  logistics: "hold_delivery_slot",
};
```

- [ ] **Step 4: Write `src/roles/tools/readTools.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { DealTerms, Evidence, PaymentTerms } from "@/lib/types";
import { newId } from "@/lib/ids";

function evidenceEnvelope<T>(source: string, data: T): Evidence<T> {
  return { evidenceId: newId("EVID"), observedAt: new Date().toISOString(), source, data };
}

export async function getDealContext(db: PrismaClient, caseId: string) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId, version: dealCase.activeTermsVersion } });
  return evidenceEnvelope("deal_case", {
    customerId: dealCase.customerId,
    strategicTier: "standard" as const,
    currentTerms: {
      sku: terms.sku,
      quantity: terms.quantity,
      currency: "INR" as const,
      totalValueMinor: terms.totalValueMinor,
      discountBps: terms.discountBps,
      paymentTerms: terms.paymentTerms as PaymentTerms,
      deliveryDeadline: terms.deliveryDeadline.toISOString(),
    } satisfies DealTerms,
    permittedCommercialLevers: ["ADVANCE_30"],
  });
}

export async function getCustomerCredit(db: PrismaClient, customerId: string) {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
  return evidenceEnvelope("customer", {
    creditLimitMinor: customer.creditLimitMinor,
    currentExposureMinor: customer.currentExposureMinor,
    overdueReceivablesMinor: customer.overdueReceivablesMinor,
    allowedPaymentTerms: customer.allowedPaymentTerms as string[],
    policyVersion: customer.policyVersion,
  });
}

export async function getInventoryPositions(db: PrismaClient, sku: string) {
  const positions = await db.inventoryPosition.findMany({ where: { sku } });
  return evidenceEnvelope("inventory_position", {
    positions: positions.map((p) => ({ warehouseId: p.warehouseId, availableQuantity: p.availableQuantity, earliestHoldExpiry: p.earliestHoldExpiry?.toISOString() ?? null })),
  });
}

export async function getSupplierOptions(db: PrismaClient, sku: string) {
  const options = await db.supplierOption.findMany({ where: { sku } });
  return evidenceEnvelope("supplier_option", {
    options: options.map((o) => ({ supplierId: o.supplierId, availableQuantity: o.availableQuantity, unitCostMinor: o.unitCostMinor, leadDays: o.leadDays, optionTtlSeconds: o.optionTtlSeconds, status: o.status })),
  });
}

export async function getDeliveryOptions(db: PrismaClient, destinationId: string) {
  const plans = await db.deliveryPlanOption.findMany({ where: { destinationId } });
  return evidenceEnvelope("delivery_plan_option", {
    plans: plans.map((p) => ({ planId: p.planId, deliveredQuantity: p.deliveredQuantity, deliveryDate: p.deliveryDate.toISOString(), costMinor: p.costMinor, splitShipment: p.splitShipment, capacityRemaining: p.capacityRemaining })),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run src/roles/toolPermissions.test.ts src/roles/tools/readTools.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/roles/toolPermissions.ts src/roles/toolPermissions.test.ts src/roles/tools/readTools.ts src/roles/tools/readTools.test.ts
git commit -m "feat: role tool permission map and deterministic read tools"
```

---

### Task 22: Role configs and role runtime

This is `runRoleAgent` from `03-AGENT-ARCHITECTURE.md`: it loads only permitted context, builds the tool set the role is allowed to see, calls the gateway, validates the output, and persists a `DomainDecision`. **Simplification from spec, called out explicitly:** the spec separates "model timeout" (no automatic retry) from "invalid structured output" (one automatic retry) as two reliability behaviors. This build collapses both into one automatic retry before falling back to `unavailable`, which is strictly more conservative (never grants an approval it shouldn't) and keeps the runtime to one code path. Revisit if the real behaviors need to diverge later.

**Files:**
- Create: `app/src/roles/toolRegistry.ts`
- Create: `app/src/roles/roleConfigs.ts`
- Create: `app/src/roles/roleRuntime.ts`
- Test: `app/src/roles/roleRuntime.test.ts`

- [ ] **Step 1: Write `src/roles/toolRegistry.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { RoleId, PaymentTerms } from "@/lib/types";
import type { ToolDefinition } from "@/gateway/modelGateway";
import { getDealContext, getCustomerCredit, getInventoryPositions, getSupplierOptions, getDeliveryOptions } from "./tools/readTools";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdSupplierOption } from "@/adapters/supplierAdapter";
import { holdDeliverySlot } from "@/adapters/logisticsAdapter";
import { MUTATION_TOOL_BY_ROLE } from "./toolPermissions";

export interface ReadToolContext {
  caseId: string;
  customerId: string;
  sku: string;
  destinationId: string;
}

const EMPTY_PARAMS = { type: "object", properties: {}, additionalProperties: false } as const;

export function buildReadTool(db: PrismaClient, name: string, ctx: ReadToolContext): ToolDefinition {
  switch (name) {
    case "get_deal_context":
      return { name, description: "Read the current deal context and permitted commercial levers.", parametersSchema: EMPTY_PARAMS, execute: async () => getDealContext(db, ctx.caseId) };
    case "get_customer_credit":
      return { name, description: "Read the customer's credit limit, exposure, and allowed payment terms.", parametersSchema: EMPTY_PARAMS, execute: async () => getCustomerCredit(db, ctx.customerId) };
    case "get_inventory_positions":
      return { name, description: "Read current warehouse inventory for the SKU.", parametersSchema: EMPTY_PARAMS, execute: async () => getInventoryPositions(db, ctx.sku) };
    case "get_supplier_options":
      return { name, description: "Read available supplier options for the SKU.", parametersSchema: EMPTY_PARAMS, execute: async () => getSupplierOptions(db, ctx.sku) };
    case "get_delivery_options":
      return { name, description: "Read available delivery plans to the destination.", parametersSchema: EMPTY_PARAMS, execute: async () => getDeliveryOptions(db, ctx.destinationId) };
    default:
      throw new Error(`Unknown read tool "${name}"`);
  }
}

export interface MutationToolContext {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  sku: string;
  customerId: string;
  paymentTerms: PaymentTerms;
}

export function buildMutationTool(db: PrismaClient, role: RoleId, ctx: MutationToolContext): ToolDefinition | null {
  const name = MUTATION_TOOL_BY_ROLE[role];
  if (!name) return null;

  if (name === "hold_credit_envelope") {
    return {
      name,
      description: "Hold a credit exposure envelope for the proposed terms.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["exposureMinor", "ttlSeconds"], properties: { exposureMinor: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (args: { exposureMinor: number; ttlSeconds: number }) =>
        holdCreditEnvelope(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, customerId: ctx.customerId, paymentTerms: ctx.paymentTerms, exposureMinor: args.exposureMinor, ttlSeconds: args.ttlSeconds }),
    };
  }
  if (name === "hold_inventory") {
    return {
      name,
      description: "Hold available inventory for the SKU at a warehouse.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["warehouseId", "quantity", "ttlSeconds"], properties: { warehouseId: { type: "string" }, quantity: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (args: { warehouseId: string; quantity: number; ttlSeconds: number }) =>
        holdInventory(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, sku: ctx.sku, warehouseId: args.warehouseId, quantity: args.quantity, ttlSeconds: args.ttlSeconds }),
    };
  }
  if (name === "hold_supplier_option") {
    return {
      name,
      description: "Hold a supplier option covering the shortfall quantity.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["supplierId", "quantity", "maxUnitCostMinor", "maxLeadDays", "ttlSeconds"], properties: { supplierId: { type: "string" }, quantity: { type: "integer" }, maxUnitCostMinor: { type: "integer" }, maxLeadDays: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (args: { supplierId: string; quantity: number; maxUnitCostMinor: number; maxLeadDays: number; ttlSeconds: number }) =>
        holdSupplierOption(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, sku: ctx.sku, ...args }),
    };
  }
  if (name === "hold_delivery_slot") {
    return {
      name,
      description: "Hold delivery capacity on an existing plan.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["planId", "quantity", "ttlSeconds"], properties: { planId: { type: "string" }, quantity: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (args: { planId: string; quantity: number; ttlSeconds: number }) =>
        holdDeliverySlot(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, ...args }),
    };
  }
  return null;
}
```

- [ ] **Step 2: Write `src/roles/roleConfigs.ts`**

```typescript
import type { RoleId } from "@/lib/types";

export interface RoleConfig {
  role: RoleId;
  objective: string;
  visibleContextSelectors: string[];
  allowedReadTools: string[];
  allowedMutationTools: string[];
  authority: string[];
  memoryNamespace: string;
}

// From 03-AGENT-ARCHITECTURE.md "Role definitions". Each role gets its own objective,
// visible context, tools, and authority — never the union of all six.
export const ROLE_CONFIGS: Record<RoleId, RoleConfig> = {
  sales: {
    role: "sales",
    objective: "Maximize acceptable account value while proposing only bounded terms supported by other domains.",
    visibleContextSelectors: ["dealContext"],
    allowedReadTools: ["get_deal_context"],
    allowedMutationTools: [],
    authority: ["propose_terms", "propose_counterterm"],
    memoryNamespace: "role:sales",
  },
  finance: {
    role: "finance",
    objective: "Protect contribution margin, credit exposure, and working-capital policy.",
    visibleContextSelectors: ["customerCredit", "dealEconomics"],
    allowedReadTools: ["get_customer_credit"],
    allowedMutationTools: ["hold_credit_envelope"],
    authority: ["approve_credit", "counter_credit", "veto_credit"],
    memoryNamespace: "role:finance",
  },
  inventory: {
    role: "inventory",
    objective: "Allocate currently available stock without violating existing commitments.",
    visibleContextSelectors: ["inventoryPositions"],
    allowedReadTools: ["get_inventory_positions"],
    allowedMutationTools: ["hold_inventory"],
    authority: ["approve_allocation", "veto_allocation"],
    memoryNamespace: "role:inventory",
  },
  procurement: {
    role: "procurement",
    objective: "Cover supply shortfall at permitted cost and lead time.",
    visibleContextSelectors: ["supplierOptions"],
    allowedReadTools: ["get_supplier_options"],
    allowedMutationTools: ["hold_supplier_option"],
    authority: ["approve_supply", "counter_supply", "veto_supply"],
    memoryNamespace: "role:procurement",
  },
  logistics: {
    role: "logistics",
    objective: "Produce a deliverable shipment plan using only backed quantities.",
    visibleContextSelectors: ["inventoryPositions", "deliveryOptions"],
    allowedReadTools: ["get_inventory_positions", "get_delivery_options"],
    allowedMutationTools: ["hold_delivery_slot"],
    authority: ["approve_delivery", "counter_delivery", "veto_delivery"],
    memoryNamespace: "role:logistics",
  },
  risk: {
    role: "risk",
    objective: "Falsify unsafe commitments and expose stale or unsupported evidence.",
    visibleContextSelectors: ["dealContext", "customerCredit", "inventoryPositions", "supplierOptions", "deliveryOptions"],
    allowedReadTools: ["get_deal_context", "get_customer_credit", "get_inventory_positions", "get_supplier_options", "get_delivery_options"],
    allowedMutationTools: [],
    authority: ["challenge", "veto"],
    memoryNamespace: "role:risk",
  },
};

const PROMPT_RULES =
  "Missing or stale evidence must produce decision=unavailable or decision=veto, never approve. " +
  "Never invent a receipt, identifier, balance, quantity, price, or date; use only values a tool returned. " +
  "Deterministic tool results override your own reasoning if they conflict. " +
  "You may not claim that another role approved anything. " +
  "You may call at most one tool during this run.";

// Short, role-specific, stored in versioned source code — never dynamically rewritten
// based on agent output (03-AGENT-ARCHITECTURE.md "Prompt requirements").
export function buildSystemPrompt(config: RoleConfig): string {
  return [
    `You are the ${config.role} role agent in CommitOS. Objective: ${config.objective}`,
    `Your authority is limited to: ${config.authority.join(", ")}.`,
    `Allowed tools: ${[...config.allowedReadTools, ...config.allowedMutationTools].join(", ") || "none"}.`,
    PROMPT_RULES,
    "Respond only with the required structured decision object.",
  ].join(" ");
}
```

- [ ] **Step 3: Write the failing test for the runtime**

```typescript
// src/roles/roleRuntime.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runRoleAgent } from "./roleRuntime";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { ModelGateway } from "@/gateway/modelGateway";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" } });
  await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 } });
  return dealCase;
}

const baseInput = (dealCase: { id: string }) => ({
  role: "inventory" as const,
  caseId: dealCase.id,
  caseVersion: 1,
  termsHash: "hash-1",
  contextSummary: { requestedQuantity: 350 },
  toolContext: { customerId: "CUST-1", sku: "MAT-10001", destinationId: "ZONE-SOUTH", paymentTerms: "NET_60" as const },
  traceId: "trace-1",
  timeoutMs: 200,
});

describe("runRoleAgent", () => {
  beforeEach(resetTestDb);

  it("executes the role's scoped mutation tool and persists a DomainDecision", async () => {
    const dealCase = await seedCase();
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 600 } },
      output: { decision: "counter", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: ["EVID-1"], explanation: "Can only cover 199 of 350 units." },
    }));

    const decision = await runRoleAgent(testDb, gateway, baseInput(dealCase), "fake-model-v1");
    expect(decision.role).toBe("inventory");
    expect(decision.decision).toBe("counter");
    expect(decision.caseId).toBe(dealCase.id);

    const stored = await testDb.domainDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(stored.role).toBe("inventory");

    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: dealCase.id, domain: "inventory" } });
    expect(reservation.quantityMinor).toBe(199);
  });

  it("marks the role unavailable and still persists a decision when the gateway never responds", async () => {
    const dealCase = await seedCase();
    const neverRespondingGateway: ModelGateway = { runRole: () => new Promise(() => {}) };

    const decision = await runRoleAgent(testDb, neverRespondingGateway, baseInput(dealCase), "fake-model-v1");
    expect(decision.decision).toBe("unavailable");

    const stored = await testDb.domainDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(stored.decision).toBe("unavailable");
  }, 10_000);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd app && npx vitest run src/roles/roleRuntime.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Write `src/roles/roleRuntime.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { DomainDecisionSchema, type DomainDecision, type PaymentTerms, type RoleId, type RoleModelOutput } from "@/lib/types";
import { newId } from "@/lib/ids";
import { ROLE_CONFIGS, buildSystemPrompt } from "./roleConfigs";
import { buildReadTool, buildMutationTool } from "./toolRegistry";

export interface RunRoleAgentInput {
  role: RoleId;
  caseId: string;
  caseVersion: number;
  termsHash: string;
  contextSummary: Record<string, unknown>;
  toolContext: { customerId: string; sku: string; destinationId: string; paymentTerms: PaymentTerms };
  traceId: string;
  timeoutMs: number;
}

const DECISION_FRESHNESS_MS = 15 * 60 * 1000;

// Loads only permitted context, exposes only allowed tools, calls the gateway with
// structured output enabled, validates the result, and persists the decision with
// trace and case-version metadata (03-AGENT-ARCHITECTURE.md "Shared runtime").
export async function runRoleAgent(db: PrismaClient, gateway: ModelGateway, input: RunRoleAgentInput, fallbackModelId: string): Promise<DomainDecision> {
  const config = ROLE_CONFIGS[input.role];
  const systemPrompt = buildSystemPrompt(config);
  const readTools = config.allowedReadTools.map((name) => buildReadTool(db, name, { caseId: input.caseId, customerId: input.toolContext.customerId, sku: input.toolContext.sku, destinationId: input.toolContext.destinationId }));
  const mutationTool = buildMutationTool(db, input.role, { caseId: input.caseId, caseVersion: input.caseVersion, termsHash: input.termsHash, sku: input.toolContext.sku, customerId: input.toolContext.customerId, paymentTerms: input.toolContext.paymentTerms });

  const attempt = () => withTimeout(gateway.runRole({ role: input.role, systemPrompt, contextSummary: input.contextSummary, readTools, mutationTool, timeoutMs: input.timeoutMs }), input.timeoutMs);

  try {
    const result = await attempt();
    return persistDecision(db, input, result.output, result.modelId, result.gatewayRequestId);
  } catch (firstError) {
    try {
      const result = await attempt();
      return persistDecision(db, input, result.output, result.modelId, result.gatewayRequestId);
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      const fallback: RoleModelOutput = { decision: "unavailable", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: [], explanation: `Role unavailable after retry: ${message}` };
      return persistDecision(db, input, fallback, fallbackModelId, null);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Role run timed out")), timeoutMs))]);
}

async function persistDecision(db: PrismaClient, input: RunRoleAgentInput, output: RoleModelOutput, modelId: string, gatewayRequestId: string | null): Promise<DomainDecision> {
  const decisionId = newId("DEC");
  const expiresAt = new Date(Date.now() + DECISION_FRESHNESS_MS).toISOString();
  const decision = DomainDecisionSchema.parse({
    ...output,
    decisionId,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    termsHash: input.termsHash,
    role: input.role,
    expiresAt,
  });
  await db.domainDecision.create({
    data: {
      id: decisionId,
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      role: input.role,
      decision: output.decision,
      payload: decision as unknown as Prisma.InputJsonValue,
      evidenceRefs: output.evidenceRefs as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(expiresAt),
      modelId,
      gatewayRequestId,
      traceId: input.traceId,
    },
  });
  return decision;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/roles/roleRuntime.test.ts`
Expected: PASS (2 tests; the second takes roughly 2× `timeoutMs` because it exercises both attempts).

- [ ] **Step 7: Commit**

```bash
git add src/roles/toolRegistry.ts src/roles/roleConfigs.ts src/roles/roleRuntime.ts src/roles/roleRuntime.test.ts
git commit -m "feat: role configs, system prompts, and the shared role runtime"
```

---

### Task 23: Fixture world-state and seed script

The three fixtures share the same underlying world-state shape; `CASE-STALE-SUPPLIER-HOLD`'s staleness is injected by the test itself (Task 28), not by different seed data — the spec describes it as a timing failure, not a different starting inventory. `CASE-POST-COMMIT-DISRUPTION` additionally seeds an idle `VEND-2005` option and a second delivery plan that only get used after the disruption.

**Files:**
- Create: `app/src/fixtures/definitions.ts`
- Create: `app/src/fixtures/seedFixture.ts`
- Create: `app/prisma/seed.ts`
- Test: `app/src/fixtures/seedFixture.test.ts`

- [ ] **Step 1: Write `src/fixtures/definitions.ts`**

```typescript
import type { CaseStatus, PaymentTerms } from "@/lib/types";

export interface FixtureDefinition {
  fixtureId: string;
  companyName: string;
  customer: {
    name: string;
    creditLimitMinor: number;
    currentExposureMinor: number;
    overdueReceivablesMinor: number;
    allowedPaymentTerms: string[];
    policyVersion: string;
  };
  inventory: Array<{ sku: string; warehouseId: string; availableQuantity: number }>;
  supplierOptions: Array<{ supplierId: string; sku: string; availableQuantity: number; unitCostMinor: number; leadDays: number; optionTtlSeconds: number; status: string }>;
  deliveryPlans: Array<{ planId: string; originWarehouseId: string; destinationId: string; deliveredQuantity: number; deliveryDateOffsetDays: number; costMinor: number; splitShipment: boolean; capacityRemaining: number }>;
  initialTerms: { sku: string; quantity: number; totalValueMinor: number; discountBps: number; paymentTerms: PaymentTerms; deliveryDeadlineOffsetDays: number };
  unitCostMinor: number;
  expectedTerminalState: CaseStatus;
}

// Every literal below is sourced from the real ERP extracts in
// /Users/eidoviscontact/Documents/Novel/Data/*.csv (MARA, MARD, MBEW, LFA1, KNKK,
// TVRO) rather than an invented fixture — see the provenance comment on each field.
const CUSTOMER = {
  name: "Beacon Electronics", // this build's display name for KNKK.KUNNR = CUST-1010
  creditLimitMinor: 200_000_000, // Rs 20L — KNKK.KLIMK for CUST-1010 = 2,000,000 rupees; see Task 6/7 for how this makes NET_60 breach and ADVANCE_30 pass
  currentExposureMinor: 74_346_569, // KNKK.SKFOR for CUST-1010 = Rs 7,43,465.69 in paise
  overdueReceivablesMinor: 0,
  allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"],
  policyVersion: "credit-policy-v1",
};

const INITIAL_TERMS = {
  sku: "MAT-10001", // MARA.MATNR — "Schneider Electric MCB 32A"
  quantity: 350,
  totalValueMinor: 147_000_000, // 350 x MARA.NETPR (Rs 4,200) x 100 = Rs 14,70,000
  discountBps: 1000,
  paymentTerms: "NET_60" as PaymentTerms,
  deliveryDeadlineOffsetDays: 21,
};

export const FIXTURE_FEASIBLE_AFTER_ADVANCE: FixtureDefinition = {
  fixtureId: "CASE-FEASIBLE-AFTER-ADVANCE",
  companyName: "Acme Distribution — Feasible After Advance",
  customer: CUSTOMER,
  // MARD.LABST for MAT-10001 at plant PL03 (warehouse WH-BLR) = 199 units
  inventory: [{ sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 }],
  // LFA1: VEND-2003 = Siemens Ltd India, NETPR=2891.37 -> 289_137 paise, WEBAZ=18 lead
  // days. Real LFA1.AVAIL_CAP is 221; sized here to the 350-199=151 shortfall so the
  // "decrements to zero" assertions elsewhere in this plan stay exact.
  supplierOptions: [{ supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" }],
  // TVRO: RT-BLR-HYD, carrier BlueDart, TTIME=1 day transit from WH-BLR to ZONE-SOUTH.
  // deliveryDateOffsetDays (20) covers VEND-2003's 18-day lead plus 1-day transit,
  // inside the 21-day deadline.
  deliveryPlans: [{ planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDateOffsetDays: 20, costMinor: 400_000, splitShipment: true, capacityRemaining: 350 }],
  initialTerms: INITIAL_TERMS,
  unitCostMinor: 293_312, // MBEW.STPRS for MAT-10001 (Rs 2,933.12)
  expectedTerminalState: "committed",
};

export const FIXTURE_STALE_SUPPLIER_HOLD: FixtureDefinition = {
  ...FIXTURE_FEASIBLE_AFTER_ADVANCE,
  fixtureId: "CASE-STALE-SUPPLIER-HOLD",
  companyName: "Acme Distribution — Stale Supplier Hold",
  expectedTerminalState: "cannot_commit",
};

export const FIXTURE_POST_COMMIT_DISRUPTION: FixtureDefinition = {
  fixtureId: "CASE-POST-COMMIT-DISRUPTION",
  companyName: "Acme Distribution — Post-Commit Disruption",
  customer: CUSTOMER,
  inventory: [{ sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 }],
  supplierOptions: [
    { supplierId: "VEND-2003", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 289_137, leadDays: 18, optionTtlSeconds: 900, status: "available" },
    // LFA1: VEND-2005 = L&T Electrical & Automation, NETPR=2922.42 -> 292_242 paise,
    // WEBAZ=16 lead days. Real AVAIL_CAP is 375; sized here to the same 151-unit
    // shortfall this idle option replaces after VEND-2003 is disrupted.
    { supplierId: "VEND-2005", sku: "MAT-10001", availableQuantity: 151, unitCostMinor: 292_242, leadDays: 16, optionTtlSeconds: 900, status: "available" },
  ],
  deliveryPlans: [
    { planId: "RT-BLR-HYD", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 350, deliveryDateOffsetDays: 20, costMinor: 400_000, splitShipment: true, capacityRemaining: 350 },
    // TVRO: RT-BLR-CHE, carrier FedEx, TTIME=1 day transit, VSTEL=WH-BLR (same origin
    // shipping point as RT-BLR-HYD). Idle until the repair workflow (Task 27) reserves
    // it for VEND-2005's 16-day lead + 1-day transit, inside the 21-day deadline.
    { planId: "RT-BLR-CHE", originWarehouseId: "WH-BLR", destinationId: "ZONE-SOUTH", deliveredQuantity: 151, deliveryDateOffsetDays: 18, costMinor: 450_000, splitShipment: true, capacityRemaining: 151 },
  ],
  initialTerms: INITIAL_TERMS,
  unitCostMinor: 293_312,
  expectedTerminalState: "repaired",
};

export const ALL_FIXTURES: FixtureDefinition[] = [FIXTURE_FEASIBLE_AFTER_ADVANCE, FIXTURE_STALE_SUPPLIER_HOLD, FIXTURE_POST_COMMIT_DISRUPTION];
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/fixtures/seedFixture.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { seedFixture } from "./seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "./definitions";

describe("seedFixture", () => {
  beforeEach(resetTestDb);

  it("creates a case tagged with the fixture id and its world-state rows", async () => {
    const { dealCase, customer } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    expect(dealCase.fixtureId).toBe("CASE-FEASIBLE-AFTER-ADVANCE");
    expect(dealCase.status).toBe("intake");

    const terms = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: 1 } });
    expect(terms.quantity).toBe(350);
    expect(terms.paymentTerms).toBe("NET_60");

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(199);
    expect(customer.creditLimitMinor).toBe(200_000_000);
  });

  it("is re-runnable: seeding the same fixture twice resets it instead of duplicating it", async () => {
    const first = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.dealCase.update({ where: { id: first.dealCase.id }, data: { status: "committed" } });
    const second = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);

    expect(second.dealCase.status).toBe("intake"); // reset, not left as "committed"
    const cases = await testDb.dealCase.findMany({ where: { fixtureId: "CASE-FEASIBLE-AFTER-ADVANCE" } });
    expect(cases).toHaveLength(1); // no duplicate row
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/fixtures/seedFixture.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Write `src/fixtures/seedFixture.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { canonicalTermsHash } from "@/lib/hash";
import type { FixtureDefinition } from "./definitions";

async function deleteCaseAndRelations(db: PrismaClient, caseId: string) {
  await db.outboxMessage.deleteMany({ where: { caseId } });
  await db.stripeCheckoutMock.deleteMany({ where: { caseId } });
  await db.crmStageEvent.deleteMany({ where: { caseId } });
  await db.sandboxOrder.deleteMany({ where: { caseId } });
  await db.caseEvent.deleteMany({ where: { caseId } });
  await db.actionReceipt.deleteMany({ where: { caseId } });
  await db.reservation.deleteMany({ where: { caseId } });
  await db.commitCertificate.deleteMany({ where: { caseId } });
  await db.counteroffer.deleteMany({ where: { caseId } });
  await db.domainDecision.deleteMany({ where: { caseId } });
  await db.termsVersion.deleteMany({ where: { caseId } });
  await db.dealCase.delete({ where: { id: caseId } });
}

// Inserts one isolated company/case per fixture, or resets that fixture's own
// namespace transactionally if it already exists. It never touches a case that is not
// tagged with this fixture id (04-DATA-AND-STATE-SPEC.md "Seeded evaluation cases").
export async function seedFixture(db: PrismaClient, fixture: FixtureDefinition) {
  const existing = await db.dealCase.findFirst({ where: { fixtureId: fixture.fixtureId } });
  if (existing) await deleteCaseAndRelations(db, existing.id);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const company = await db.company.create({ data: { name: fixture.companyName } });
  const customer = await db.customer.create({ data: { companyId: company.id, ...fixture.customer } });

  for (const position of fixture.inventory) {
    await db.inventoryPosition.create({ data: position });
  }
  for (const option of fixture.supplierOptions) {
    await db.supplierOption.create({ data: option });
  }
  for (const plan of fixture.deliveryPlans) {
    const { deliveryDateOffsetDays, ...rest } = plan;
    await db.deliveryPlanOption.create({ data: { ...rest, deliveryDate: new Date(now + deliveryDateOffsetDays * dayMs) } });
  }

  const deliveryDeadline = new Date(now + fixture.initialTerms.deliveryDeadlineOffsetDays * dayMs);
  const termsHash = canonicalTermsHash({
    sku: fixture.initialTerms.sku,
    quantity: fixture.initialTerms.quantity,
    totalValueMinor: fixture.initialTerms.totalValueMinor,
    discountBps: fixture.initialTerms.discountBps,
    paymentTerms: fixture.initialTerms.paymentTerms,
    deliveryDeadline: deliveryDeadline.toISOString(),
  });

  const dealCase = await db.dealCase.create({
    data: {
      companyId: company.id,
      customerId: customer.id,
      fixtureId: fixture.fixtureId,
      activeTermsVersion: 1,
      status: "intake",
      createdBy: "seed",
    },
  });
  await db.termsVersion.create({
    data: {
      caseId: dealCase.id,
      version: 1,
      source: "buyer_request",
      termsHash,
      sku: fixture.initialTerms.sku,
      quantity: fixture.initialTerms.quantity,
      totalValueMinor: fixture.initialTerms.totalValueMinor,
      discountBps: fixture.initialTerms.discountBps,
      paymentTerms: fixture.initialTerms.paymentTerms,
      deliveryDeadline,
    },
  });

  return { dealCase, customer, termsHash };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/fixtures/seedFixture.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write `prisma/seed.ts`**

```typescript
import "dotenv/config";
import { db } from "@/lib/db";
import { seedFixture } from "@/fixtures/seedFixture";
import { ALL_FIXTURES } from "@/fixtures/definitions";

async function main() {
  for (const fixture of ALL_FIXTURES) {
    const { dealCase } = await seedFixture(db, fixture);
    console.log(`Seeded ${fixture.fixtureId} -> case ${dealCase.id}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 7: Run the seed script against the dev database**

Run: `cd app && npm run seed`
Expected: three "Seeded CASE-..." lines, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/fixtures/definitions.ts src/fixtures/seedFixture.ts src/fixtures/seedFixture.test.ts prisma/seed.ts
git commit -m "feat: three known-answer fixture definitions and idempotent seed script"
```

---

### Task 24: Workflow — `deal.submitted` (initial evaluation)

This is `02-TECHNICAL-SPEC.md` "Request flow > Initial evaluation". **P0 simplification, called out explicitly:** the spec's Agent Architecture acceptance tests describe reusing an unaffected role's reservation across a terms-version change without re-invoking that role's LLM call ("rerun only affected roles"). This build always releases held reservations and reruns all six roles on any terms-version change (Task 25) — simpler and never wrong, at the cost of extra role calls on buyer acceptance. It is not one of the P0 functional requirements in `01-PRODUCT-SPEC.md`; revisit as a P1 latency optimization.

**Files:**
- Create: `app/src/workflow/counteroffer.ts`
- Create: `app/src/workflow/dealSubmitted.ts`
- Test: `app/src/workflow/dealSubmitted.test.ts`

- [ ] **Step 1: Write `src/workflow/counteroffer.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { canonicalTermsHash, signBuyerToken, hashBuyerToken } from "@/lib/hash";
import type { PaymentTerms } from "@/lib/types";

export interface CreateCounterofferInput {
  caseId: string;
  sourceTermsVersion: number;
  sku: string;
  quantity: number;
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: PaymentTerms;
  deliveryDeadline: Date;
  expiresInSeconds: number;
  buyerLinkSigningSecret: string;
}

// Creates a new terms version and a signed buyer link. The offer is explicitly
// non-binding until accepted and certified (05-TOOL-CONTRACTS.md "create_counteroffer").
// The returned `buyerToken` is the only time the raw token exists — only its hash is
// persisted (04-DATA-AND-STATE-SPEC.md "Buyer tokens are stored as hashes").
export async function createCounteroffer(db: PrismaClient, input: CreateCounterofferInput) {
  const termsHash = canonicalTermsHash({
    sku: input.sku,
    quantity: input.quantity,
    totalValueMinor: input.totalValueMinor,
    discountBps: input.discountBps,
    paymentTerms: input.paymentTerms,
    deliveryDeadline: input.deliveryDeadline.toISOString(),
  });
  const proposedVersion = input.sourceTermsVersion + 1;

  await db.termsVersion.create({
    data: {
      caseId: input.caseId,
      version: proposedVersion,
      parentVersion: input.sourceTermsVersion,
      source: "counteroffer",
      termsHash,
      sku: input.sku,
      quantity: input.quantity,
      totalValueMinor: input.totalValueMinor,
      discountBps: input.discountBps,
      paymentTerms: input.paymentTerms,
      deliveryDeadline: input.deliveryDeadline,
    },
  });

  const buyerToken = signBuyerToken(`${input.caseId}:${proposedVersion}`, input.buyerLinkSigningSecret);
  const counteroffer = await db.counteroffer.create({
    data: {
      caseId: input.caseId,
      sourceTermsVersion: input.sourceTermsVersion,
      proposedTermsVersion: proposedVersion,
      tokenHash: hashBuyerToken(buyerToken),
      status: "sent",
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    },
  });

  return { counteroffer, buyerToken, termsHash, proposedVersion };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/workflow/dealSubmitted.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

function scriptFor(paymentTerms: string, riskVeto = false) {
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
      case "finance":
        if (paymentTerms === "NET_60") {
          return {
            toolCall: null,
            output: {
              decision: "counter" as const,
              constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
              reservationRequests: [],
              counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
              evidenceRefs: ["EVID-FIN"],
              explanation: "Net-60 breaches policy; 30% advance would pass.",
            },
          };
        }
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Only 199 of 350 units currently available."), decision: "counter" } };
      case "procurement":
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 option covers the shortfall.") };
      case "logistics":
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the 21-day deadline.") };
      case "risk":
      default:
        return { toolCall: null, output: riskVeto ? { ...APPROVE(["EVID-RISK"], "Unsupported evidence."), decision: "veto" as const } : APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
    }
  };
}

describe("runDealSubmitted", () => {
  beforeEach(resetTestDb);

  it("moves to negotiating and creates a 30% advance counteroffer when only credit is missing", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(scriptFor("NET_60"));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("negotiating");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");

    const v2 = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: 2 } });
    expect(v2.paymentTerms).toBe("ADVANCE_30");

    const reservations = await testDb.reservation.findMany({ where: { caseId: dealCase.id } });
    expect(reservations.every((r) => r.status === "released")).toBe(true); // v1 holds released, not left dangling
  });

  it("reaches prepared and issues a certificate when the request is feasible from the start", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.termsVersion.update({ where: { caseId_version: { caseId: dealCase.id, version: 1 } }, data: { paymentTerms: "ADVANCE_30" } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30"));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("prepared");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("prepared");
  });

  it("reaches cannot_commit when Risk vetoes the request", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    await testDb.termsVersion.update({ where: { caseId_version: { caseId: dealCase.id, version: 1 } }, data: { paymentTerms: "ADVANCE_30" } });
    const gateway = new FakeModelGateway(scriptFor("ADVANCE_30", true));

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("cannot_commit");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/workflow/dealSubmitted.test.ts`
Expected: FAIL — `./dealSubmitted` does not exist.

- [ ] **Step 4: Write `src/workflow/dealSubmitted.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError, type PaymentTerms, type ReservationDomain, type RoleId } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { runRoleAgent } from "@/roles/roleRuntime";
import { calculateDealEconomics, SKU_UNIT_COST_MINOR } from "@/policy/economics";
import { prepareCommitCertificate, abortCommitment } from "@/reservations/coordinator";
import { createCounteroffer } from "./counteroffer";

export interface RunDealSubmittedInput {
  caseId: string;
  modelId: string;
  timeoutMs: number;
  traceId: string;
  buyerLinkSigningSecret: string;
}

const DESTINATION_ID = "ZONE-SOUTH";
const REQUIRED_BASE_DOMAINS: ReservationDomain[] = ["credit", "inventory", "logistics"];

// 1. Sales normalizes. 2. Finance/Inventory/Procurement/Logistics run concurrently.
// 3. Risk runs against their evidence. 4. Deterministic feasibility check. 5. Route to
// prepared, negotiating (30% advance counteroffer), or cannot_commit
// (02-TECHNICAL-SPEC.md "Initial evaluation").
export async function runDealSubmitted(db: PrismaClient, gateway: ModelGateway, input: RunDealSubmittedInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "intake", expectedVersion: dealCase.activeTermsVersion, nextStatus: "evaluating" });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "deal.submitted", caseVersion: dealCase.activeTermsVersion, actorType: "operator", actorRef: "seed", payload: { termsHash: terms.termsHash }, traceId: input.traceId });

  return evaluateAndRoute(db, gateway, input);
}

// Shared by the initial evaluation above and buyer acceptance (Task 26). Assumes the
// case is already in "evaluating" status (the caller does that transition, since the
// *previous* status differs — "intake" here, "negotiating" for buyer acceptance); runs
// all six roles against the active terms version and routes to prepared, negotiating,
// or cannot_commit.
export async function evaluateAndRoute(db: PrismaClient, gateway: ModelGateway, input: RunDealSubmittedInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: dealCase.customerId } });

  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: SKU_UNIT_COST_MINOR[terms.sku] ?? 0,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: 3000,
  });

  const toolContext = { customerId: customer.id, sku: terms.sku, destinationId: DESTINATION_ID, paymentTerms: terms.paymentTerms as PaymentTerms };
  const runRole = (role: RoleId, contextSummary: Record<string, unknown>) =>
    runRoleAgent(
      db,
      gateway,
      { role, caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, contextSummary, toolContext, traceId: input.traceId, timeoutMs: input.timeoutMs },
      input.modelId,
    );

  const salesDecision = await runRole("sales", { currentTerms: { paymentTerms: terms.paymentTerms, quantity: terms.quantity }, requestedQuantity: terms.quantity });

  const [financeDecision, inventoryDecision, procurementDecision, logisticsDecision] = await Promise.all([
    runRole("finance", { requestedPaymentTerms: terms.paymentTerms, exposureIfApproved: economics.creditExposureMinor }),
    runRole("inventory", { sku: terms.sku, requestedQuantity: terms.quantity }),
    runRole("procurement", { sku: terms.sku, requestedQuantity: terms.quantity }),
    runRole("logistics", { destinationId: DESTINATION_ID, deadline: terms.deliveryDeadline.toISOString(), requestedQuantity: terms.quantity }),
  ]);

  const riskDecision = await runRole("risk", {
    financeDecision: { decision: financeDecision.decision, evidenceRefs: financeDecision.evidenceRefs },
    inventoryDecision: { decision: inventoryDecision.decision, evidenceRefs: inventoryDecision.evidenceRefs },
    procurementDecision: { decision: procurementDecision.decision, evidenceRefs: procurementDecision.evidenceRefs },
    logisticsDecision: { decision: logisticsDecision.decision, evidenceRefs: logisticsDecision.evidenceRefs },
  });

  const heldReservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, status: "held" } });
  const inventoryHeldQty = heldReservations.filter((r) => r.domain === "inventory").reduce((sum, r) => sum + (r.quantityMinor ?? 0), 0);
  const shortfall = terms.quantity - inventoryHeldQty;
  const requiredDomains: ReservationDomain[] = shortfall > 0 ? [...REQUIRED_BASE_DOMAINS, "supplier"] : REQUIRED_BASE_DOMAINS;
  const coveredDomains = new Set(heldReservations.map((r) => r.domain));
  const missingDomains = requiredDomains.filter((d) => !coveredDomains.has(d));

  if (riskDecision.decision === "veto" || missingDomains.length > 1 || (missingDomains.length === 1 && missingDomains[0] !== "credit")) {
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    const reason = riskDecision.decision === "veto" ? "risk_veto" : `unresolved_domains:${missingDomains.join(",")}`;
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.cannot_commit", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason }, traceId: input.traceId });
    return { status: "cannot_commit" as const, reason };
  }

  if (missingDomains.length === 0) {
    try {
      const certificate = await prepareCommitCertificate(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, termsHash: terms.termsHash, reservationIds: heldReservations.map((r) => r.id), requiredDomains });
      await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "prepared" });
      return { status: "prepared" as const, certificateId: certificate.id, economics };
    } catch (error) {
      // A reservation set that looked complete a moment ago can still fail
      // certificate validation — e.g. a supplier option's TTL expired between the
      // hold and this check. This is exactly Case 2
      // (06-EVALUATION-AND-TEST-SPEC.md "Supplier hold expires before commit"): the
      // certificate never becomes valid or consumed, every held resource is released,
      // and the case fails closed with the exact blocking reservation named.
      await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
      await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
      const reason = error instanceof ToolError ? `${error.code}: ${error.message}` : String(error);
      await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.cannot_commit", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason }, traceId: input.traceId });
      return { status: "cannot_commit" as const, reason };
    }
  }

  // Only credit is missing: Finance countered NET_60 and ADVANCE_30 is permitted — the
  // one approved counterterm this build supports (08-24-HOUR-BUILD-SCOPE.md cut order:
  // "keep the one approved 30% advance term").
  const advanceAllowed = (customer.allowedPaymentTerms as string[]).includes("ADVANCE_30");
  if (!advanceAllowed || terms.paymentTerms === "ADVANCE_30") {
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    return { status: "cannot_commit" as const, reason: "credit_policy_no_permitted_counterterm" };
  }

  await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
  const offer = await createCounteroffer(db, {
    caseId: input.caseId,
    sourceTermsVersion: dealCase.activeTermsVersion,
    sku: terms.sku,
    quantity: terms.quantity,
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    paymentTerms: "ADVANCE_30",
    deliveryDeadline: terms.deliveryDeadline,
    expiresInSeconds: 3600,
    buyerLinkSigningSecret: input.buyerLinkSigningSecret,
  });
  await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "negotiating" });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "counteroffer.created", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "sales", payload: { counterofferId: offer.counteroffer.id, proposedTermsVersion: offer.proposedVersion }, traceId: input.traceId });

  return { status: "negotiating" as const, counterofferId: offer.counteroffer.id, buyerToken: offer.buyerToken, salesExplanation: salesDecision.explanation };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/workflow/dealSubmitted.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Manual smoke test with the real OpenAI gateway (one-time, not part of `npm test`)**

Wire `new OpenAIModelGateway(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), process.env.OPENAI_MODEL_ID!)` in place of the `FakeModelGateway` in a scratch script against the dev database (seeded via `npm run seed`), and confirm the case reaches `negotiating` with a real counteroffer. This is the first real ApplyBee/Hive-gateway-equivalent traffic in the build — keep the terminal output as evidence for the "ApplyBee/Hive request path is visible in traces or receipts" exit criterion (`00-BUILD-CONTEXT.md`), since every `DomainDecision` row already stores `gatewayRequestId` and `modelId`.

- [ ] **Step 7: Commit**

```bash
git add src/workflow/counteroffer.ts src/workflow/dealSubmitted.ts src/workflow/dealSubmitted.test.ts
git commit -m "feat: deal.submitted workflow — six-role evaluation, counteroffer, cannot_commit"
```

---

### Task 25: Workflow — commit (`commitOrder`)

A standalone function that consumes any `prepared` case's certificate. It is used both by the direct-feasible branch in Task 24 and by buyer acceptance in Task 26 — written first so Task 26 can call it.

**Files:**
- Create: `app/src/workflow/commit.ts`
- Test: `app/src/workflow/commit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/workflow/commit.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runCommit } from "./commit";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { prepareCommitCertificate } from "@/reservations/coordinator";
import { transitionCase } from "@/state/transitions";

async function seedPreparedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" } });
  const customer = await testDb.customer.create({ data: { companyId: company.id, name: "Beacon", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: ["ADVANCE_30"], policyVersion: "credit-policy-v1" } });
  await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_acceptance", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "ADVANCE_30", deliveryDeadline: new Date("2026-09-12") } });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 350 } });

  const inventoryReservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 350, ttlSeconds: 900 });
  const creditReservation = await holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 102_900_000, ttlSeconds: 900 });
  await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds: [inventoryReservation.id, creditReservation.id], requiredDomains: ["inventory", "credit"] });
  await transitionCase(testDb, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: 1, nextStatus: "prepared" });

  return dealCase;
}

describe("runCommit", () => {
  beforeEach(resetTestDb);

  it("commits a prepared case and reaches committed with required receipts", async () => {
    const dealCase = await seedPreparedCase();
    const result = await runCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("committed");
    if (result.status === "committed") {
      expect(result.depositMinor).toBe(44_100_000);
    }

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");

    const order = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(order.status).toBe("accepted");
    const checkout = await testDb.stripeCheckoutMock.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(checkout.amountMinor).toBe(44_100_000);
    const outboxMessage = await testDb.outboxMessage.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(outboxMessage.messageType).toBe("backed_promise");
  });

  it("escalates instead of committing when the certificate has already expired", async () => {
    const dealCase = await seedPreparedCase();
    await testDb.commitCertificate.updateMany({ where: { caseId: dealCase.id }, data: { validUntil: new Date(Date.now() - 1000) } });

    const result = await runCommit(testDb, { caseId: dealCase.id, traceId: "trace-1" });
    expect(result.status).toBe("escalated");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("escalated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/workflow/commit.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/workflow/commit.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { PaymentTerms } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { calculateDealEconomics, SKU_UNIT_COST_MINOR } from "@/policy/economics";
import { commitOrder, abortCommitment } from "@/reservations/coordinator";

export interface RunCommitInput {
  caseId: string;
  traceId: string;
}

// Consumes a `prepared` case's valid certificate and completes the required protected
// actions (02-TECHNICAL-SPEC.md "Commit phase"). The case becomes `committed` only
// after commitOrder's required receipts succeed; any failure routes through
// `aborting` to `escalated` rather than leaving the case in an ambiguous state.
export async function runCommit(db: PrismaClient, input: RunCommitInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion, status: "valid" } });

  const economics = calculateDealEconomics({
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    quantity: terms.quantity,
    unitCostMinor: SKU_UNIT_COST_MINOR[terms.sku] ?? 0,
    paymentTerms: terms.paymentTerms as PaymentTerms,
    depositBps: 3000,
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
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "committing", expectedVersion: dealCase.activeTermsVersion, nextStatus: "aborting" });
    await abortCommitment(db, { caseId: input.caseId, caseVersion: dealCase.activeTermsVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "aborting", expectedVersion: dealCase.activeTermsVersion, nextStatus: "escalated" });
    const message = error instanceof Error ? error.message : String(error);
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.escalated", caseVersion: dealCase.activeTermsVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason: message }, traceId: input.traceId });
    return { status: "escalated" as const, reason: message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/workflow/commit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/commit.ts src/workflow/commit.test.ts
git commit -m "feat: commit workflow — consumes a prepared case's certificate"
```

---

### Task 26: Workflow — buyer response

Completes Case 1 end to end: buyer acceptance reruns all six roles against the advance-payment terms, mints a certificate, and auto-commits (`02-TECHNICAL-SPEC.md` "Buyer acceptance" folds commit into the same flow — there is no separate manual "click commit" step in this build's happy path).

**Files:**
- Create: `app/src/workflow/buyerResponse.ts`
- Test: `app/src/workflow/buyerResponse.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/workflow/buyerResponse.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse } from "./buyerResponse";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const SECRET = "test-secret";
const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

function script(input: RoleRunInput) {
  switch (input.role) {
    case "finance":
      if (input.contextSummary.requestedPaymentTerms === "NET_60") {
        return {
          toolCall: null,
          output: {
            decision: "counter" as const,
            constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
            reservationRequests: [],
            counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
            evidenceRefs: ["EVID-FIN"],
            explanation: "Net-60 breaches policy.",
          },
        };
      }
      return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
    case "inventory":
      return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
    case "procurement":
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

describe("runBuyerResponse", () => {
  beforeEach(resetTestDb);

  it("commits the case when the buyer accepts the 30% advance counteroffer", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });

    expect(result.status).toBe("committed");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
    expect(reloaded.activeTermsVersion).toBe(2);
  });

  it("moves the case to cannot_commit when the buyer rejects", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "reject", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    expect(result.status).toBe("cannot_commit");
  });

  it("fails closed on a tampered token without mutating the case", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const tampered = submitted.buyerToken.slice(0, -1) + (submitted.buyerToken.endsWith("a") ? "b" : "a");
    const result = await runBuyerResponse(testDb, gateway, { buyerToken: tampered, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    expect(result.status).toBe("invalid_or_expired");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating"); // unchanged
  });

  it("is idempotent on a duplicate acceptance request", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const first = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-2", buyerLinkSigningSecret: SECRET });
    const second = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-3", buyerLinkSigningSecret: SECRET });
    expect(first.status).toBe("committed");
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/workflow/buyerResponse.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/workflow/buyerResponse.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError } from "@/lib/types";
import { hashBuyerToken, verifyBuyerToken } from "@/lib/hash";
import { transitionCase, assertValidTransition } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { evaluateAndRoute } from "./dealSubmitted";
import { runCommit } from "./commit";

export interface RunBuyerResponseInput {
  buyerToken: string;
  response: "accept" | "reject";
  modelId: string;
  timeoutMs: number;
  traceId: string;
  buyerLinkSigningSecret: string;
}

export type BuyerResponseResult =
  | { status: "invalid_or_expired" }
  | { status: "cannot_commit" }
  | { status: "prepared"; certificateId: string }
  | { status: "negotiating"; counterofferId: string }
  | { status: "committed"; certificateId: string }
  | { status: "escalated"; reason: string };

// Verifies a signed buyer token, expiry, offer status, and case version before
// persisting anything (02-TECHNICAL-SPEC.md "Buyer acceptance", step 1). A tampered
// signature, an already-resolved offer, or an offer whose case has moved on all fail
// closed with no mutation.
export async function runBuyerResponse(db: PrismaClient, gateway: ModelGateway, input: RunBuyerResponseInput): Promise<BuyerResponseResult> {
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
    if (dealCase.status === "prepared") {
      const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, status: "valid" } });
      return { status: "prepared", certificateId: certificate.id };
    }
    if (dealCase.status === "escalated") return { status: "escalated", reason: "duplicate_accept_after_escalation" };
    return { status: "cannot_commit" };
  }
  if (counteroffer.status === "rejected") return { status: "cannot_commit" };
  if (counteroffer.status !== "sent" || counteroffer.expiresAt <= new Date()) return { status: "invalid_or_expired" };

  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: counteroffer.caseId } });
  if (dealCase.activeTermsVersion !== counteroffer.sourceTermsVersion) return { status: "invalid_or_expired" };

  if (input.response === "reject") {
    await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "rejected", respondedAt: new Date() } });
    await transitionCase(db, { caseId: dealCase.id, expectedStatus: "negotiating", expectedVersion: dealCase.activeTermsVersion, nextStatus: "cannot_commit" });
    await emitCaseEvent(db, { caseId: dealCase.id, eventType: "buyer.counterterm_rejected", caseVersion: dealCase.activeTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });
    return { status: "cannot_commit" };
  }

  await db.counteroffer.update({ where: { id: counteroffer.id }, data: { status: "accepted", respondedAt: new Date() } });

  assertValidTransition("negotiating", "evaluating");
  const advanced = await db.dealCase.updateMany({
    where: { id: dealCase.id, status: "negotiating", activeTermsVersion: counteroffer.sourceTermsVersion },
    data: { activeTermsVersion: counteroffer.proposedTermsVersion, status: "evaluating" },
  });
  if (advanced.count === 0) {
    throw new ToolError("STALE_CASE_VERSION", `Case ${dealCase.id} is not in status "negotiating" at version ${counteroffer.sourceTermsVersion}`, true);
  }
  await emitCaseEvent(db, { caseId: dealCase.id, eventType: "buyer.counterterm_accepted", caseVersion: counteroffer.proposedTermsVersion, actorType: "buyer", actorRef: "buyer", payload: { counterofferId: counteroffer.id }, traceId: input.traceId });

  const evaluation = await evaluateAndRoute(db, gateway, { caseId: dealCase.id, modelId: input.modelId, timeoutMs: input.timeoutMs, traceId: input.traceId, buyerLinkSigningSecret: input.buyerLinkSigningSecret });

  if (evaluation.status === "prepared") {
    const commitResult = await runCommit(db, { caseId: dealCase.id, traceId: input.traceId });
    if (commitResult.status === "committed") return { status: "committed", certificateId: commitResult.certificateId };
    return { status: "escalated", reason: commitResult.reason };
  }
  if (evaluation.status === "negotiating") return { status: "negotiating", counterofferId: evaluation.counterofferId };
  return { status: "cannot_commit" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/workflow/buyerResponse.test.ts`
Expected: PASS (4 tests). This is the first point where Case 1's full spec sequence — Finance counters, holds placed, Sales counters, buyer accepts, certificate issued and consumed, sandbox order + CRM + Stripe checkout + outbox all commit — passes end to end.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/buyerResponse.ts src/workflow/buyerResponse.test.ts
git commit -m "feat: buyer response workflow — accept reruns roles and auto-commits, reject fails closed"
```

---

### Task 27: Workflow — supplier disruption and repair

Matches `03-AGENT-ARCHITECTURE.md` precisely here (unlike Tasks 24/26's documented simplification): only Procurement, Logistics, and Risk are rerun. Finance's and Inventory's original **committed** reservations are reused directly — Task 17's `prepareCommitCertificate` was written in that task to accept a `committed` reservation from an earlier case version specifically for this. `evaluating → repaired` is reached directly (not through `prepared`/`committing`), per `04-DATA-AND-STATE-SPEC.md`'s transition map — this task therefore does not call Task 25's `runCommit`, which assumes the `prepared → committing → committed` path.

**Files:**
- Create: `app/src/workflow/supplierDisrupted.ts`
- Test: `app/src/workflow/supplierDisrupted.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/workflow/supplierDisrupted.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse } from "./buyerResponse";
import { runSupplierDisruption } from "./supplierDisrupted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_POST_COMMIT_DISRUPTION } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const SECRET = "test-secret";
const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

function script(input: RoleRunInput) {
  switch (input.role) {
    case "finance":
      if (input.contextSummary.requestedPaymentTerms === "NET_60") {
        return {
          toolCall: null,
          output: {
            decision: "counter" as const,
            constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
            reservationRequests: [],
            counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
            evidenceRefs: ["EVID-FIN"],
            explanation: "Net-60 breaches policy.",
          },
        };
      }
      return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
    case "inventory":
      return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
    case "procurement":
      if (input.contextSummary.excludedSupplierId) {
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2005", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2005 replaces the disrupted option.") };
      }
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      if (input.contextSummary.requestedQuantity === 151) {
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-CHE", quantity: 151, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Repair plan covers VEND-2005's leg.") };
      }
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

async function commitFixtureCase() {
  const { dealCase } = await seedFixture(testDb, FIXTURE_POST_COMMIT_DISRUPTION);
  const gateway = new FakeModelGateway(script);
  const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t1", buyerLinkSigningSecret: SECRET });
  if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");
  const accepted = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t2", buyerLinkSigningSecret: SECRET });
  if (accepted.status !== "committed") throw new Error("fixture setup expected committed");
  return { dealCase, gateway };
}

describe("runSupplierDisruption", () => {
  beforeEach(resetTestDb);

  it("repairs the case with VEND-2005 after VEND-2003 is disrupted", async () => {
    const { dealCase, gateway } = await commitFixtureCase();

    const result = await runSupplierDisruption(testDb, gateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t3" });
    expect(result.status).toBe("repaired");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("repaired");
    expect(reloaded.activeTermsVersion).toBe(3);

    if (result.status !== "repaired") throw new Error("expected repaired");
    const originalCert = await testDb.commitCertificate.findFirstOrThrow({ where: { caseId: dealCase.id, id: { not: result.certificateId } } });
    expect(originalCert.status).toBe("broken");

    const repairedCert = await testDb.commitCertificate.findUniqueOrThrow({ where: { id: result.certificateId } });
    expect(repairedCert.supersedesCertificateId).toBe(originalCert.id);

    const order = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(order.status).toBe("repaired");

    const messages = await testDb.outboxMessage.findMany({ where: { caseId: dealCase.id } });
    expect(messages.some((m) => m.messageType === "correction")).toBe(true);
  });

  it("compensates each affected domain exactly once", async () => {
    const { dealCase, gateway } = await commitFixtureCase();
    await runSupplierDisruption(testDb, gateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t3" });

    const supplierReceipts = await testDb.actionReceipt.findMany({ where: { caseId: dealCase.id, actionType: "supplier.cancel_option" } });
    const logisticsReceipts = await testDb.actionReceipt.findMany({ where: { caseId: dealCase.id, actionType: "logistics.release_slot" } });
    expect(supplierReceipts).toHaveLength(1);
    expect(logisticsReceipts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/workflow/supplierDisrupted.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/workflow/supplierDisrupted.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { ToolError, type PaymentTerms, type ReservationDomain } from "@/lib/types";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "./events";
import { runRoleAgent } from "@/roles/roleRuntime";
import { deriveIdempotencyKey } from "@/policy/idempotency";
import { breakCertificate, compensateCommitment, prepareCommitCertificate, abortCommitment } from "@/reservations/coordinator";
import { runReceiptedAction } from "@/receipts/actionReceipt";
import { markSandboxOrderRepaired, updateCrmStage } from "@/adapters/sandboxErpAdapter";
import { sendCorrection } from "@/adapters/outboxAdapter";

export interface RunSupplierDisruptionInput {
  caseId: string;
  disruptedSupplierId: string;
  modelId: string;
  timeoutMs: number;
  traceId: string;
}

const DESTINATION_ID = "ZONE-SOUTH";
const REQUIRED_DOMAINS: ReservationDomain[] = ["credit", "inventory", "supplier", "logistics"];

// 02-TECHNICAL-SPEC.md "Disruption and repair": break the consumed certificate,
// compensate affected effects exactly once, rerun only Procurement/Logistics/Risk
// against a new case version, and issue a repaired certificate or escalate truthfully.
export async function runSupplierDisruption(db: PrismaClient, gateway: ModelGateway, input: RunSupplierDisruptionInput) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId: input.caseId, version: dealCase.activeTermsVersion } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: dealCase.customerId } });
  const certificate = await db.commitCertificate.findFirstOrThrow({ where: { caseId: input.caseId, status: "consumed" } });

  await emitCaseEvent(db, { caseId: input.caseId, eventType: "supplier.disrupted", caseVersion: dealCase.activeTermsVersion, actorType: "adapter", actorRef: input.disruptedSupplierId, payload: { certificateId: certificate.id }, traceId: input.traceId });
  await breakCertificate(db, { certificateId: certificate.id });

  const certifiedReservations = await db.reservation.findMany({ where: { id: { in: certificate.reservationIds as string[] } } });
  const disruptedSupplierReservation = certifiedReservations.find((r) => r.domain === "supplier" && r.resourceRef.includes(input.disruptedSupplierId));
  if (!disruptedSupplierReservation) {
    throw new ToolError("INVALID_INPUT", `No supplier reservation for ${input.disruptedSupplierId} in certificate ${certificate.id}`, false);
  }
  const affectedLogisticsReservationIds = certifiedReservations.filter((r) => r.domain === "logistics").map((r) => r.id);
  const reusableReservations = certifiedReservations.filter((r) => r.domain === "credit" || r.domain === "inventory");

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "committed", expectedVersion: dealCase.activeTermsVersion, nextStatus: "repair_needed" });
  await transitionCase(db, { caseId: input.caseId, expectedStatus: "repair_needed", expectedVersion: dealCase.activeTermsVersion, nextStatus: "compensating" });

  const newVersion = dealCase.activeTermsVersion + 1;
  await compensateCommitment(db, {
    caseId: input.caseId,
    caseVersion: newVersion,
    brokenCertificateId: certificate.id,
    disruptedSupplierReservationId: disruptedSupplierReservation.id,
    affectedLogisticsReservationIds,
  });

  await db.termsVersion.create({
    data: { caseId: input.caseId, version: newVersion, parentVersion: dealCase.activeTermsVersion, source: "repair", termsHash: terms.termsHash, sku: terms.sku, quantity: terms.quantity, totalValueMinor: terms.totalValueMinor, discountBps: terms.discountBps, paymentTerms: terms.paymentTerms, deliveryDeadline: terms.deliveryDeadline },
  });
  const advanced = await db.dealCase.updateMany({ where: { id: input.caseId, status: "compensating", activeTermsVersion: dealCase.activeTermsVersion }, data: { status: "evaluating", activeTermsVersion: newVersion } });
  if (advanced.count === 0) throw new ToolError("STALE_CASE_VERSION", `Case ${input.caseId} could not advance to the repair version`, true);

  const toolContext = { customerId: customer.id, sku: terms.sku, destinationId: DESTINATION_ID, paymentTerms: terms.paymentTerms as PaymentTerms };
  const shortfallQuantity = disruptedSupplierReservation.quantityMinor ?? 0;
  const runRole = (role: "procurement" | "logistics" | "risk", contextSummary: Record<string, unknown>) =>
    runRoleAgent(db, gateway, { role, caseId: input.caseId, caseVersion: newVersion, termsHash: terms.termsHash, contextSummary, toolContext, traceId: input.traceId, timeoutMs: input.timeoutMs }, input.modelId);

  const [procurementDecision, logisticsDecision] = await Promise.all([
    runRole("procurement", { sku: terms.sku, requestedQuantity: shortfallQuantity, excludedSupplierId: input.disruptedSupplierId }),
    runRole("logistics", { destinationId: DESTINATION_ID, deadline: terms.deliveryDeadline.toISOString(), requestedQuantity: shortfallQuantity }),
  ]);
  const riskDecision = await runRole("risk", {
    procurementDecision: { decision: procurementDecision.decision, evidenceRefs: procurementDecision.evidenceRefs },
    logisticsDecision: { decision: logisticsDecision.decision, evidenceRefs: logisticsDecision.evidenceRefs },
  });

  const freshReservations = await db.reservation.findMany({ where: { caseId: input.caseId, caseVersion: newVersion, termsHash: terms.termsHash, status: "held" } });
  const coveredDomains = new Set([...reusableReservations.map((r) => r.domain), ...freshReservations.map((r) => r.domain)]);
  const missingDomains = REQUIRED_DOMAINS.filter((d) => !coveredDomains.has(d));

  if (riskDecision.decision === "veto" || missingDomains.length > 0) {
    await abortCommitment(db, { caseId: input.caseId, caseVersion: newVersion });
    await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: newVersion, nextStatus: "cannot_commit" });
    await db.dealCase.update({ where: { id: input.caseId }, data: { status: "escalated" } });
    const reason = riskDecision.decision === "veto" ? "risk_veto" : `unresolved_domains:${missingDomains.join(",")}`;
    await emitCaseEvent(db, { caseId: input.caseId, eventType: "case.escalated", caseVersion: newVersion, actorType: "coordinator", actorRef: "workflow", payload: { reason }, traceId: input.traceId });
    return { status: "escalated" as const, reason };
  }

  const certificateReservationIds = [...reusableReservations.map((r) => r.id), ...freshReservations.map((r) => r.id)];
  const repairedCertificate = await prepareCommitCertificate(db, { caseId: input.caseId, caseVersion: newVersion, termsHash: terms.termsHash, reservationIds: certificateReservationIds, requiredDomains: REQUIRED_DOMAINS });
  await db.commitCertificate.update({ where: { id: repairedCertificate.id }, data: { supersedesCertificateId: certificate.id } });

  for (const reservationId of certificateReservationIds) {
    await db.reservation.updateMany({ where: { id: reservationId, status: { not: "committed" } }, data: { status: "committed" } });
  }
  await db.commitCertificate.update({ where: { id: repairedCertificate.id }, data: { status: "consumed", consumedAt: new Date() } });

  const key = (actionType: string) => deriveIdempotencyKey({ caseId: input.caseId, caseVersion: newVersion, actionType, resourceRef: repairedCertificate.id });
  await runReceiptedAction(db, {
    caseId: input.caseId, caseVersion: newVersion, actionType: "sandbox_order.repair", resourceRef: repairedCertificate.id, provider: "sandbox_erp",
    idempotencyKey: key("sandbox_order.repair"), requestHash: repairedCertificate.certificateHash,
    execute: async () => {
      await markSandboxOrderRepaired(db, input.caseId, repairedCertificate.id);
      await updateCrmStage(db, { caseId: input.caseId, stage: "repaired", note: `Certificate ${repairedCertificate.id} repairs ${certificate.id}` });
      return { providerRef: null, data: {} };
    },
  });
  const originalMessage = await db.outboxMessage.findFirstOrThrow({ where: { caseId: input.caseId, messageType: "backed_promise" } });
  await runReceiptedAction(db, {
    caseId: input.caseId, caseVersion: newVersion, actionType: "outbox.send_correction", resourceRef: repairedCertificate.id, provider: "outbox",
    idempotencyKey: key("outbox.send_correction"), requestHash: repairedCertificate.certificateHash,
    execute: async () => {
      const message = await sendCorrection(db, { caseId: input.caseId, certificateId: repairedCertificate.id, correctsId: originalMessage.id, payload: { reason: "supplier disruption repaired" } });
      return { providerRef: message.id, data: {} };
    },
  });

  await transitionCase(db, { caseId: input.caseId, expectedStatus: "evaluating", expectedVersion: newVersion, nextStatus: "repaired", isRepairVersion: true });
  await emitCaseEvent(db, { caseId: input.caseId, eventType: "repair.requested", caseVersion: newVersion, actorType: "coordinator", actorRef: "workflow", payload: { repairedCertificateId: repairedCertificate.id, brokenCertificateId: certificate.id }, traceId: input.traceId });

  return { status: "repaired" as const, certificateId: repairedCertificate.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/workflow/supplierDisrupted.test.ts`
Expected: PASS (2 tests). Case 3's full spec sequence — commit with VEND-2003, disruption, compensation, VEND-2005 repair, corrected outbox message — now passes end to end.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/supplierDisrupted.ts src/workflow/supplierDisrupted.test.ts
git commit -m "feat: supplier disruption workflow — compensate exactly once, repair with VEND-2005"
```

---

### Task 28: Case 2 — stale supplier hold integration test

No new source files. This exercises the `RESERVATION_EXPIRED` path added to `evaluateAndRoute` in Task 24's `catch` block, driven through the real `runDealSubmitted` → `runBuyerResponse` sequence. Staleness is simulated by scripting Procurement's hold call with `ttlSeconds: 0`, so the supplier reservation is already expired by the time `prepareCommitCertificate` checks it a moment later — deterministic, no `sleep` required, and a faithful reproduction of "the TTL expired after domain evaluation and before certificate consumption."

**Files:**
- Test: `app/src/workflow/staleSupplierHold.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/workflow/staleSupplierHold.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "./dealSubmitted";
import { runBuyerResponse } from "./buyerResponse";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_STALE_SUPPLIER_HOLD } from "@/fixtures/definitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const SECRET = "test-secret";
const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

function script(input: RoleRunInput) {
  switch (input.role) {
    case "finance":
      if (input.contextSummary.requestedPaymentTerms === "NET_60") {
        return {
          toolCall: null,
          output: {
            decision: "counter" as const,
            constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
            reservationRequests: [],
            counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
            evidenceRefs: ["EVID-FIN"],
            explanation: "Net-60 breaches policy.",
          },
        };
      }
      return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "OK") };
    case "inventory":
      return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
    case "procurement":
      // ttlSeconds: 0 — this hold is already expired by the time prepareCommitCertificate checks it.
      return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 0 } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
    case "logistics":
      return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
    case "sales":
    case "risk":
    default:
      return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
  }
}

describe("CASE-STALE-SUPPLIER-HOLD", () => {
  beforeEach(resetTestDb);

  it("never mints or consumes a certificate and fails closed to cannot_commit", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_STALE_SUPPLIER_HOLD);
    const gateway = new FakeModelGateway(script);
    const submitted = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t1", buyerLinkSigningSecret: SECRET });
    if (submitted.status !== "negotiating") throw new Error("fixture setup expected negotiating");

    const result = await runBuyerResponse(testDb, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 2000, traceId: "t2", buyerLinkSigningSecret: SECRET });
    expect(result.status).toBe("cannot_commit");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");

    const certificates = await testDb.commitCertificate.findMany({ where: { caseId: dealCase.id } });
    expect(certificates).toHaveLength(0); // never minted, let alone consumed

    const reservations = await testDb.reservation.findMany({ where: { caseId: dealCase.id, caseVersion: 2 } });
    expect(reservations.length).toBeGreaterThan(0);
    expect(reservations.every((r) => r.status === "released")).toBe(true); // inventory, credit, and logistics holds all released exactly once

    expect(await testDb.stripeCheckoutMock.count({ where: { caseId: dealCase.id } })).toBe(0);
    expect(await testDb.outboxMessage.count({ where: { caseId: dealCase.id, messageType: "backed_promise" } })).toBe(0);

    const events = await testDb.caseEvent.findMany({ where: { caseId: dealCase.id, eventType: "case.cannot_commit" } });
    expect(events).toHaveLength(1);
    expect(String(events[0]!.payload)).toMatch(/RESERVATION_EXPIRED/);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd app && npx vitest run src/workflow/staleSupplierHold.test.ts`
Expected: PASS (1 test). All three known-answer cases now pass: Case 1 (Task 26) → `committed`, Case 2 (this task) → `cannot_commit`, Case 3 (Task 27) → `repaired`.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/staleSupplierHold.test.ts
git commit -m "test: Case 2 (stale supplier hold) fails closed with no certificate ever minted"
```

---

### Task 29: Case API and Protected Promise API routes

Business logic lives in a plain `db`-parameterized service module (testable with `testDb`, like every prior task); the Next.js route files are thin wrappers around it using the real `db` singleton, consistent with how every workflow module in this plan takes `db` as its first argument. Route wiring itself is not separately tested — Tasks 24–28 already exercise every behavior these routes expose.

**Files:**
- Create: `app/src/api/casesService.ts`
- Create: `app/src/gateway/createGateway.ts`
- Create: `app/src/app/api/cases/route.ts`
- Create: `app/src/app/api/cases/[caseId]/route.ts`
- Create: `app/src/app/api/cases/[caseId]/evaluate/route.ts`
- Create: `app/src/app/api/cases/[caseId]/commit/route.ts`
- Create: `app/src/app/api/cases/[caseId]/disrupt/route.ts`
- Create: `app/src/app/api/cases/[caseId]/send-quote/route.ts`
- Test: `app/src/api/casesService.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api/casesService.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { listCases, getCaseDetail, sendQuote } from "./casesService";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_FEASIBLE_AFTER_ADVANCE } from "@/fixtures/definitions";

describe("casesService", () => {
  beforeEach(resetTestDb);

  it("listCases returns every seeded case", async () => {
    await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const cases = await listCases(testDb);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.fixtureId).toBe("CASE-FEASIBLE-AFTER-ADVANCE");
  });

  it("getCaseDetail returns the terms, decisions, reservations, certificates, receipts, and timeline", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const detail = await getCaseDetail(testDb, dealCase.id);
    expect(detail?.case.id).toBe(dealCase.id);
    expect(detail?.termsVersions).toHaveLength(1);
    expect(detail?.decisions).toEqual([]);
  });

  it("getCaseDetail returns null for an unknown case", async () => {
    expect(await getCaseDetail(testDb, "missing")).toBeNull();
  });

  it("sendQuote denies backed_commitment when no consumed certificate exists for the current version", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_FEASIBLE_AFTER_ADVANCE);
    const result = await sendQuote(testDb, dealCase.id, "backed_commitment");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("POLICY_VIOLATION");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/api/casesService.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/api/casesService.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";

export async function listCases(db: PrismaClient) {
  return db.dealCase.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getCaseDetail(db: PrismaClient, caseId: string) {
  const dealCase = await db.dealCase.findUnique({ where: { id: caseId } });
  if (!dealCase) return null;
  const [termsVersions, decisions, reservations, certificates, receipts, events] = await Promise.all([
    db.termsVersion.findMany({ where: { caseId }, orderBy: { version: "asc" } }),
    db.domainDecision.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.reservation.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.commitCertificate.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.actionReceipt.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.caseEvent.findMany({ where: { caseId }, orderBy: { sequence: "asc" } }),
  ]);
  return { case: dealCase, termsVersions, decisions, reservations, certificates, receipts, events };
}

export type SendQuoteResult =
  | { ok: true; mode: "backed_commitment"; certificateId: string; outboxMessageId: string | null }
  | { ok: true; mode: "non_binding_counteroffer"; counterofferId: string; binding: false }
  | { ok: false; code: "POLICY_VIOLATION" | "INVALID_INPUT"; message: string };

// The Protected Promise API's core rule (05-TOOL-CONTRACTS.md): `backed_commitment`
// requires a valid (consumed) certificate for the current version; `non_binding_
// counteroffer` requires a current counteroffer and is always labeled non-binding. Any
// mismatch returns a typed denial and creates no business mutation.
export async function sendQuote(db: PrismaClient, caseId: string, mode: string): Promise<SendQuoteResult> {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: caseId } });

  if (mode === "backed_commitment") {
    const certificate = await db.commitCertificate.findFirst({ where: { caseId, caseVersion: dealCase.activeTermsVersion, status: "consumed" } });
    if (!certificate) return { ok: false, code: "POLICY_VIOLATION", message: "No valid certificate for the current case version; a backed commitment cannot be sent." };
    const message = await db.outboxMessage.findFirst({ where: { caseId, certificateId: certificate.id, messageType: "backed_promise" } });
    return { ok: true, mode: "backed_commitment", certificateId: certificate.id, outboxMessageId: message?.id ?? null };
  }

  if (mode === "non_binding_counteroffer") {
    const counteroffer = await db.counteroffer.findFirst({ where: { caseId, sourceTermsVersion: dealCase.activeTermsVersion } });
    if (!counteroffer) return { ok: false, code: "POLICY_VIOLATION", message: "No current counteroffer to send as non-binding." };
    return { ok: true, mode: "non_binding_counteroffer", counterofferId: counteroffer.id, binding: false };
  }

  return { ok: false, code: "INVALID_INPUT", message: "mode must be 'non_binding_counteroffer' or 'backed_commitment'" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/api/casesService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `src/gateway/createGateway.ts`**

```typescript
import OpenAI from "openai";
import { OpenAIModelGateway } from "./openaiGateway";
import type { ModelGateway } from "./modelGateway";

// Fails fast when the required secret is missing rather than silently degrading
// (02-TECHNICAL-SPEC.md "The application must fail startup validation when required
// variables are absent"). Called on first use of a role-agent route rather than at
// server boot, since Next.js route handlers have no single startup hook in this stack.
export function createModelGateway(): ModelGateway {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const modelId = process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini";
  return new OpenAIModelGateway(new OpenAI({ apiKey }), modelId);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
```

- [ ] **Step 6: Write the route files**

`src/app/api/cases/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listCases } from "@/api/casesService";

export async function GET() {
  const cases = await listCases(db);
  return NextResponse.json({ cases });
}
```

`src/app/api/cases/[caseId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCaseDetail } from "@/api/casesService";

export async function GET(_request: Request, { params }: { params: { caseId: string } }) {
  const detail = await getCaseDetail(db, params.caseId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
```

`src/app/api/cases/[caseId]/evaluate/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { createModelGateway, requireEnv } from "@/gateway/createGateway";

export async function POST(_request: Request, { params }: { params: { caseId: string } }) {
  try {
    const gateway = createModelGateway();
    const result = await runDealSubmitted(db, gateway, {
      caseId: params.caseId,
      modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 20000),
      traceId: randomUUID(),
      buyerLinkSigningSecret: requireEnv("BUYER_LINK_SIGNING_SECRET"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
```

`src/app/api/cases/[caseId]/commit/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runCommit } from "@/workflow/commit";

export async function POST(_request: Request, { params }: { params: { caseId: string } }) {
  try {
    const result = await runCommit(db, { caseId: params.caseId, traceId: randomUUID() });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
```

`src/app/api/cases/[caseId]/disrupt/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runSupplierDisruption } from "@/workflow/supplierDisrupted";
import { createModelGateway } from "@/gateway/createGateway";

export async function POST(request: Request, { params }: { params: { caseId: string } }) {
  const body = await request.json().catch(() => ({}));
  const disruptedSupplierId = typeof body.disruptedSupplierId === "string" ? body.disruptedSupplierId : "VEND-2003";
  try {
    const gateway = createModelGateway();
    const result = await runSupplierDisruption(db, gateway, {
      caseId: params.caseId,
      disruptedSupplierId,
      modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 20000),
      traceId: randomUUID(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
```

`src/app/api/cases/[caseId]/send-quote/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendQuote } from "@/api/casesService";

export async function POST(request: Request, { params }: { params: { caseId: string } }) {
  const body = await request.json().catch(() => ({}));
  const result = await sendQuote(db, params.caseId, typeof body.mode === "string" ? body.mode : "");
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
```

- [ ] **Step 7: Verify the app still typechecks and boots**

Run: `cd app && npx tsc --noEmit && npm run dev` (then Ctrl+C once ready)
Expected: no type errors, dev server starts.

- [ ] **Step 8: Commit**

```bash
git add src/api/casesService.ts src/api/casesService.test.ts src/gateway/createGateway.ts src/app/api/cases
git commit -m "feat: Case API and Protected Promise API routes"
```

---

### Task 30: Buyer API routes

**Files:**
- Create: `app/src/api/buyerService.ts`
- Create: `app/src/app/api/buyer/[token]/route.ts`
- Create: `app/src/app/api/buyer/[token]/respond/route.ts`
- Test: `app/src/api/buyerService.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api/buyerService.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { getBuyerOffer } from "./buyerService";
import { createCounteroffer } from "@/workflow/counteroffer";

const SECRET = "test-secret";

async function seedOffer() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "negotiating", createdBy: "seed" } });
  await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
  return createCounteroffer(testDb, { caseId: dealCase.id, sourceTermsVersion: 1, sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "ADVANCE_30", deliveryDeadline: new Date("2026-09-12"), expiresInSeconds: 3600, buyerLinkSigningSecret: SECRET });
}

describe("getBuyerOffer", () => {
  beforeEach(resetTestDb);

  it("returns the source and proposed terms for a valid token", async () => {
    const { buyerToken } = await seedOffer();
    const offer = await getBuyerOffer(testDb, buyerToken, SECRET);
    expect(offer?.sourceTerms.paymentTerms).toBe("NET_60");
    expect(offer?.proposedTerms.paymentTerms).toBe("ADVANCE_30");
    expect(offer?.status).toBe("sent");
  });

  it("returns null for a token signed with the wrong secret", async () => {
    const { buyerToken } = await seedOffer();
    expect(await getBuyerOffer(testDb, buyerToken, "wrong-secret")).toBeNull();
  });

  it("returns null for a well-formed but unknown token", async () => {
    const { signBuyerToken } = await import("@/lib/hash");
    const unknownToken = signBuyerToken("case-does-not-exist:1", SECRET);
    expect(await getBuyerOffer(testDb, unknownToken, SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/api/buyerService.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `src/api/buyerService.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { hashBuyerToken, verifyBuyerToken } from "@/lib/hash";

interface TermsView {
  sku: string;
  quantity: number;
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: string;
  deliveryDeadline: string;
}

export interface BuyerOfferView {
  counterofferId: string;
  status: string;
  expiresAt: string;
  sourceTerms: TermsView;
  proposedTerms: TermsView;
}

function toView(terms: { sku: string; quantity: number; totalValueMinor: number; discountBps: number; paymentTerms: string; deliveryDeadline: Date }): TermsView {
  return { sku: terms.sku, quantity: terms.quantity, totalValueMinor: terms.totalValueMinor, discountBps: terms.discountBps, paymentTerms: terms.paymentTerms, deliveryDeadline: terms.deliveryDeadline.toISOString() };
}

// The signature check happens before any database lookup — a tampered token is
// rejected without even revealing whether a matching offer exists.
export async function getBuyerOffer(db: PrismaClient, buyerToken: string, secret: string): Promise<BuyerOfferView | null> {
  if (!verifyBuyerToken(buyerToken, secret)) return null;
  const counteroffer = await db.counteroffer.findUnique({ where: { tokenHash: hashBuyerToken(buyerToken) } });
  if (!counteroffer) return null;
  const [sourceTerms, proposedTerms] = await Promise.all([
    db.termsVersion.findFirst({ where: { caseId: counteroffer.caseId, version: counteroffer.sourceTermsVersion } }),
    db.termsVersion.findFirst({ where: { caseId: counteroffer.caseId, version: counteroffer.proposedTermsVersion } }),
  ]);
  if (!sourceTerms || !proposedTerms) return null;
  return {
    counterofferId: counteroffer.id,
    status: counteroffer.status,
    expiresAt: counteroffer.expiresAt.toISOString(),
    sourceTerms: toView(sourceTerms),
    proposedTerms: toView(proposedTerms),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/api/buyerService.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the route files**

`src/app/api/buyer/[token]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBuyerOffer } from "@/api/buyerService";
import { requireEnv } from "@/gateway/createGateway";

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const offer = await getBuyerOffer(db, params.token, requireEnv("BUYER_LINK_SIGNING_SECRET"));
  if (!offer) return NextResponse.json({ error: "invalid_or_expired" }, { status: 404 });
  return NextResponse.json(offer);
}
```

`src/app/api/buyer/[token]/respond/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runBuyerResponse } from "@/workflow/buyerResponse";
import { createModelGateway, requireEnv } from "@/gateway/createGateway";

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const body = await request.json().catch(() => ({}));
  const response = body.response === "reject" ? "reject" : "accept";
  const gateway = createModelGateway();
  const result = await runBuyerResponse(db, gateway, {
    buyerToken: params.token,
    response,
    modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
    timeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 20000),
    traceId: randomUUID(),
    buyerLinkSigningSecret: requireEnv("BUYER_LINK_SIGNING_SECRET"),
  });
  return NextResponse.json(result, { status: result.status === "invalid_or_expired" ? 404 : 200 });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/api/buyerService.ts src/api/buyerService.test.ts src/app/api/buyer
git commit -m "feat: buyer API routes — signed offer lookup and accept/reject"
```

---

### Task 31: Evaluation runner (3 cases × 3 runs)

**Known limitation, stated plainly:** this runner uses `FakeModelGateway` by default so all three fixtures — including `CASE-STALE-SUPPLIER-HOLD`, which needs a supplier hold to expire in the small window between hold and certificate preparation — are exercised deterministically and repeatably. A real LLM cannot be scripted to request `ttlSeconds: 0`, so running this evaluation matrix against the real OpenAI gateway would not reliably reproduce Case 2. Real-gateway evidence for the "ApplyBee/Hive request path is visible" exit criterion comes from Task 24's manual smoke-test step and the live demo instead, where every `DomainDecision` row's `gatewayRequestId`/`modelId` columns are the proof.

**Files:**
- Create: `app/src/fixtures/evaluationScripts.ts`
- Create: `app/scripts/evaluate.ts`

- [ ] **Step 1: Write `src/fixtures/evaluationScripts.ts`**

```typescript
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { RoleModelOutput } from "@/lib/types";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

const COUNTER_NET_60: RoleModelOutput = {
  decision: "counter",
  constraints: [{ domain: "finance", code: "CREDIT_POLICY_BREACH", severity: "blocking", message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
  reservationRequests: [],
  counterterms: [{ field: "payment_terms", proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
  evidenceRefs: ["EVID-FIN"],
  explanation: "Net-60 breaches policy; 30% advance would pass.",
};

export interface EvaluationScriptOptions {
  // 0 deterministically reproduces CASE-STALE-SUPPLIER-HOLD; 900 is the normal happy path.
  supplierTtlSeconds?: number;
}

// The same role behavior proven in Tasks 24/26/27/28's tests, generalized into one
// reusable script for the evaluation runner. Test files keep their own inline copies
// deliberately (writing-plans skill: each task's tests must read standalone) — this
// module exists only for the runner, not to be imported back into those tests.
export function buildEvaluationScript(options: EvaluationScriptOptions = {}) {
  const supplierTtlSeconds = options.supplierTtlSeconds ?? 900;
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "finance":
        if (input.contextSummary.requestedPaymentTerms === "NET_60") return { toolCall: null, output: COUNTER_NET_60 };
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "Advance payment keeps exposure within policy.") };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Partial coverage."), decision: "counter" as const } };
      case "procurement":
        if (input.contextSummary.excludedSupplierId) {
          return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2005", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-2005 replaces the disrupted option.") };
        }
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-2003", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: supplierTtlSeconds } }, output: APPROVE(["EVID-PROC"], "VEND-2003 covers the shortfall.") };
      case "logistics":
        if (input.contextSummary.requestedQuantity === 151) {
          return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-CHE", quantity: 151, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Repair plan covers VEND-2005's leg.") };
        }
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-BLR-HYD", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the deadline.") };
      case "sales":
      case "risk":
      default:
        return { toolCall: null, output: APPROVE([`EVID-${input.role.toUpperCase()}`], "OK.") };
    }
  };
}
```

- [ ] **Step 2: Write `scripts/evaluate.ts`**

```typescript
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { db } from "@/lib/db";
import { seedFixture } from "@/fixtures/seedFixture";
import { ALL_FIXTURES, type FixtureDefinition } from "@/fixtures/definitions";
import { buildEvaluationScript } from "@/fixtures/evaluationScripts";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { runBuyerResponse } from "@/workflow/buyerResponse";
import { runSupplierDisruption } from "@/workflow/supplierDisrupted";
import { verifyTerminalState } from "@/reservations/coordinator";

interface RunResult {
  fixtureId: string;
  run: number;
  expected: string;
  actual: string;
  pass: boolean;
  receiptCount: number;
  elapsedMs: number;
}

async function runOnce(fixture: FixtureDefinition, run: number): Promise<RunResult> {
  const started = Date.now();
  const { dealCase } = await seedFixture(db, fixture);
  const gateway = new FakeModelGateway(buildEvaluationScript({ supplierTtlSeconds: fixture.fixtureId === "CASE-STALE-SUPPLIER-HOLD" ? 0 : 900 }));
  const secret = process.env.BUYER_LINK_SIGNING_SECRET ?? "local-dev-signing-secret-change-me";
  const traceId = `eval-${fixture.fixtureId}-${run}`;

  const submitted = await runDealSubmitted(db, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 5000, traceId, buyerLinkSigningSecret: secret });
  if (submitted.status === "negotiating") {
    const accepted = await runBuyerResponse(db, gateway, { buyerToken: submitted.buyerToken, response: "accept", modelId: "fake-model-v1", timeoutMs: 5000, traceId: `${traceId}-accept`, buyerLinkSigningSecret: secret });
    if (accepted.status === "committed" && fixture.fixtureId === "CASE-POST-COMMIT-DISRUPTION") {
      await runSupplierDisruption(db, gateway, { caseId: dealCase.id, disruptedSupplierId: "VEND-2003", modelId: "fake-model-v1", timeoutMs: 5000, traceId: `${traceId}-disrupt` });
    }
  }

  const report = await verifyTerminalState(db, dealCase.id);
  return {
    fixtureId: fixture.fixtureId,
    run,
    expected: fixture.expectedTerminalState,
    actual: report.caseStatus,
    pass: report.caseStatus === fixture.expectedTerminalState,
    receiptCount: report.receipts.length,
    elapsedMs: Date.now() - started,
  };
}

async function main() {
  const results: RunResult[] = [];
  for (const fixture of ALL_FIXTURES) {
    for (let run = 1; run <= 3; run++) {
      results.push(await runOnce(fixture, run));
    }
  }

  mkdirSync("submission", { recursive: true });
  const header = "fixtureId,run,expected,actual,pass,receiptCount,elapsedMs";
  const rows = results.map((r) => `${r.fixtureId},${r.run},${r.expected},${r.actual},${r.pass},${r.receiptCount},${r.elapsedMs}`);
  writeFileSync("submission/three-case-results.csv", [header, ...rows].join("\n") + "\n");

  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"} ${result.fixtureId} run ${result.run}: expected=${result.expected} actual=${result.actual} (${result.elapsedMs}ms)`);
  }

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.error(`${failures.length} of ${results.length} runs failed.`);
    process.exitCode = 1;
  } else {
    console.log(`All ${results.length} runs passed (3 consecutive runs x 3 fixtures).`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 3: Run it against the dev database**

Run: `cd app && npm run evaluate`
Expected: 9 `PASS` lines (3 fixtures × 3 runs), "All 9 runs passed", and `submission/three-case-results.csv` written.

- [ ] **Step 4: Commit**

```bash
git add src/fixtures/evaluationScripts.ts scripts/evaluate.ts
git commit -m "feat: evaluation runner — 3 known-answer fixtures x 3 consecutive runs"
```

---

### Task 32: Operator UI

**TDD explicitly skipped for this task** (CLAUDE.md: "UI tweaks... TDD is optional — but say so explicitly when skipping it"). These are thin client components rendering already-tested API responses; the correctness burden lives in Tasks 24–29. No new dependency is added (no component-testing library, no CSS framework) — verification is manual, via `npm run dev`. Every value rendered comes from `/api/cases/...` — nothing is animated or computed client-side, satisfying "UI renders from API state and survives reload" (`02-TECHNICAL-SPEC.md`).

**Files:**
- Create: `app/src/app/page.tsx` (overwrites the Task 1 placeholder)
- Create: `app/src/app/case/[caseId]/page.tsx`

- [ ] **Step 1: Write `src/app/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface CaseSummary {
  id: string;
  fixtureId: string | null;
  status: string;
  customerId: string;
  activeTermsVersion: number;
}

export default function HomePage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cases")
      .then((r) => r.json())
      .then((data) => {
        setCases(data.cases);
        setLoading(false);
      });
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>CommitOS — Fixture Selector</h1>
      {loading && <p>Loading cases…</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {cases.map((c) => (
          <li key={c.id} style={{ marginBottom: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <strong>{c.fixtureId ?? c.id}</strong> — status: <code>{c.status}</code> (v{c.activeTermsVersion})
            <div>
              <Link href={`/case/${c.id}`}>Open case →</Link>
            </div>
          </li>
        ))}
      </ul>
      {!loading && cases.length === 0 && <p>No cases yet — run `npm run seed`.</p>}
    </main>
  );
}
```

- [ ] **Step 2: Write `src/app/case/[caseId]/page.tsx`**

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

const ROLE_ORDER = ["sales", "finance", "inventory", "procurement", "logistics", "risk"];

interface CaseDetail {
  case: { id: string; status: string; activeTermsVersion: number; fixtureId: string | null };
  termsVersions: Array<{ version: number; sku: string; quantity: number; totalValueMinor: number; discountBps: number; paymentTerms: string; deliveryDeadline: string }>;
  decisions: Array<{ id: string; role: string; decision: string; caseVersion: number; payload: { explanation: string }; createdAt: string }>;
  reservations: Array<{ id: string; domain: string; status: string; resourceRef: string; expiresAt: string }>;
  certificates: Array<{ id: string; status: string; caseVersion: number; certificateHash: string; supersedesCertificateId: string | null }>;
  receipts: Array<{ id: string; actionType: string; status: string; provider: string }>;
  events: Array<{ sequence: number; eventType: string; actorType: string; createdAt: string }>;
}

export default function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch(`/api/cases/${params.caseId}`)
      .then((r) => r.json())
      .then(setDetail);
  }, [params.caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runAction(path: string, body?: unknown) {
    setBusy(true);
    try {
      await fetch(`/api/cases/${params.caseId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (!detail) return <main style={{ padding: 24 }}>Loading…</main>;

  const currentTerms = detail.termsVersions.find((t) => t.version === detail.case.activeTermsVersion);
  const latestDecisionByRole = ROLE_ORDER.map((role) => {
    const forRole = detail.decisions.filter((d) => d.role === role && d.caseVersion === detail.case.activeTermsVersion);
    return { role, decision: forRole[forRole.length - 1] };
  });

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960 }}>
      <h1>Case {detail.case.fixtureId ?? detail.case.id}</h1>
      <p>
        Status: <strong style={{ textTransform: "uppercase" }}>{detail.case.status}</strong> · Terms v{detail.case.activeTermsVersion}
      </p>

      {currentTerms && (
        <section style={{ margin: "16px 0", padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2>Normalized terms</h2>
          <p>
            {currentTerms.sku} × {currentTerms.quantity} — ₹{(currentTerms.totalValueMinor / 100).toLocaleString("en-IN")} — {currentTerms.discountBps / 100}% discount —{" "}
            {currentTerms.paymentTerms} — due {new Date(currentTerms.deliveryDeadline).toLocaleDateString()}
          </p>
        </section>
      )}

      <section style={{ margin: "16px 0" }}>
        <h2>Role decisions</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {latestDecisionByRole.map(({ role, decision }) => (
            <div key={role} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
              <strong style={{ textTransform: "capitalize" }}>{role}</strong>
              <div>{decision ? decision.decision : "pending"}</div>
              {decision && <p style={{ fontSize: 13, color: "#555" }}>{decision.payload.explanation}</p>}
            </div>
          ))}
        </div>
      </section>

      <section style={{ margin: "16px 0" }}>
        <h2>Reservations</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Domain</th>
              <th align="left">Resource</th>
              <th align="left">Status</th>
              <th align="left">Expires</th>
            </tr>
          </thead>
          <tbody>
            {detail.reservations.map((r) => (
              <tr key={r.id}>
                <td>{r.domain}</td>
                <td>{r.resourceRef}</td>
                <td>{r.status}</td>
                <td>{new Date(r.expiresAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ margin: "16px 0" }}>
        <h2>Certificates</h2>
        {detail.certificates.map((c) => (
          <div key={c.id}>
            #{c.id.slice(0, 8)} v{c.caseVersion} — {c.status}
            {c.supersedesCertificateId ? ` (supersedes ${c.supersedesCertificateId.slice(0, 8)})` : ""}
          </div>
        ))}
      </section>

      <section style={{ margin: "16px 0" }}>
        <h2>Receipts</h2>
        {detail.receipts.map((r) => (
          <div key={r.id}>
            {r.actionType} — {r.provider} — {r.status}
          </div>
        ))}
      </section>

      <section style={{ margin: "16px 0" }}>
        <h2>Timeline</h2>
        {detail.events.map((e) => (
          <div key={e.sequence}>
            #{e.sequence} {e.eventType} ({e.actorType}) — {new Date(e.createdAt).toLocaleTimeString()}
          </div>
        ))}
      </section>

      <section style={{ margin: "16px 0", display: "flex", gap: 8 }}>
        {detail.case.status === "intake" && (
          <button disabled={busy} onClick={() => runAction("evaluate")}>
            Start evaluation
          </button>
        )}
        {detail.case.status === "prepared" && (
          <button disabled={busy} onClick={() => runAction("commit")}>
            Commit
          </button>
        )}
        {detail.case.status === "committed" && (
          <button disabled={busy} onClick={() => runAction("disrupt", { disruptedSupplierId: "VEND-2003" })}>
            VEND-2003 unavailable
          </button>
        )}
        <button disabled={busy} onClick={refresh}>
          Refresh
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Manually verify**

Run: `cd app && npm run seed && npm run dev`, open `http://localhost:3000`.
Expected: the three seeded cases list; opening `CASE-FEASIBLE-AFTER-ADVANCE` and clicking "Start evaluation" moves it to `negotiating` and shows the six role cards, held reservations, and a timeline entry — all from a page reload, not client-side state (open the same URL in a new tab to confirm).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/case
git commit -m "feat: operator UI — fixture selector, role cards, reservation graph, timeline"
```

---

### Task 33: Buyer UI

**TDD explicitly skipped**, same rationale as Task 32.

**Files:**
- Create: `app/src/app/buyer/[token]/page.tsx`

- [ ] **Step 1: Write `src/app/buyer/[token]/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface BuyerOffer {
  counterofferId: string;
  status: string;
  expiresAt: string;
  sourceTerms: { paymentTerms: string; totalValueMinor: number; deliveryDeadline: string };
  proposedTerms: { paymentTerms: string; totalValueMinor: number; deliveryDeadline: string };
}

export default function BuyerOfferPage() {
  const params = useParams<{ token: string }>();
  const [offer, setOffer] = useState<BuyerOffer | null>(null);
  const [result, setResult] = useState<{ status: string } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/buyer/${params.token}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setOffer(data);
      });
  }, [params.token]);

  async function respond(response: "accept" | "reject") {
    const r = await fetch(`/api/buyer/${params.token}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
    setResult(await r.json());
  }

  if (notFound) return <main style={{ padding: 24 }}>This offer link is invalid or has expired.</main>;
  if (!offer) return <main style={{ padding: 24 }}>Loading…</main>;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
      <h1>Revised offer</h1>
      <p>This is a non-binding proposal until you accept it and CommitOS issues a backed certificate.</p>
      <table>
        <tbody>
          <tr>
            <td>Original terms</td>
            <td>
              {offer.sourceTerms.paymentTerms}, ₹{(offer.sourceTerms.totalValueMinor / 100).toLocaleString("en-IN")}
            </td>
          </tr>
          <tr>
            <td>Proposed terms</td>
            <td>
              {offer.proposedTerms.paymentTerms}, ₹{(offer.proposedTerms.totalValueMinor / 100).toLocaleString("en-IN")}
            </td>
          </tr>
          <tr>
            <td>Expires</td>
            <td>{new Date(offer.expiresAt).toLocaleString()}</td>
          </tr>
          <tr>
            <td>Status</td>
            <td>{offer.status}</td>
          </tr>
        </tbody>
      </table>
      {offer.status === "sent" && !result && (
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button onClick={() => respond("accept")}>Accept</button>
          <button onClick={() => respond("reject")}>Reject</button>
        </div>
      )}
      {result && (
        <p style={{ marginTop: 16 }}>
          Result: <strong>{result.status}</strong>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manually verify end to end**

Run: `cd app && npm run seed && npm run dev`.
1. Open `http://localhost:3000`, open `CASE-FEASIBLE-AFTER-ADVANCE`, click "Start evaluation" → status becomes `negotiating`.
2. Copy the signed buyer link (log it from the browser network tab's `/evaluate` response, or add a temporary `console.log` — the operator UI does not surface it directly in this P0 scope; noted below as a follow-up).
3. Open that link at `/buyer/<token>` in a second browser/incognito window, click "Accept".
4. Reload the operator's `/case/<id>` page: status is `committed`, a certificate shows `consumed`, and receipts list `sandbox_order.create`, `stripe.create_deposit_checkout`, and `outbox.send_backed_promise`, all `succeeded`.
5. Click "VEND-2003 unavailable" → status becomes `repaired`, the original certificate shows `broken`, and a `correction` message appears in the receipts/outbox data.

**Follow-up noted, not built in this plan:** surfacing the buyer link directly in the operator UI (e.g., a copyable field on the case detail page) instead of reading it from the network tab. Trivial to add once this vertical slice is verified end to end.

- [ ] **Step 3: Run the full test suite and typecheck one last time**

Run: `cd app && npm test && npx tsc --noEmit`
Expected: every test file from Tasks 1–31 passes; no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/buyer
git commit -m "feat: buyer UI — signed offer page with accept/reject"
```

---

## Definition of done for this plan

- [ ] `npm test` passes (all unit + integration tests from Tasks 2–31).
- [ ] `npm run evaluate` reports 9/9 passing runs (3 fixtures × 3 runs) and writes `submission/three-case-results.csv`.
- [ ] `npm run dev` boots; the manual end-to-end walkthrough in Task 33 Step 2 reproduces Case 1 (`committed`) and Case 3 (`repaired`) through the real UI.
- [ ] The Task 20/24 manual smoke tests confirm real `OPENAI_API_KEY` traffic works and is visible in `domain_decision.gatewayRequestId`/`modelId`.
- [ ] `git status` never showed `.env.local` staged at any commit.

## Explicit deferrals (not built by this plan — say so if asked, don't silently claim them done)

- Real Supabase Postgres and Supabase Auth (this build: SQLite + a single seeded operator, no login).
- Real Stripe test-mode keys (this build: `StripeMockAdapter`, same interface shape).
- Production deployment / hosted URL.
- ROI panel, landing page, GTM/pricing pages, downloadable certificate JSON, signed receipt bundle export (`01-PRODUCT-SPEC.md` P1 list).
- The Agent Architecture "rerun only affected roles" latency optimization for buyer acceptance (Task 24 always reruns all six; repair in Task 27 correctly reruns only three, per spec).
- Buyer link surfaced in the operator UI (Task 33 follow-up).
- The five validation interviews and submission evidence package beyond `three-case-results.csv` (`07-DEMO-GTM-AND-MONETIZATION.md`, `06-EVALUATION-AND-TEST-SPEC.md`).

