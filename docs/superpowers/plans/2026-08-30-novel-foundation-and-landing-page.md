# Novel Foundation + Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Novel Next.js project (in `web/`) with typed environment/Supabase foundations, a reusable motion system, and the complete public landing page described in `docs/superpowers/specs/2026-08-30-novel-website-design.md` — fully working and deployable with zero authentication required.

**Architecture:** Next.js 16 (App Router, TypeScript, Tailwind v4) scaffolded under `web/`. Design tokens (color + motion timing/easing) and the demo-choreography state machine are pure, unit-tested TypeScript modules; everything that renders them (the landing sections, the focus-rail animation) is plain React/Framer Motion composition with TDD explicitly skipped per this repo's UI-tweaks convention — each such file still ships complete, real content (no lorem ipsum, no TODOs). Supabase client factories are stubbed in now (env + client construction only) so Plan 2 (auth) can build directly on them without redoing foundation work.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind CSS v4 (CSS-first `@theme`), Framer Motion, `@supabase/supabase-js`, `server-only`, Vitest + Testing Library for unit tests, pnpm.

**Out of scope for this plan** (each is its own follow-up plan, per the design spec's build phasing, §13): Google One Tap auth, onboarding wizard, data ingestion, the authenticated app shell, the real query-lifecycle animation wired to live `case_event` rows, and the case-scoped chat. The landing page's demo section in this plan is a **fixed, fake-data autoplay loop** — it never calls Supabase or any backend.

---

## File structure

```
web/                                    # new Next.js project (created by Task 1)
  .env.example                          # Task 15
  integrations.md                       # Task 14
  vitest.config.ts                      # Task 2
  src/
    app/
      layout.tsx                        # Task 13
      globals.css                       # Task 5, Task 13
      page.tsx                          # Task 13
    lib/
      env/
        client.ts                       # Task 3
        server.ts                       # Task 3
      supabase/
        browser-client.ts               # Task 4
        server-client.ts                # Task 4
      design/
        tokens.ts                       # Task 5
      motion/
        motion-tokens.ts                # Task 6
        depth-scale.ts                  # Task 7
        demo-choreography.ts            # Task 8
        use-reduced-motion.ts           # Task 9
    components/
      landing/
        focus-stage.tsx                 # Task 10
        nav-bar.tsx                     # Task 11
        hero.tsx                        # Task 11
        why-novel.tsx                   # Task 11
        trust-section.tsx               # Task 11
        final-cta.tsx                   # Task 11
        footer.tsx                      # Task 11
        demo-section.tsx                # Task 12
  tests/
    unit/
      env-client.test.ts                # Task 3
      env-server.test.ts                # Task 3
      supabase-browser-client.test.ts   # Task 4
      supabase-server-client.test.ts    # Task 4
      design-tokens.test.ts             # Task 5
      motion-tokens.test.ts             # Task 6
      depth-scale.test.ts               # Task 7
      demo-choreography.test.ts         # Task 8
      use-reduced-motion.test.ts        # Task 9
```

All commands below assume the shell's working directory is the repo root, `/Users/eidoviscontact/Novel/Novel`, unless a step says `cd web`.

---

### Task 1: Scaffold the Next.js project

**Files:**
- Create: `web/` (entire generated project)

- [ ] **Step 1: Run the scaffolder**

```bash
pnpm dlx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --disable-git --yes
```

Expected: a `web/` directory is created containing `package.json`, `src/app/{layout.tsx,page.tsx,globals.css}`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore`. The command prints `Success! Created web at ...`.

- [ ] **Step 2: Verify it boots**

```bash
cd web && pnpm build
```

Expected: build completes with `✓ Compiled successfully` and no errors (it will build the default "Hello world!" page — that page gets replaced in Task 13).

- [ ] **Step 3: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web
git commit -m "chore: scaffold Next.js 16 project for Novel website"
```

---

### Task 2: Add dependencies and configure Vitest

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`

- [ ] **Step 1: Install runtime dependencies**

```bash
cd web
pnpm add framer-motion @supabase/supabase-js server-only
```

- [ ] **Step 2: Install test dependencies**

```bash
pnpm add -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Create the Vitest config**

Create `web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Add the `test` script**

Edit `web/package.json` — add to `"scripts"`:

```json
    "test": "vitest run"
```

(Keep `dev`, `build`, `start`, `lint` as generated by Task 1.)

- [ ] **Step 5: Verify the runner works with zero tests**

```bash
pnpm test
```

Expected: Vitest starts, reports `No test files found` (this is expected — tests arrive in later tasks) and exits with a non-zero code. That failure is acceptable at this step; it only proves the config loads without a Vitest configuration error. Do not treat a config error (e.g. "Cannot find module") as passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/package.json web/pnpm-lock.yaml web/vitest.config.ts
git commit -m "chore: add framer-motion, Supabase client, and Vitest to web"
```

---

### Task 3: Typed environment modules

Two files, split by trust boundary: `client.ts` may be imported anywhere (browser or server); `server.ts` holds the service-role secret and must hard-fail if it's ever pulled into a client bundle.

**Files:**
- Create: `web/src/lib/env/client.ts`
- Create: `web/src/lib/env/server.ts`
- Test: `web/tests/unit/env-client.test.ts`
- Test: `web/tests/unit/env-server.test.ts`

- [ ] **Step 1: Write the failing client-env test**

Create `web/tests/unit/env-client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

describe("clientEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads required public vars", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    const { clientEnv } = await import("../../src/lib/env/client");
    expect(clientEnv.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    expect(clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key-value");
    expect(clientEnv.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("defaults NEXT_PUBLIC_GOOGLE_CLIENT_ID to an empty string when unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", undefined);
    const { clientEnv } = await import("../../src/lib/env/client");
    expect(clientEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID).toBe("");
  });

  it("throws one aggregated error naming every missing required var", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
    await expect(import("../../src/lib/env/client")).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_ANON_KEY.*NEXT_PUBLIC_SITE_URL/s,
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- env-client
```

Expected: FAIL — `Cannot find module '../../src/lib/env/client'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `client.ts`**

Create `web/src/lib/env/client.ts`:

```typescript
interface ClientEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  NEXT_PUBLIC_SITE_URL: string;
  /** Empty string until Plan 2 wires up Google One Tap. */
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: string;
}

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
] as const;

function buildClientEnv(): ClientEnv {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Copy web/.env.example to web/.env.local and fill them in.",
    );
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL!,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  };
}

export const clientEnv: ClientEnv = buildClientEnv();
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- env-client
```

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing server-env test**

Create `web/tests/unit/env-server.test.ts`:

```typescript
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

describe("serverEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads the service role key alongside the public vars", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-value");
    const { serverEnv } = await import("../../src/lib/env/server");
    expect(serverEnv.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-value");
    expect(serverEnv.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    await expect(import("../../src/lib/env/server")).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
```

Note the `// @vitest-environment node` docblock on line 1 — `server.ts` imports the `server-only` package, which throws immediately if `window` is defined, and Vitest's default `jsdom` environment defines `window`. This override runs just this file in a plain Node environment instead.

- [ ] **Step 6: Run it and confirm it fails**

```bash
pnpm test -- env-server
```

Expected: FAIL — `Cannot find module '../../src/lib/env/server'`.

- [ ] **Step 7: Implement `server.ts`**

Create `web/src/lib/env/server.ts`:

```typescript
import "server-only";
import { clientEnv } from "./client";

interface ServerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  NEXT_PUBLIC_SITE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function buildServerEnv(): ServerEnv {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Missing required environment variable(s): SUPABASE_SERVICE_ROLE_KEY. " +
        "Copy web/.env.example to web/.env.local and fill it in.",
    );
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: clientEnv.NEXT_PUBLIC_SITE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
}

export const serverEnv: ServerEnv = buildServerEnv();
```

- [ ] **Step 8: Run it and confirm it passes**

```bash
pnpm test -- env-server
```

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/env web/tests/unit/env-client.test.ts web/tests/unit/env-server.test.ts
git commit -m "feat: add typed client/server environment modules"
```

---

### Task 4: Supabase client factories

**Files:**
- Create: `web/src/lib/supabase/browser-client.ts`
- Create: `web/src/lib/supabase/server-client.ts`
- Test: `web/tests/unit/supabase-browser-client.test.ts`
- Test: `web/tests/unit/supabase-server-client.test.ts`

- [ ] **Step 1: Write the failing browser-client test**

Create `web/tests/unit/supabase-browser-client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getSupabaseBrowserClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns a Supabase client exposing auth and from", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    const { getSupabaseBrowserClient } = await import(
      "../../src/lib/supabase/browser-client"
    );
    const client = getSupabaseBrowserClient();
    expect(typeof client.auth.getSession).toBe("function");
    expect(typeof client.from).toBe("function");
  });

  it("memoizes: two calls return the same instance", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    const { getSupabaseBrowserClient } = await import(
      "../../src/lib/supabase/browser-client"
    );
    expect(getSupabaseBrowserClient()).toBe(getSupabaseBrowserClient());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- supabase-browser-client
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `browser-client.ts`**

Create `web/src/lib/supabase/browser-client.ts`:

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";

let browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }
  return browserClient;
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- supabase-browser-client
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing server-client test**

Create `web/tests/unit/supabase-server-client.test.ts`:

```typescript
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getSupabaseServiceRoleClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns a Supabase client built from the service role key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-value");
    const { getSupabaseServiceRoleClient } = await import(
      "../../src/lib/supabase/server-client"
    );
    const client = getSupabaseServiceRoleClient();
    expect(typeof client.auth.getSession).toBe("function");
    expect(typeof client.from).toBe("function");
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
pnpm test -- supabase-server-client
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `server-client.ts`**

Create `web/src/lib/supabase/server-client.ts`:

```typescript
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";

let serviceRoleClient: SupabaseClient | undefined;

export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (!serviceRoleClient) {
    serviceRoleClient = createClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
  }
  return serviceRoleClient;
}
```

- [ ] **Step 8: Run it and confirm it passes**

```bash
pnpm test -- supabase-server-client
```

Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/supabase web/tests/unit/supabase-browser-client.test.ts web/tests/unit/supabase-server-client.test.ts
git commit -m "feat: add Supabase browser and service-role client factories"
```

---

### Task 5: Design tokens (color)

Values are taken verbatim from the design spec §6.1 (semantic/editorial palette) and extend it with six muted, low-saturation **agent identity colors** — a gap the spec leaves open (§6.1 defines *status* colors shared by every domain, not one identity color per domain). Identity colors are deliberately desaturated and distinct from every status color so a vetoed Finance card (status = Failure crimson) is never confused with Finance's own header-bar identity color.

**Files:**
- Create: `web/src/lib/design/tokens.ts`
- Modify: `web/src/app/globals.css`
- Test: `web/tests/unit/design-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/design-tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { AGENT_COLORS, COLORS } from "../../src/lib/design/tokens";

describe("design tokens", () => {
  it("exposes the exact editorial palette from the design spec", () => {
    expect(COLORS.canvas).toBe("#F7F6F2");
    expect(COLORS.stage).toBe("#DCE6F4");
    expect(COLORS.ink).toBe("#101215");
    expect(COLORS.line).toBe("#D5D9DF");
    expect(COLORS.vermilion).toBe("#F0441D");
    expect(COLORS.info).toBe("#27A8DF");
    expect(COLORS.verified).toBe("#28C76F");
    expect(COLORS.counterterm).toBe("#F3BDD0");
    expect(COLORS.amber).toBe("#E4A52D");
    expect(COLORS.crimson).toBe("#BF2635");
  });

  it("defines a distinct identity color for each of the six agent roles", () => {
    const roles = ["sales", "finance", "inventory", "procurement", "logistics", "risk"] as const;
    for (const role of roles) {
      expect(AGENT_COLORS[role]).toMatch(/^#[0-9A-F]{6}$/i);
    }
    const values = roles.map((role) => AGENT_COLORS[role]);
    expect(new Set(values).size).toBe(roles.length);
  });

  it("keeps agent identity colors distinct from every status/semantic color", () => {
    const statusValues = Object.values(COLORS);
    for (const identity of Object.values(AGENT_COLORS)) {
      expect(statusValues).not.toContain(identity);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- design-tokens
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tokens.ts`**

Create `web/src/lib/design/tokens.ts`:

```typescript
/** Editorial/status palette — design spec §6.1, values copied verbatim. */
export const COLORS = {
  canvas: "#F7F6F2",
  stage: "#DCE6F4",
  ink: "#101215",
  line: "#D5D9DF",
  vermilion: "#F0441D",
  info: "#27A8DF",
  verified: "#28C76F",
  counterterm: "#F3BDD0",
  amber: "#E4A52D",
  crimson: "#BF2635",
} as const;

export type AgentRole =
  | "sales"
  | "finance"
  | "inventory"
  | "procurement"
  | "logistics"
  | "risk";

/**
 * Muted per-agent identity colors, used only for module header bars/labels —
 * never for status. Deliberately desaturated relative to COLORS so an agent's
 * identity never visually collides with its own status color (spec §6.1, §12.6).
 */
export const AGENT_COLORS: Record<AgentRole, string> = {
  sales: "#B8862B",
  finance: "#7A4A6B",
  inventory: "#2E7D6B",
  procurement: "#4A5A8C",
  logistics: "#3E6B77",
  risk: "#4A4E57",
};
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- design-tokens
```

Expected: PASS (3 tests).

- [ ] **Step 5: Mirror the tokens as Tailwind v4 theme variables**

Replace the contents of `web/src/app/globals.css` with:

```css
@import "tailwindcss";

@theme {
  --color-canvas: #F7F6F2;
  --color-stage: #DCE6F4;
  --color-ink: #101215;
  --color-line: #D5D9DF;
  --color-vermilion: #F0441D;
  --color-info: #27A8DF;
  --color-verified: #28C76F;
  --color-counterterm: #F3BDD0;
  --color-amber: #E4A52D;
  --color-crimson: #BF2635;

  --color-agent-sales: #B8862B;
  --color-agent-finance: #7A4A6B;
  --color-agent-inventory: #2E7D6B;
  --color-agent-procurement: #4A5A8C;
  --color-agent-logistics: #3E6B77;
  --color-agent-risk: #4A4E57;

  --font-sans: var(--font-inter);
}

body {
  background-color: var(--color-canvas);
  color: var(--color-ink);
}
```

This makes utilities like `bg-canvas`, `text-ink`, `bg-agent-finance` available everywhere in Task 11–13. `--font-inter` is defined by `layout.tsx` in Task 13.

- [ ] **Step 6: Verify the app still builds**

```bash
pnpm build
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 7: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/design web/tests/unit/design-tokens.test.ts web/src/app/globals.css
git commit -m "feat: add color design tokens and mirror them as Tailwind theme vars"
```

---

### Task 6: Motion tokens (timing + easing)

Values are the midpoint of each range in design spec §7.2 — tests assert against the spec's own documented range, not just the literal chosen value, so a future edit that drifts outside the spec's intent fails loudly.

**Files:**
- Create: `web/src/lib/motion/motion-tokens.ts`
- Test: `web/tests/unit/motion-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/motion-tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { EASING, MOTION_DURATION_MS } from "../../src/lib/motion/motion-tokens";

describe("motion tokens", () => {
  it("keeps every duration inside its design-spec §7.2 range (ms)", () => {
    expect(MOTION_DURATION_MS.controlFeedback).toBeGreaterThanOrEqual(100);
    expect(MOTION_DURATION_MS.controlFeedback).toBeLessThanOrEqual(160);

    expect(MOTION_DURATION_MS.chipEntrance).toBeGreaterThanOrEqual(160);
    expect(MOTION_DURATION_MS.chipEntrance).toBeLessThanOrEqual(240);

    expect(MOTION_DURATION_MS.cardEntrance).toBeGreaterThanOrEqual(280);
    expect(MOTION_DURATION_MS.cardEntrance).toBeLessThanOrEqual(420);

    expect(MOTION_DURATION_MS.focusRailTransition).toBeGreaterThanOrEqual(450);
    expect(MOTION_DURATION_MS.focusRailTransition).toBeLessThanOrEqual(650);

    expect(MOTION_DURATION_MS.connectorDraw).toBeGreaterThanOrEqual(500);
    expect(MOTION_DURATION_MS.connectorDraw).toBeLessThanOrEqual(900);

    expect(MOTION_DURATION_MS.fullSceneTransition).toBeGreaterThanOrEqual(650);
    expect(MOTION_DURATION_MS.fullSceneTransition).toBeLessThanOrEqual(900);
  });

  it("defines entrance and focusChange as 4-tuple cubic-bezier curves", () => {
    expect(EASING.entrance).toHaveLength(4);
    expect(EASING.focusChange).toHaveLength(4);
    for (const value of [...EASING.entrance, ...EASING.focusChange]) {
      expect(typeof value).toBe("number");
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- motion-tokens
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `motion-tokens.ts`**

Create `web/src/lib/motion/motion-tokens.ts`:

```typescript
/** Timing table — design spec §7.2. Each value is the midpoint of its documented range. */
export const MOTION_DURATION_MS = {
  controlFeedback: 140,
  chipEntrance: 200,
  cardEntrance: 360,
  focusRailTransition: 550,
  connectorDraw: 700,
  fullSceneTransition: 800,
} as const;

export type EasingCurve = [number, number, number, number];

/** Ease-out for entrances, symmetric ease-in-out for focus changes — design spec §7.2. No overshoot. */
export const EASING: { entrance: EasingCurve; focusChange: EasingCurve } = {
  entrance: [0.16, 1, 0.3, 1],
  focusChange: [0.65, 0, 0.35, 1],
};
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- motion-tokens
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/motion/motion-tokens.ts web/tests/unit/motion-tokens.test.ts
git commit -m "feat: add motion timing/easing tokens"
```

---

### Task 7: Depth-scale pure function

Implements design spec §6.5 (focused = 100%, adjacent ≈ 72–80%, distant ≈ 52–64%).

**Files:**
- Create: `web/src/lib/motion/depth-scale.ts`
- Test: `web/tests/unit/depth-scale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/depth-scale.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getDepthScale } from "../../src/lib/motion/depth-scale";

describe("getDepthScale", () => {
  it("returns 1 for focused", () => {
    expect(getDepthScale("focused")).toBe(1);
  });

  it("returns a value inside 0.72–0.80 for adjacent", () => {
    const scale = getDepthScale("adjacent");
    expect(scale).toBeGreaterThanOrEqual(0.72);
    expect(scale).toBeLessThanOrEqual(0.8);
  });

  it("returns a value inside 0.52–0.64 for distant", () => {
    const scale = getDepthScale("distant");
    expect(scale).toBeGreaterThanOrEqual(0.52);
    expect(scale).toBeLessThanOrEqual(0.64);
  });

  it("orders focused > adjacent > distant", () => {
    expect(getDepthScale("focused")).toBeGreaterThan(getDepthScale("adjacent"));
    expect(getDepthScale("adjacent")).toBeGreaterThan(getDepthScale("distant"));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- depth-scale
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `depth-scale.ts`**

Create `web/src/lib/motion/depth-scale.ts`:

```typescript
export type DepthLevel = "focused" | "adjacent" | "distant";

/** Design spec §6.5: focused = full scale; adjacent ≈ 72–80%; distant ≈ 52–64%. */
const DEPTH_SCALE: Record<DepthLevel, number> = {
  focused: 1,
  adjacent: 0.76,
  distant: 0.58,
};

export function getDepthScale(level: DepthLevel): number {
  return DEPTH_SCALE[level];
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- depth-scale
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/motion/depth-scale.ts web/tests/unit/depth-scale.test.ts
git commit -m "feat: add depth-scale pure function for the focus-rail effect"
```

---

### Task 8: Demo-choreography state machine

This is the flagship precision piece the landing-page demo section (Task 12) renders. It is a pure function of elapsed milliseconds — no timers, no React — so it is exhaustively testable. It implements the 7-beat sequence from design spec §4.4, using the shared depth/motion tokens' spirit for pacing (not their literal per-control durations, since these are full narrative beats, not micro-interactions).

**Files:**
- Create: `web/src/lib/motion/demo-choreography.ts`
- Test: `web/tests/unit/demo-choreography.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/demo-choreography.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  DEMO_STAGES,
  getActiveStage,
  getTotalDuration,
} from "../../src/lib/motion/demo-choreography";

describe("demo choreography", () => {
  it("has exactly 7 stages matching the spec §4.4 sequence", () => {
    expect(DEMO_STAGES).toHaveLength(7);
    expect(DEMO_STAGES.map((s) => s.id)).toEqual([
      "query",
      "crumble",
      "sales",
      "fanout",
      "risk",
      "coordinator",
      "certificate",
    ]);
  });

  it("every stage has a positive duration and non-empty label", () => {
    for (const stage of DEMO_STAGES) {
      expect(stage.durationMs).toBeGreaterThan(0);
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });

  it("sums to the expected total loop duration", () => {
    expect(getTotalDuration(DEMO_STAGES)).toBe(9900);
  });

  it("returns stage 0 at elapsed = 0", () => {
    const active = getActiveStage(0, DEMO_STAGES);
    expect(active.index).toBe(0);
    expect(active.stage.id).toBe("query");
    expect(active.stageElapsedMs).toBe(0);
  });

  it("stays on stage 0 right up to its boundary, then advances", () => {
    const justBefore = getActiveStage(1399, DEMO_STAGES);
    expect(justBefore.index).toBe(0);
    const atBoundary = getActiveStage(1400, DEMO_STAGES);
    expect(atBoundary.index).toBe(1);
    expect(atBoundary.stage.id).toBe("crumble");
    expect(atBoundary.stageElapsedMs).toBe(0);
  });

  it("wraps back to stage 0 after exactly one full loop", () => {
    const total = getTotalDuration(DEMO_STAGES);
    const active = getActiveStage(total, DEMO_STAGES);
    expect(active.index).toBe(0);
  });

  it("wraps correctly for elapsed values beyond one loop", () => {
    const total = getTotalDuration(DEMO_STAGES);
    const active = getActiveStage(total + 1400, DEMO_STAGES);
    expect(active.index).toBe(1);
  });

  it("handles a negative elapsed value without throwing", () => {
    expect(() => getActiveStage(-100, DEMO_STAGES)).not.toThrow();
  });

  it("throws for an empty stage list", () => {
    expect(() => getActiveStage(0, [])).toThrow(/at least one stage/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- demo-choreography
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `demo-choreography.ts`**

Create `web/src/lib/motion/demo-choreography.ts`:

```typescript
export type DemoNodeId =
  | "query"
  | "sales"
  | "finance"
  | "inventory"
  | "procurement"
  | "logistics"
  | "risk"
  | "coordinator"
  | "certificate";

export interface DemoStage {
  id: string;
  focusedNodeId: DemoNodeId;
  label: string;
  durationMs: number;
}

/** Design spec §4.4 — fixed fake-data sequence for the landing-page autoplay demo. */
export const DEMO_STAGES: DemoStage[] = [
  {
    id: "query",
    focusedNodeId: "query",
    label: "25,000 power banks · 12% discount · Net-60 · 14-day delivery",
    durationMs: 1400,
  },
  {
    id: "crumble",
    focusedNodeId: "query",
    label: "Breaking the request into terms",
    durationMs: 900,
  },
  {
    id: "sales",
    focusedNodeId: "sales",
    label: "Sales: normalizing the request",
    durationMs: 1200,
  },
  {
    id: "fanout",
    focusedNodeId: "finance",
    label: "Finance / Inventory / Procurement / Logistics: checking dependencies",
    durationMs: 1800,
  },
  {
    id: "risk",
    focusedNodeId: "risk",
    label: "Risk: reviewing evidence freshness",
    durationMs: 1200,
  },
  {
    id: "coordinator",
    focusedNodeId: "coordinator",
    label: "Coordinator: verifying the complete set",
    durationMs: 1400,
  },
  {
    id: "certificate",
    focusedNodeId: "certificate",
    label: "Committed after counterterm — 30% advance required",
    durationMs: 2000,
  },
];

export interface ActiveStage {
  stage: DemoStage;
  index: number;
  stageElapsedMs: number;
}

export function getTotalDuration(stages: DemoStage[]): number {
  return stages.reduce((sum, stage) => sum + stage.durationMs, 0);
}

/** Pure: given elapsed ms since the loop started, which stage is active right now. Wraps modulo the total duration so the demo loops forever. */
export function getActiveStage(elapsedMs: number, stages: DemoStage[]): ActiveStage {
  if (stages.length === 0) {
    throw new Error("getActiveStage requires at least one stage");
  }
  const total = getTotalDuration(stages);
  const wrapped = ((elapsedMs % total) + total) % total;
  let cursor = 0;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    if (wrapped < cursor + stage.durationMs) {
      return { stage, index, stageElapsedMs: wrapped - cursor };
    }
    cursor += stage.durationMs;
  }
  const lastIndex = stages.length - 1;
  return {
    stage: stages[lastIndex],
    index: lastIndex,
    stageElapsedMs: stages[lastIndex].durationMs,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- demo-choreography
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/motion/demo-choreography.ts web/tests/unit/demo-choreography.test.ts
git commit -m "feat: add demo-choreography state machine for the landing-page demo"
```

---

### Task 9: `useReducedMotion` hook

Implements design spec §18 — every animated experience must respect `prefers-reduced-motion`.

**Files:**
- Create: `web/src/lib/motion/use-reduced-motion.ts`
- Test: `web/tests/unit/use-reduced-motion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/use-reduced-motion.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducedMotion } from "../../src/lib/motion/use-reduced-motion";

function mockMatchMedia(initialMatches: boolean) {
  let changeHandler: ((event: MediaQueryListEvent) => void) | undefined;
  const mql = {
    matches: initialMatches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
      changeHandler = handler;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    triggerChange: (matches: boolean) => {
      act(() => changeHandler?.({ matches } as MediaQueryListEvent));
    },
  };
}

describe("useReducedMotion", () => {
  it("returns false when the media query does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when the media query matches on mount", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes after mount", () => {
    const { triggerChange } = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    triggerChange(true);
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd web && pnpm test -- use-reduced-motion
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `use-reduced-motion.ts`**

Create `web/src/lib/motion/use-reduced-motion.ts`:

```typescript
"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQueryList = window.matchMedia(QUERY);
    setReduced(mediaQueryList.matches);
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm test -- use-reduced-motion
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/lib/motion/use-reduced-motion.ts web/tests/unit/use-reduced-motion.test.ts
git commit -m "feat: add useReducedMotion hook"
```

---

### Task 10: `FocusStage` component

The one reusable animation primitive every stage of the demo section uses (design spec §6.5/§7.1 "focus rail"). This is pure composition over already-tested logic (`getDepthScale`, motion tokens) — **TDD is skipped here per this repo's convention that UI composition doesn't get unit tests**; correctness is checked by a build/lint pass instead.

**Files:**
- Create: `web/src/components/landing/focus-stage.tsx`

- [ ] **Step 1: Implement the component**

Create `web/src/components/landing/focus-stage.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { getDepthScale, type DepthLevel } from "@/lib/motion/depth-scale";
import { EASING, MOTION_DURATION_MS } from "@/lib/motion/motion-tokens";

interface FocusStageProps {
  depth: DepthLevel;
  children: ReactNode;
}

/**
 * Scales and fades a node based on whether it is the current focus, adjacent
 * to it, or distant — the "camera pans to whatever is doing work right now"
 * effect from design spec §6.5/§7.1. Respects reduced motion by rendering the
 * same transition with duration 0 (still applies the correct final scale so
 * layout stays consistent — see design spec §18).
 */
export function FocusStage({ depth, children }: FocusStageProps) {
  const scale = getDepthScale(depth);
  return (
    <motion.div
      animate={{ scale, opacity: depth === "distant" ? 0.7 : 1 }}
      transition={{
        duration: MOTION_DURATION_MS.focusRailTransition / 1000,
        ease: EASING.focusChange,
      }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify lint passes**

```bash
cd web && pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/components/landing/focus-stage.tsx
git commit -m "feat: add FocusStage reusable focus-rail animation primitive"
```

---

### Task 11: Static landing sections (nav, hero, why-Novel, trust, final CTA, footer)

Real, final copy — none of this is placeholder text. **TDD is skipped for these files** (static content composition, per this repo's UI-tweaks convention) — verified instead by `pnpm build` and a manual look in the browser at the end of Task 13.

**Files:**
- Create: `web/src/components/landing/nav-bar.tsx`
- Create: `web/src/components/landing/hero.tsx`
- Create: `web/src/components/landing/why-novel.tsx`
- Create: `web/src/components/landing/trust-section.tsx`
- Create: `web/src/components/landing/final-cta.tsx`
- Create: `web/src/components/landing/footer.tsx`

- [ ] **Step 1: Nav bar**

Create `web/src/components/landing/nav-bar.tsx`:

```tsx
import Link from "next/link";

export function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Novel
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-ink/80 md:flex">
          <a href="#demo">Product</a>
          <a href="#why-novel">How it works</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/signin" className="text-sm font-medium text-ink/80 hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-vermilion px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Hero**

Create `web/src/components/landing/hero.tsx`:

```tsx
import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 text-center md:py-32">
      <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
        Agents propose. Code verifies.{" "}
        <span className="text-vermilion">Nothing gets promised until it&apos;s backed.</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-ink/70">
        Novel checks inventory, credit, supply, and delivery before your quote goes out —
        and proves it with a Commit Certificate.
      </p>
      <div className="mt-10 flex items-center justify-center gap-4">
        <Link
          href="/signup"
          className="rounded-lg bg-vermilion px-6 py-3 text-base font-semibold text-white hover:opacity-90"
        >
          Get started
        </Link>
        <a
          href="#demo"
          className="rounded-lg border border-line px-6 py-3 text-base font-semibold text-ink hover:bg-stage"
        >
          See it work
        </a>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Why Novel**

Create `web/src/components/landing/why-novel.tsx`:

```tsx
const REASONS = [
  {
    title: "Fragmented authority",
    body: "Sales negotiates. Finance holds credit. Inventory holds stock. None of them see the whole promise before it's made.",
  },
  {
    title: "Approvals aren't reservations",
    body: "A manager saying yes doesn't hold the inventory, the credit line, or the delivery slot behind it.",
  },
  {
    title: "Evidence goes stale",
    body: "A number that was true when checked isn't automatically true when the order is confirmed.",
  },
  {
    title: "The cost shows up later",
    body: "Margin leakage, rush freight, and broken promises — paid for after the quote already went out.",
  },
];

export function WhyNovel() {
  return (
    <section id="why-novel" className="mx-auto max-w-[1440px] px-6 py-24">
      <h2 className="text-3xl font-bold tracking-tight">Why Novel</h2>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {REASONS.map((reason) => (
          <div key={reason.title} className="rounded-xl border border-line bg-white p-6">
            <h3 className="text-xl font-bold">{reason.title}</h3>
            <p className="mt-2 text-ink/70">{reason.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Trust section**

Create `web/src/components/landing/trust-section.tsx`:

```tsx
export function TrustSection() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24">
      <h2 className="text-3xl font-bold tracking-tight">Every promise ships with proof</h2>
      <div className="mx-auto mt-10 max-w-xl rounded-xl border border-line bg-white p-8">
        <div className="mb-4 inline-block rounded-full border border-amber px-3 py-1 text-xs font-semibold text-amber">
          Staged example — not a live customer certificate
        </div>
        <dl className="space-y-3 font-mono text-sm">
          <div className="flex justify-between">
            <dt className="text-ink/60">terms_hash</dt>
            <dd>sha256:4a1f…9c2e</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink/60">required receipts</dt>
            <dd>4 of 4 held</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink/60">valid until</dt>
            <dd>2026-08-30T18:00:00+05:30</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink/60">weakest assurance</dt>
            <dd>Snapshot observation</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Final CTA**

Create `web/src/components/landing/final-cta.tsx`:

```tsx
import Link from "next/link";

export function FinalCta() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 text-center">
      <h2 className="text-3xl font-bold tracking-tight">
        Ready to make promises you can back?
      </h2>
      <Link
        href="/signup"
        className="mt-8 inline-block rounded-lg bg-vermilion px-6 py-3 text-base font-semibold text-white hover:opacity-90"
      >
        Get started
      </Link>
    </section>
  );
}
```

- [ ] **Step 6: Footer**

Create `web/src/components/landing/footer.tsx`:

```tsx
import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-ink/60 md:flex-row">
        <span className="font-bold text-ink">Novel</span>
        <div className="flex gap-6">
          <Link href="/signin">Sign in</Link>
          <Link href="/signup">Get started</Link>
        </div>
        <span>© 2026 Novel.</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/components/landing/nav-bar.tsx web/src/components/landing/hero.tsx web/src/components/landing/why-novel.tsx web/src/components/landing/trust-section.tsx web/src/components/landing/final-cta.tsx web/src/components/landing/footer.tsx
git commit -m "feat: add static landing page sections"
```

---

### Task 12: Demo section (the choreographed centerpiece)

Wires `demo-choreography.ts`, `FocusStage`, and `useReducedMotion` together into the scroll-triggered, autoplay-looping sequence from design spec §4.4/§8. **TDD is skipped for this file** (UI composition) — the logic it depends on is already fully unit-tested in Tasks 8 and 9.

**Files:**
- Create: `web/src/components/landing/demo-section.tsx`

- [ ] **Step 1: Implement the component**

Create `web/src/components/landing/demo-section.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { FocusStage } from "./focus-stage";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import {
  DEMO_STAGES,
  getActiveStage,
  type DemoNodeId,
} from "@/lib/motion/demo-choreography";
import { AGENT_COLORS, type AgentRole } from "@/lib/design/tokens";

const TICK_MS = 50;

const AGENT_NODES: { id: DemoNodeId; role: AgentRole; label: string }[] = [
  { id: "sales", role: "sales", label: "Sales" },
  { id: "finance", role: "finance", label: "Finance" },
  { id: "inventory", role: "inventory", label: "Inventory" },
  { id: "procurement", role: "procurement", label: "Procurement" },
  { id: "logistics", role: "logistics", label: "Logistics" },
  { id: "risk", role: "risk", label: "Risk" },
];

/** During the "fanout" stage, Finance/Inventory/Procurement/Logistics are all active together — matching the real concurrent call topology (design spec §4.4 step 4). */
function isNodeActive(nodeId: DemoNodeId, focusedNodeId: DemoNodeId): boolean {
  if (nodeId === focusedNodeId) return true;
  const fanoutGroup: DemoNodeId[] = ["finance", "inventory", "procurement", "logistics"];
  return focusedNodeId === "finance" && fanoutGroup.includes(nodeId);
}

export function DemoSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { amount: 0.5 });
  const reducedMotion = useReducedMotion();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isInView || reducedMotion) return;
    setElapsedMs(0);
    const interval = setInterval(() => {
      setElapsedMs((current) => current + TICK_MS);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [isInView, reducedMotion]);

  if (reducedMotion) {
    return (
      <section id="demo" ref={sectionRef} className="mx-auto max-w-[1440px] px-6 py-24">
        <h2 className="text-3xl font-bold tracking-tight">How a request becomes a promise</h2>
        <ol className="mt-8 space-y-4">
          {DEMO_STAGES.map((stage) => (
            <li key={stage.id} className="rounded-xl border border-line bg-white p-4">
              {stage.label}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const active = getActiveStage(elapsedMs, DEMO_STAGES);

  return (
    <section
      id="demo"
      ref={sectionRef}
      className="mx-auto max-w-[1440px] rounded-2xl bg-stage px-6 py-24"
    >
      <h2 className="text-3xl font-bold tracking-tight">How a request becomes a promise</h2>
      <div className="mt-10 flex min-h-[360px] flex-col items-center justify-center gap-6">
        <FocusStage depth="focused">
          <div className="rounded-xl bg-white px-6 py-4 text-center font-mono text-sm shadow-sm">
            {active.stage.label}
          </div>
        </FocusStage>
        <div className="flex flex-wrap justify-center gap-3">
          {AGENT_NODES.map((node) => {
            const isActive = isNodeActive(node.id, active.stage.focusedNodeId);
            return (
              <FocusStage key={node.id} depth={isActive ? "adjacent" : "distant"}>
                <div
                  className="rounded-full px-4 py-2 text-xs font-semibold text-white"
                  style={{ backgroundColor: AGENT_COLORS[node.role] }}
                >
                  {node.label}
                </div>
              </FocusStage>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify lint passes**

```bash
cd web && pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/components/landing/demo-section.tsx
git commit -m "feat: add DemoSection choreographed landing-page centerpiece"
```

---

### Task 13: Assemble the page

**Files:**
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Update the root layout**

Replace `web/src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Novel — Agents propose. Code verifies.",
  description:
    "Novel checks inventory, credit, supply, and delivery before your quote goes out — and proves it with a Commit Certificate.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Assemble the landing page**

Replace `web/src/app/page.tsx` with:

```tsx
import { NavBar } from "@/components/landing/nav-bar";
import { Hero } from "@/components/landing/hero";
import { DemoSection } from "@/components/landing/demo-section";
import { WhyNovel } from "@/components/landing/why-novel";
import { TrustSection } from "@/components/landing/trust-section";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <NavBar />
      <main>
        <Hero />
        <DemoSection />
        <WhyNovel />
        <TrustSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Run the full test suite**

```bash
cd web && pnpm test
```

Expected: all unit tests from Tasks 3–9 PASS.

- [ ] **Step 4: Build and manually verify**

```bash
pnpm build
```

Expected: `✓ Compiled successfully`. Then run `pnpm dev`, open `http://localhost:3000`, and confirm: the hero renders with the headline/CTAs, scrolling to `#demo` shows the agent pills cycling through the choreography every ~10 seconds, and toggling "reduce motion" in OS accessibility settings switches the demo section to the plain numbered list.

- [ ] **Step 5: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/src/app/layout.tsx web/src/app/page.tsx
git commit -m "feat: assemble the Novel landing page"
```

---

### Task 14: `integrations.md`

**Files:**
- Create: `web/integrations.md`

- [ ] **Step 1: Write the file**

Create `web/integrations.md`:

```markdown
# Novel — Integrations & External Accounts

This document lists every external service Novel depends on, what each variable in `.env.example` is for, and the setup steps to get a working local `.env.local`. Keep it in sync whenever a new integration is added in a later plan.

## Required now (Plan 1 — foundation + landing page)

### Supabase

Novel uses one Supabase project for Postgres, Auth, Storage, and Realtime.

1. Create a project at https://supabase.com/dashboard.
2. In **Project Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose this in a `NEXT_PUBLIC_*` variable or ship it to the browser)
3. Nothing else needs configuring yet — Plan 1 only constructs Supabase clients, it doesn't call them.

### Site URL

- `NEXT_PUBLIC_SITE_URL` — the base URL the app is served from. `http://localhost:3000` for local dev; set to the real production domain once one is deployed.

## Required starting Plan 2 (auth + onboarding) — not needed yet

### Google Cloud OAuth client (for Google One Tap)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**, type **Web application**.
3. Add every origin the app will be served from under **Authorized JavaScript origins** (e.g. `http://localhost:3000` for local dev, plus the production domain once known).
4. Copy the generated **Client ID** into `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
5. In Supabase, go to **Authentication → Providers → Google**, enable it, and paste the same Client ID (and the matching Client Secret) so Supabase's `signInWithIdToken` flow can verify the One Tap credential.

Leave `NEXT_PUBLIC_GOOGLE_CLIENT_ID` blank until Plan 2 — the app runs fine without it (see `src/lib/env/client.ts`, where it's optional).

## Deployment

Recommended target: [Vercel](https://vercel.com) (first-party Next.js support, zero-config for the App Router).

1. Import the `web/` directory as the project root when connecting the GitHub repo (set **Root Directory** to `web` in the Vercel project settings).
2. Add every variable from `.env.example` under **Project Settings → Environment Variables**, using real Supabase/Google values for the target environment (Preview vs. Production can point at different Supabase projects if you want isolated data).
3. `NEXT_PUBLIC_SITE_URL` must match the actual deployed URL for each environment.

## Local development

```bash
cd web
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
pnpm install
pnpm dev
```

## Environment variable reference

| Variable | Required from | Where used | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Plan 1 | browser + server | Public — safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Plan 1 | browser + server | Public — safe to expose, RLS enforces access control |
| `SUPABASE_SERVICE_ROLE_KEY` | Plan 1 | server only | **Secret** — bypasses RLS, never send to the browser |
| `NEXT_PUBLIC_SITE_URL` | Plan 1 | browser + server | Base URL of the deployment |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Plan 2 | browser | Optional until Plan 2 ships Google One Tap |
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/integrations.md
git commit -m "docs: add integrations.md for Novel's external services"
```

---

### Task 15: `.env.example`

**Files:**
- Create: `web/.env.example`

- [ ] **Step 1: Write the file**

Create `web/.env.example`:

```bash
# Supabase — see integrations.md for how to obtain these (required from Plan 1)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Base URL of this deployment (required from Plan 1)
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Google One Tap client ID — leave blank until Plan 2 (see integrations.md)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

- [ ] **Step 2: Confirm it's tracked by git despite the blanket `.env*` gitignore rule**

`web/.gitignore` (generated in Task 1) contains `.env*`, which would silently exclude `.env.example` too. Check:

```bash
cd web && git check-ignore -v .env.example
```

If it prints a match against the `.env*` rule, add an explicit negation. Edit `web/.gitignore`, adding this line directly after the `.env*` line:

```
!.env.example
```

- [ ] **Step 3: Verify it's now trackable**

```bash
git check-ignore -v .env.example
```

Expected: no output (nothing matches — the file is no longer ignored).

- [ ] **Step 4: Commit**

```bash
cd /Users/eidoviscontact/Novel/Novel
git add web/.env.example web/.gitignore
git commit -m "chore: add .env.example and un-ignore it"
```

---

### Task 16: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
cd web && pnpm test
```

Expected: every test from Tasks 3, 4, 5, 6, 7, 8, 9 passes (22 tests total).

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Production build**

```bash
pnpm build
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Confirm no real secrets are staged**

```bash
cd /Users/eidoviscontact/Novel/Novel
git status
git log --oneline -20
```

Expected: working tree clean, `.env.local` never appears in any commit (only `.env.example`, which contains no real values).

---

## Self-review notes

- **Spec coverage:** every landing-page element in design spec §4 (nav, hero, demo, why-Novel, trust, final CTA, footer) has a task; §6 (color tokens) → Task 5; §7 (motion timing/depth) → Tasks 6–7; §4.4/§8 (choreography + latency-independent pacing + reduced motion) → Tasks 8, 9, 12; §12 (Supabase-backed foundation, ahead of Plan 2) → Tasks 3–4; the endpoint/integration boundary from §11/§14 → Task 14. Auth, onboarding, data ingestion, the authenticated app shell, and the live `case_event`-driven animation are explicitly out of scope here and become Plans 2–5.
- **Placeholder scan:** no TBD/TODO; every file-creation step shows complete file content; all copy is final text, not lorem ipsum.
- **Type consistency:** `DemoNodeId`, `AgentRole`, `DepthLevel`, and the `COLORS`/`AGENT_COLORS`/`MOTION_DURATION_MS`/`EASING` shapes are defined once (Tasks 5–8) and reused with matching names/signatures in Tasks 10 and 12 (`FocusStage`, `DemoSection`).
- **Known gap flagged, not silently resolved:** the design spec's §6.1 palette defines status colors but not one identity color per agent — Task 5 makes an explicit, documented design call (six new muted `AGENT_COLORS`, kept disjoint from status colors) rather than guessing or leaving it undone.
