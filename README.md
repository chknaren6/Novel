# Novel

**Novel is a commitment layer for B2B trade.** It won't let a promise reach a customer until every dependency behind it — credit, inventory, supply, delivery — has actually been reserved. Two products, one rule:

- **Marketplace (B2C)** — a buyer describes what they need in plain text; Novel finds real supplier candidates, prepares a negotiation brief, and only issues a commit certificate once the supplier has actually committed.
- **Commitment Desk (B2B)** — runs a company's own pending deals through six parallel role-agents (Sales, Finance, Inventory, Procurement, Logistics, Risk) and routes each one to a committed certificate, a bounded counteroffer, or an honest "cannot commit."

## Architecture

**Six logical agents, one shared runtime.** Not one omniscient agent, not six independent conversational bots — each role gets an isolated context, its own tools, and its own decision authority, run from the same underlying model:

| Role | Can | Cannot |
|---|---|---|
| Sales | Propose terms and counterterms | Hold resources, approve credit, mint a certificate |
| Finance | Approve/counter/veto credit & payment terms | Change quantity, stock, or delivery |
| Inventory | Approve/veto against current stock | Assume incoming supply |
| Procurement | Approve/counter/veto external supply coverage | Approve final margin or delivery promise |
| Logistics | Approve/counter/veto delivery dates | Create stock |
| Risk | Challenge stale/unsupported evidence, veto | Mutate any business state |

**Call order:** Sales normalizes → Finance/Inventory/Procurement/Logistics run concurrently → Risk reviews their evidence → a deterministic (non-LLM) feasibility check routes the case to `committed`, `negotiating`, or `cannot_commit`.

Agents never talk to each other in prose — they publish typed `DomainDecision` records to case state (decision, constraints, evidence refs, explanation). No conversational group chat, no fabricated consensus. A timeout produces `unavailable`, never an assumed approval; only a deterministic coordinator can ever mint or consume a certificate.

Full spec: [`Project Scope/build-specs/03-AGENT-ARCHITECTURE.md`](Project%20Scope/build-specs/03-AGENT-ARCHITECTURE.md) · product spec: [`01-PRODUCT-SPEC.md`](Project%20Scope/build-specs/01-PRODUCT-SPEC.md) · data/state model: [`04-DATA-AND-STATE-SPEC.md`](Project%20Scope/build-specs/04-DATA-AND-STATE-SPEC.md).

## Stack

Next.js (App Router) + TypeScript, Prisma/SQLite locally (Postgres via Supabase scaffolded, currently dormant), OpenAI for role reasoning, Vitest.

## Run it locally

```bash
cd app
npm install
cp .env.example .env   # fill in OPENAI_API_KEY, OPENAI_MODEL_ID, BUYER_LINK_SIGNING_SECRET
npx prisma migrate deploy
npm run seed:b2c-demo
npm run seed:b2b-demo
npm run dev
```

Open **http://localhost:3000** → redirects to `/market`. The Commitment Desk is the other tab, or go straight to `/desk`.

No working OpenAI key yet? Run the desk with `DESK_MODEL_MODE=demo npm run dev` instead — same real backend and UI, honest test-verified scripted role answers instead of a live call, for the three seeded demo cases only.

## Tests

```bash
cd app && npm test
```
