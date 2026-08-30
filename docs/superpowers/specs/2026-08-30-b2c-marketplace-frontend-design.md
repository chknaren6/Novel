# B2C Marketplace Frontend — Design

## Context

A frontend mockup (`ERP Commitment Desk Workflow.zip`, provided separately) exists for Novel's two customer-facing flows: the B2B "commitment desk" and the B2C "marketplace" (Phase 2). It's a static HTML+JS prototype — one `state` object, one `renderVals()` derivation function, two demo timers (`tick()`/`mtick()`) standing in for real backend events — with an `INTEGRATION.md` documenting exactly how to wire it to real data.

The B2C backend (intake parsing, supplier check, case creation, commit, buyer response) is now fully built and tested (`docs/superpowers/plans/2026-08-30-b2c-core-workflow.md`, 186/186 tests passing). This design covers **Phase 1: porting the B2C marketplace screen to a real, working UI** inside the CommitOS app (`app/`), driven by that backend instead of a timer. B2B ("commitment desk") porting is Phase 2, deferred until Phase 1 proves the pattern.

`app/` is currently a pure scaffold — a placeholder page, no UI library installed, direct Prisma access to all case/event data. It's the natural home for this UI: no API bridge needed to a separate project, and this is an internal operator tool (not the public marketing site, which lives separately in `web/`).

## Goal

One operator, using a single browser tab, can: paste in a raw buyer requirement, see real supplier candidates, review an AI-generated negotiation brief for their chosen supplier, enter the negotiated price they actually got, generate a real signed buyer link, and watch the case move through find → negotiate → commit against the real database — with the exact visual design, copy, and layout already established in the mockup, not a re-design. A separate minimal page lets a "buyer" (the same operator, in a second tab, for demo purposes) accept or reject the resulting quote.

No authentication — this is a single-operator hackathon demo, and that constraint is explicit here rather than silently assumed.

## Architecture

**Approach: faithful port, not a reskin.** The mockup's markup is inline-styled HTML with a tiny templating layer (`sc-if` for conditionals, `sc-for` for lists, `{{ x }}` for interpolation) that maps close to 1:1 onto React JSX. The plan is to carry over the exact styles, copy, and layout for the marketplace screen, replacing only:
- `support.js`'s templating runtime → real React/JSX.
- The `mtick()` timer that fakes `mstage` progression → a pure function deriving the equivalent UI state from real `DealCase` + `CaseEvent` rows.
- The single hardcoded demo case (Vikram Traders / Kirloskar) → a real, operator-driven case created through the actual backend functions.

### Pages (`app/src/app/`)

- **`/market`** — the operator dashboard. Composer (paste raw requirement → see candidates → pick one → review its negotiation brief → confirm negotiated price → generate buyer link) plus the live progress view (dots, clusters, spread figures) ported directly from the mockup's `showMarket` screen.
- **`/market/[caseId]/accept`** — the buyer-facing page. Not in the mockup (which only shows the operator's side); new, but small: shows the quote, has accept/reject buttons, calls `runB2CBuyerResponse`.

### Negotiation brief generator (new backend piece — `src/workflow/b2c/negotiationBrief.ts`)

Per the product spec (§Step 3), before the human negotiator contacts a supplier, an "AI negotiation assistant" prepares a brief with: market price range, the supplier's historical pricing if any, the buyer's deadline, BATNA, a suggested opening price, a walk-away price, and negotiation levers. This didn't exist before this design was reviewed — it's new backend scope, not just a UI addition. Split by how each field is actually produced:

- **Deterministic, no LLM** (computed from data we already have):
  - *BATNA*: the other entries `findSupplierCandidates` already returned for this SKU, minus the chosen one — real data, not a guess.
  - *Buyer's deadline*: straight from `parsedRequirement.deliveryDeadline`.
  - *Walk-away price*: a flat policy percentage below the chosen candidate's listed price (mirroring the mockup's own framing of walk-away as "fixed by category, never crossed" — a policy constant, not a live calculation). Since categories aren't modeled yet, one flat percentage stands in for "by category" — documented as a known simplification.
  - *Supplier's historical pricing*: a query for prior `TermsVersion.confirmedBuyPriceMinor` rows against this `supplierId`+`sku` — if none exist (likely, for most demo suppliers), the brief says so plainly rather than fabricating history.
- **LLM-generated** (judgment/writing, where a model earns its keep): market price range estimate for the item, and suggested opening price + negotiation levers (volume framing, repeat-order potential, competing-quote framing), informed by the deterministic fields above as context. One structured-output call, same shape as `parseB2CRequirement` (Task 4 of the core-workflow plan) — direct `client.chat.completions.create`, not `ModelGateway.runRole`, same `ToolError` wrapping conventions.

This function does not persist anything — it's a read-only advisory call the operator sees before entering the price they actually negotiated; `createB2CCase` is unaffected and still takes the human-confirmed price as its input, per spec ("The AI does not negotiate autonomously").

### Route handlers (`app/src/app/api/b2c/...`)

Reads for the operator's own dashboard go straight through Server Components (direct Prisma access, no handler needed). Writes that invoke real backend logic go through Route Handlers:
- `POST /api/b2c/intake` → `parseB2CRequirement` + `findSupplierCandidates`, returns parsed requirement + ranked candidates.
- `POST /api/b2c/negotiation-brief` → the brief generator above, given the chosen candidate + the other candidates + parsed requirement.
- `POST /api/b2c/cases` → `createB2CCase`, given the operator's chosen supplier + negotiated price. Returns the case ID and buyer link.
- `GET /api/b2c/cases/[id]` → current case status + event log, for the dashboard's poll.
- `POST /api/b2c/cases/[id]/respond` → `runB2CBuyerResponse`, used by the buyer-facing page.

### Live updates

A single operator watching their own request resolve doesn't need websockets. The dashboard polls `GET /api/b2c/cases/[id]` every 2–3 seconds while a case is in flight, and stops polling once the case reaches a terminal status (`committed`, `cannot_commit`, `escalated`).

### State derivation

`deriveMarketState(dealCase, events): MarketViewState` is the direct analog of the mockup's `renderVals()`, but computed from real rows instead of `this.state.mstage`. It maps:
- `dealCase.status` + the presence/absence of specific `eventType`s in the event log → the mockup's `mstage` 0–7 (e.g., `evaluating` + `b2c.requirement_parsed` present but no `case.prepared` yet → mid-negotiation stage; `committed` → stage 7).
- An empty `findSupplierCandidates` result → the mockup's `noMatch` branch, using its existing copy.
- `escalated` status → a new branch not in the original mockup (see Error Handling).

This function is the one piece of real logic in this feature and gets real tests; the ported JSX itself does not (see Testing).

## Error Handling

- **No-match** (`findSupplierCandidates` returns `[]`): renders the mockup's existing `noMatch` copy and figures — no new design needed, just wiring the existing branch to a real empty result instead of a manual toggle.
- **Escalated case** (a commit fails after the supplier already committed — the exact failure mode hardened in `createCase.ts`/`commit.ts` this session): a plain "this needs your attention" banner with the recorded reason, since the original mockup never designed for this state. Proportionate to a demo — surfaces the failure honestly rather than hiding it or over-building bespoke UI for a rare path.
- **Expired/tampered buyer link**: the buyer page shows a simple "this link has expired" message when `runB2CBuyerResponse` returns `invalid_or_expired`.
- **Intake parsing failure** (LLM/network error surfaced as `ToolError`): shown inline in the compose form with a retry button, not a silent failure or a crash.

## Testing

TDD is used where there's real logic to get wrong silently:
- `deriveMarketState`: full test coverage, same convention as the backend's pure-function tests (`b2cMargin.test.ts` etc.) — given a case+event fixture, assert the exact derived stage/labels/figures.
- `negotiationBrief.ts`: the deterministic parts (BATNA, walk-away price, historical-pricing lookup) get exact-value tests; the LLM call gets a faked-client test following `intake.test.ts`'s exact pattern (`fakeClient` helper, `ToolError` wrapping assertions).
- The five route handlers: integration tests against the real test DB, following the `e2e.test.ts` pattern already established for the backend.

TDD is **not** used for the ported JSX/markup itself — this is UI-tweak territory (copying an already-designed layout), not logic, so skipping automated tests there is an explicit choice, not an oversight. Manual visual verification (running the app, comparing to the mockup) is the check for that part.

## Explicitly Out of Scope for Phase 1

- The B2B "commitment desk" screen (Phase 2, later — depends on this phase proving the pattern, and additionally needs new `agent.started`-style backend events not yet built for B2B).
- Autonomous AI-to-supplier negotiation — the product spec is explicit that this is out of scope for Phase 1 ("The AI does not negotiate autonomously"); the negotiation brief generator above assists a human negotiator, it doesn't replace them.
- Authentication/authorization of any kind.
- WhatsApp API and Razorpay integration (flagged by the user as a good future improvement — not part of this build).
- The mockup's `/data` (Sources) and `/profile` screens — not needed for the B2C demo path.
- Websocket/SSE-based live updates (polling is sufficient at this scale).
