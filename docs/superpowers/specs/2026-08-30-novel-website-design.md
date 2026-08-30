# Novel — Website & Product-UI Design Spec

**Status:** Design, approved shape, pre-implementation
**Scope:** The customer-facing website and web app only — marketing site, auth/onboarding, data ingestion UI, and the post-auth application shell (input bar → agent animation → report). The six role-agents, the deterministic coordinator, and the CommitOS orchestration engine are being built separately ("the other end") and are treated here as an integration boundary, not something this spec designs.
**Relationship to existing docs:** This spec assumes and extends `Project Scope/build-specs/*` (CommitOS). Where CommitOS already defines a schema, state machine, or API, Novel reuses it verbatim rather than inventing a parallel one. Anywhere this spec needs something CommitOS hasn't defined yet, it's called out explicitly under "New surface this spec introduces."

---

## 1. Positioning

**Novel** is the brand name of the product built on the CommitOS engine: six permissioned role-agents (Sales, Finance, Inventory, Procurement, Logistics, Risk) that turn a B2B quote request into a resource-backed Commit Certificate, a bounded counteroffer, or a truthful refusal — never a vague "recommendation."

The website's job is to make that mechanism *legible*. Every UI decision below is in service of one idea: show the user the real dependency graph and real typed decisions, not a generic "AI is thinking" spinner.

**One-line pitch for the hero:** *"Agents propose. Code verifies. Nothing gets promised until it's backed."*

---

## 2. Non-goals (explicit scope boundary)

- This spec does not design the agent runtime, the model gateway, the policy engine, or the deterministic coordinator — those are CommitOS-side and already specced in `02-TECHNICAL-SPEC.md` / `03-AGENT-ARCHITECTURE.md`.
- v1 does not build live ERP/API integrations. Data enters Novel only via file upload (see §6).
- v1 does not build a general-purpose chatbot. The in-app "chat" is scoped strictly to explaining/re-negotiating one case (see §9).
- No multi-industry Commitment Pack configuration UI in v1 — Novel ships hardwired to the one distributor/manufacturer quote workflow already fixtured in CommitOS.
- No pricing page, billing UI, or self-serve plan management in v1 (sales-assisted onboarding is assumed).

---

## 3. Information architecture (sitemap)

```text
/                       marketing landing page (public)
/signin                 Google One Tap + fallback button
/signup                 same screen as /signin — Google decides new vs returning
/onboarding             company details → representative details → data upload (new users only)
/app                    post-auth home: input bar, data panel, history panel
/app/data/:category     full data table + upload/re-sync for one of the 6 categories
/app/case/:id           reopened case: report + graph trace + case-scoped chat + PDF
```

Returning users who sign in via One Tap and have already completed onboarding go straight to `/app`. New users are routed through `/onboarding` exactly once.

---

## 4. Landing page — marketing site (`/`)

### 4.1 Visual system, borrowed from the reference video

The reference (a Browserbase founder-demo video) uses: a talking-head narrator cut against real product screenshots, bold flat color-block title cards, a colored "your agent" pill with an arrow-cursor pointing at exactly what the AI touched, and quadrant montages. Novel adapts the *mechanism*, not the medium — everything below is coded animation, no filmed video (per your decision).

**Fixed agent color key** (used identically on the landing page and inside the real app, so the two visually rhyme):

| Agent | Accent color (suggested hue) |
|---|---|
| Sales | Amber |
| Finance | Rose/red |
| Inventory | Blue |
| Procurement | Purple |
| Logistics | Teal |
| Risk | Slate/black (the skeptic — deliberately desaturated) |

Typography: one bold grotesque sans (e.g. Inter or Geist) at heavy weight for headlines and labels, regular weight for body. No gradients, no glassmorphism, no stock photography. Background is a single off-white/near-black depending on theme; color only appears as accents and agent pills.

### 4.2 Nav

Logo wordmark (left) · `Product` `How it works` (center-left, minimal) · `Sign in` (ghost) + `Get started` (solid, primary accent) (right). No Google One Tap here — it only appears on `/signin`, keeping the marketing page fast and free of a Google popup on load.

### 4.3 Hero

- Headline: the product-law one-liner (see §1).
- Subhead: one sentence naming the concrete outcome (e.g. "Novel checks inventory, credit, supply, and delivery before your quote goes out — and proves it.")
- Two CTAs: `Get started` (solid) → `/signup`; `See it work` (ghost) → scrolls to §4.4.
- No hero image/illustration. The hero's visual interest is the demo section directly below it.

### 4.4 The demo section (centerpiece)

**Key decision: this is not a separate marketing mockup.** It is the same reusable component that runs live in `/app` (see §8), rendered at a smaller scale in an autoplay loop over a fixed, pre-recorded sample case. Building the choreography once and reusing it here means the landing page never drifts out of sync with what the product actually does — a direct, low-cost way to keep the demo honest.

**Sequence (scroll-triggered, plays once per viewport entry, replays on re-entry):**

1. A sample query fades in above a centered input bar: *"25,000 power banks, 12% discount, Net-60, 14-day delivery."*
2. The bar rises and the text crumbles into bits (see §8.2 for the shared animation mechanics).
3. Bits drop into a single top bin labeled **Sales** (normalizing the request) — a bold flat color-block bar reading `NORMALIZING` flashes briefly, Browserbase-title-card style.
4. Four pipes fan out simultaneously to **Finance / Inventory / Procurement / Logistics** — matching the real concurrent call topology, not a fake "all six at once." Each bin lights up in its fixed accent color with a one-line verdict pill (e.g. red `FINANCE` pill: *"Net-60 rejected → 30% advance required"*), directly translating the reference's "your agent" callout.
5. A fifth pipe activates **Risk**, visibly *after* the first four resolve — reinforcing that Risk consumes their outputs rather than running blind.
6. All five converge into a **Coordinator** bin at the bottom; a `COMMITTED_AFTER_COUNTERTERM` flat color-block label stamps in.
7. A small Commit Certificate card slides out to the right, and a one-paragraph report fades in — both explicitly labeled "staged example," matching CommitOS's own rule that fixture data is never presented as real customer results.

### 4.5 Why Novel (problem framing)

3–4 short, bold cards pulled directly from the existing problem statement — fragmented authority across Sales/Finance/Inventory/etc., approvals that aren't reservations, promises made on stale evidence. No generic "AI-powered" feature grid.

### 4.6 Trust section

A static Commit Certificate example card (terms hash, required receipts, validity window, weakest assurance level) labeled staged/simulated. This does the "proof" job the reference video does with real screenshots, without needing fabricated customer logos — which the product itself explicitly forbids presenting as real.

### 4.7 Final CTA + footer

One more `Get started` CTA. Footer: wordmark, Sign in / Get started, contact, legal — nothing else.

### 4.8 Explicitly cut from the landing page

No testimonial wall, no fake logo carousel, no pricing calculator, no blog teaser, no live chat widget, no newsletter signup. Lean per your instruction.

---

## 5. Auth & onboarding

### 5.1 Sign-in (`/signin`)

- Supabase Auth using **Google One Tap only** for v1 — no email/password, no magic link. This is a deliberate KISS call: B2B buyers in this segment overwhelmingly have Google Workspace accounts, and one auth path is one less thing to build, secure, and support. (Flag: if a design-partner customer doesn't use Google Workspace, this becomes a blocking gap — worth confirming before general availability.)
- Flow: Google's One Tap floating prompt appears on page load; a "Continue with Google" button is the fallback if the prompt is dismissed or blocked. Both call Supabase's `signInWithIdToken` with the Google credential.
- Returning user (row already exists in `company_members`) → straight to `/app`. First-time user → `/onboarding`.

### 5.2 Onboarding wizard (`/onboarding`, new users only)

Three short steps, each independently skippable-and-resumable except step 1:

1. **Company details** — company name, industry (single dropdown; maps to a future Commitment Pack, hardwired to one value for v1), size band, GSTIN/tax ID (optional), address.
2. **Representative details** — full name and photo pre-filled from the Google profile, editable; job title/role; phone (optional).
3. **Data upload** — the six category upload cards from §6, each with a `Skip for now` option so onboarding never blocks on having all six files ready on day one; anything skipped is finishable later from `/app/data/:category`.

Step 3 completing (or being skipped entirely) routes into `/app`.

---

## 6. Data ingestion (v1: file upload only)

**Why file upload and not live ERP sync for v1:** CommitOS already models exactly this tradeoff as an *assurance level* — `hard_hold` / `source_approval` / `human_attestation` / `snapshot_observation` — and an *adapter mode* — native / API / event / file / human. An uploaded file is a `snapshot_observation` via a `file` adapter. Shipping that first is honest (the UI says plainly how fresh the data is) and fast; a live ERP connection becomes a `source_approval`/`hard_hold` adapter later without changing the underlying data model — just adding a new adapter type against the same tables.

**The six categories map 1:1 to the six agent domains:** Sales, Finance, Inventory, Procurement, Logistics, Risk.

Per category:
- Accepted formats: CSV/XLSX for tabular data (inventory positions, credit terms, supplier price lists); PDF for document-shaped evidence (supplier contracts, policy documents feeding Risk).
- Upload → preview table → a simple column-to-canonical-field mapper (user matches their column headers to Novel's expected fields) → confirm.
- Every category card shows a freshness label (`Snapshot · synced 2h ago`) and a `Re-sync` action (re-upload to replace). Data older than a configurable threshold shows a visible staleness badge. (v1: warning only, not a hard block on running a case — hard-blocking on staleness is a natural P1 once the pattern is validated, matching CommitOS's own "missing evidence fails closed" invariant.)
- Each stored record set carries a `source_adapter: file_upload` tag — a single field, not a speculative framework, that lets a future API/event adapter slot in against the same schema without a breaking migration.

This whole section lives at `/app/data/:category`, reachable both from onboarding and from the persistent left panel in `/app` (§7).

---

## 7. Core app shell (`/app`, post-auth home)

Three-column layout:

**Left panel** (narrow, ~300px), split top/bottom:
- **Top half — "Your data":** six rows, one per agent category, each showing an icon, freshness label, and record count; click opens `/app/data/:category`.
- **Bottom half — "History":** reverse-chronological list of past cases. Each row: short query text, timestamp, and a terminal-state chip (`committed` / `cannot_commit` / `repaired` / `escalated` — the real CommitOS terminal states, never a vague "recommendation ready"). Clicking reopens `/app/case/:id`.

**Center:** on first-ever visit, the input bar sits vertically centered — this is the "empty state." Once any query has been submitted (in this session or historically), the bar relocates to a persistent composer position near the **bottom** of the screen — a standard chat-composer convention that also happens to satisfy your "raises from the bottom" animation cue, since every subsequent submission genuinely does rise from the bottom to the center on submit (see §8).

**Right panel:** collapsed by default; slides open when a case produces a report/PDF, or when reopening a past case from history.

---

## 8. The query lifecycle animation

This is the centerpiece interaction and deserves the most precision. It is driven by real backend events, not a canned timeline — see §8.4.

### 8.1 Trigger

User types into the composer and presses Enter (or taps send). The bar is disabled for further edits and enters the animation sequence below.

### 8.2 Animation beats

| Stage | Visual | Backing state |
|---|---|---|
| 1. Rise | The composer bar animates from its bottom-docked position to a mid-upper "processing" position (spring easing, ~400ms) | client-only, purely presentational |
| 2. Crumble | The query text fragments into small token/word chips that scatter and fall (particle-burst) | client-only |
| 3. Intake | Chips fall into a single top bin labeled **Sales**; bin pulses while normalizing | `case_event` row: `event_type = sales.normalized` |
| 4. Fan-out (1→4) | Curved pipe paths extend from the Sales bin to four bins — **Finance, Inventory, Procurement, Logistics** — laid out below it; particles travel along the pipes, all four animating together | `case_event` rows: `event_type = agent.started, role = {finance,inventory,procurement,logistics}` |
| 5. Per-agent processing | Each of the four bins glows in its fixed accent color with a soft loading pulse and a one-line status pulled from that role's decision payload once available | `domain_decision` insert per role |
| 6. Risk (5th pipe) | A fifth pipe activates from Sales to **Risk**, visibly after step 5 resolves — Risk is drawn as consuming the other four's outputs, not running blind | `case_event`: `event_type = agent.started, role = risk`, gated on the four prior `domain_decision` rows existing |
| 7. Convergence (6→1) | All five agents' outputs travel back along the pipes into a **Coordinator** bin; the bin pulses through a short checklist tick animation reflecting the real invariants being verified (dependency coverage, terms-hash match, expiry) | `commit_certificate` row transitioning `draft → valid`, or a `cannot_commit`/counteroffer path |
| 8. Output | The Coordinator bin emits two things at once: a PDF icon that flies to and docks in the right panel (expanding into a real embedded viewer), and a text report that streams into the center (fade-in per line) | `commit_certificate` finalized / `counteroffer` created |
| 9. Settle | The graph minimizes into a small "View reasoning trace" toggle (not destroyed — the full graph, every `domain_decision`, and every receipt stay reachable, since you explicitly want to interrogate the reasoning afterward); the composer re-docks at the bottom for follow-ups | — |

### 8.3 The focus/zoom mechanic ("scroll" feel)

Rather than a static diagram, the graph lives on one logical canvas where a single `focusedNodeId` state value drives everything: whichever node is currently doing work animates to the visual center at full scale (a soft spotlight/scale-up), while every other node shrinks and drifts toward the periphery. This is implemented as one reusable primitive (spring-animated `scale` + `translate`, e.g. via Framer Motion) applied uniformly at every stage — intake, each of the five agent runs, and the coordinator — which is what produces the "camera pans to whatever matters right now" feel you described, without hand-authoring a bespoke animation per stage.

### 8.4 Latency masking — animation is decoupled from real backend timing

Each stage has a **minimum display duration** (e.g. 600–900ms) so the sequence stays legible even when the real agent responds in 50ms, and each in-progress bin has an **idle-loop pulse** it can sustain indefinitely if real latency runs long, rather than looking stuck or broken. Concretely: the animation state machine advances on whichever comes later — the minimum-duration timer or the real `case_event`/`domain_decision` row arriving — so a fast backend never feels rushed and a slow one never feels frozen.

**How the frontend actually knows a stage completed, without any new streaming backend:** CommitOS already has a `case_event` table with a per-case `sequence` column, written by the coordinator as the single source of the evidence timeline. Novel's frontend subscribes directly to Postgres changes on that table via Supabase Realtime (`supabase.channel(...).on('postgres_changes', { table: 'case_event', filter: 'case_id=eq.<id>' }, ...)`), filtered to the open case, and maps each incoming `event_type` to the animation stage table in §8.2. This needs zero custom streaming infrastructure — it's a direct, honest read of the real evidence timeline, which is also exactly what makes the later "why did Finance reject Net-60?" chat trustworthy (§9): the UI and the chat are reading the same rows.

### 8.5 Accessibility

Respects `prefers-reduced-motion`: particle/crumble/zoom effects are replaced by a plain sequential fade-through of the same stage labels, with no scale/translate motion. The terminal-state chip and report text render identically either way.

---

## 9. Report & case-scoped chat (`/app/case/:id`)

Once a case resolves, the right panel holds the PDF viewer; below or beside it, a chat box scoped strictly to that case.

- The chat answers from already-computed evidence — each `domain_decision.payload`, `evidence_refs`, and the certificate's receipts — via retrieval over that case's rows, **not** a fresh open-ended LLM conversation. This is a direct extension of the "explanations are a rendering of independent decisions, not an execution channel" rule already locked in the agent architecture.
- If a user's message is actually a new counterterm request (e.g., "what if we do a 20% advance instead?"), the backend creates a new `terms_version` and reruns only the roles the changed fields affect (Finance and Risk for a payment-terms change, per the existing rerun rules) — the chat is allowed to trigger a real, bounded re-run, but it never invents an answer the coordinator hasn't verified. The UI represents this by replaying the §8 animation for just the affected agents, not the full six.

---

## 10. Data model — reuse, don't reinvent

Novel's Postgres schema for cases **is** the CommitOS schema from `04-DATA-AND-STATE-SPEC.md`: `deal_case`, `terms_version`, `domain_decision`, `reservation`, `commit_certificate`, `action_receipt`, `case_event`, `counteroffer`. This is the single most important coordination point with the agent-backend team — Novel's frontend and the CommitOS orchestration engine must agree on this one schema as the integration contract, not maintain two.

Tables Novel additionally owns (not present in CommitOS's spec, needed for the website itself):

```yaml
company:
  id: uuid
  name: string
  industry: string
  size_band: string
  tax_id: string | null
  address: jsonb
  created_at: timestamp

company_member:
  id: uuid
  company_id: uuid
  auth_user_id: uuid        # Supabase auth.users.id
  full_name: string
  title: string
  phone: string | null
  created_at: timestamp

data_category_source:
  id: uuid
  company_id: uuid
  category: sales | finance | inventory | procurement | logistics | risk
  source_adapter: file_upload            # api_pull, event_stream reserved for later
  storage_ref: string                     # Supabase Storage path
  column_mapping: jsonb
  synced_at: timestamp
  record_count: integer
```

`deal_case.company_id` scopes every case to the authenticated company (Row Level Security on all tables, keyed off `company_id`, matching CommitOS's own "company and user IDs scope every query" rule).

---

## 11. Endpoints Novel owns vs. the backend already owns

**Owned by the CommitOS backend (per `02-TECHNICAL-SPEC.md`), Novel only calls these:**
- Case API: create/read a case, submit a buyer response, read chronological state — already specified.
- The deterministic workflow, model gateway, and reservation coordinator are entirely backend-internal.

**New surface this spec introduces (Novel-owned, needs backend team agreement):**

```text
Auth / onboarding
  POST   /api/companies
  PATCH  /api/companies/:id
  POST   /api/companies/:id/members
  GET    /api/onboarding/status

Data ingestion
  GET    /api/data/categories
  POST   /api/data/:category/upload
  GET    /api/data/:category/preview
  POST   /api/data/:category/mapping
  POST   /api/data/:category/resync
  GET    /api/data/:category/records

Case UI convenience layer (thin wrappers over the backend Case API)
  GET    /api/cases                       # history list for the left panel
  GET    /api/cases/:id/certificate.pdf   # rendered PDF of the certificate + report
  POST   /api/cases/:id/messages          # case-scoped chat (§9)

Live animation feed
  (no custom endpoint — direct Supabase Realtime subscription on `case_event`,
   see §8.4)
```

**Open question to settle with the backend team before build:** whether the raw free-text query the user types goes straight into the existing Case API's intake step (the Sales role already normalizes unstructured input, per `03-AGENT-ARCHITECTURE.md`) or whether Novel should run a separate lightweight parse first. Recommendation: don't duplicate — let Sales's existing normalization be the one parsing step. If a cheap pre-classifier is still wanted, scope it narrowly to "is this a new case or a follow-up on an open one," not a second full parse of the request.

---

## 12. Tech stack recommendation

- **Framework:** Next.js (TypeScript) — matches the stack already chosen for CommitOS's operator app in `02-TECHNICAL-SPEC.md`, so the two can plausibly share the same repo/deploy target if that's ever useful.
- **Auth/DB:** Supabase (Postgres + Auth + Storage + Realtime) — already the locked choice.
- **Styling/components:** Tailwind CSS + a headless component set (e.g. shadcn/ui) for form/table primitives; hand-built for the animation-heavy pieces (§8).
- **Animation:** Framer Motion for the spring/scale/translate primitives in §8.3; a lightweight canvas or CSS-particle approach for the crumble effect in §8.2 — no need for a full WebGL/game-engine dependency for this.
- **PDF generation:** server-side rendering of the certificate + report into PDF (e.g. via a Node PDF library), triggered once the coordinator marks a certificate `valid`/`consumed`.

---

## 13. Build phasing

Even though this is the real product (not the hackathon slice), it still ships in phases so each is independently testable:

1. **Landing page** — static, no auth required. Ships and iterates independently of everything else.
2. **Auth + onboarding** — Google One Tap, company/rep capture, skippable data-upload step.
3. **Data ingestion** — full upload/preview/mapping/resync flow for all six categories.
4. **App shell** — left panel (data + history), empty-state input bar, no animation yet (a case just spins and then shows a plain result) — proves the Case API integration end-to-end before investing in animation polish.
5. **Query lifecycle animation** — layer §8 on top of the working plain version once the real `case_event`/`domain_decision` feed is reliable.
6. **Case chat + counterterm re-run** — §9, last, since it depends on everything above being stable.

---

## 14. Risks / things to confirm before implementation

- Google-One-Tap-only auth is a real constraint if a target customer isn't on Google Workspace — worth a go/no-go check with whoever is running early sales conversations.
- The `case_event` → Supabase Realtime approach for driving live animation assumes the backend team writes granular, per-stage events (not just a final result row). This needs explicit agreement — it's the one piece of this spec that adds a requirement onto the backend beyond what `04-DATA-AND-STATE-SPEC.md` currently promises.
- Column-mapping UX for file uploads (§6) is described at the level of "what it does," not exact field lists per category — those canonical field lists should come from whoever owns the Commitment Pack / policy definitions, so Novel's mapper matches what the agents actually read.
