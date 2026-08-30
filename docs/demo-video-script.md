# Novel demo video script

**Target length:** ~2:35. **Format:** screen recording of the `/market` flow in two browser tabs (operator + buyer), with voiceover recorded live or dubbed after.

## Before you record

1. Seed one `SupplierOption` row for the SKU you'll type in the demo (e.g. via Prisma Studio: `supplierId: "VEND-A"`, `sku: "SKU-COPPER-4MM"`, `availableQuantity: 1000`, `unitCostMinor: 10000`, `leadDays: 10`, `optionTtlSeconds: 900`, `status: "available"`).
2. Set real env vars (`OPENAI_API_KEY`, `OPENAI_MODEL_ID`, `BUYER_LINK_SIGNING_SECRET`, `APP_BASE_URL`, `DATABASE_URL`/Supabase vars) and confirm `npm run dev` boots clean.
3. Log in as the operator once before recording so the login screen doesn't eat runtime (or record it — see the optional cold-open below).
4. Have two browser windows/tabs positioned: **Tab A** = operator `/market`, **Tab B** = ready to paste the buyer link.
5. Do one full dry run first. The negotiation-brief call is a real LLM request — timing will vary a few seconds run to run.

---

## Script

**[0:00–0:10] Hook**
Screen: title card or the pitch deck's opening slide (Novel / "Never promise what you have not reserved.")
> "Every business promise made before the facts agree becomes a fire drill. Novel makes sure that never happens — starting with how buyers and suppliers actually make deals."

**[0:10–0:20] Setup**
Screen: Tab A, `/market`, empty composer.
> "This is Novel's B2C marketplace. A buyer just tells us what they need — no forms, no dropdowns."

**[0:20–0:35] Intake**
Action: type into the raw-request box — *"Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore"* — type the SKU you seeded, click **Find suppliers**.
> "I paste the requirement, give it a SKU, and Novel parses it and checks it against the live supplier network in real time."

**[0:35–0:50] Candidates**
Screen: ranked supplier list appears.
> "Here are the real suppliers who can fulfill this order today, ranked by cost and lead time." *(click Choose on one)*

**[0:50–1:10] Negotiation brief**
Screen: brief appears — market note, suggested opening price, walk-away price, levers.
> "Before I ever talk to the supplier, an AI-prepared negotiation brief gives me the market range, a suggested opening price, a walk-away price, and real levers to use. The AI doesn't negotiate on its own — it makes sure I walk in prepared."

**[1:10–1:30] Confirm and send**
Action: enter the negotiated price, buyer name and phone, click **Confirm and send quote to buyer**.
> "I enter the price I actually negotiated and the buyer's details. Novel generates a secure, signed link for the buyer — no account needed on their end."

**[1:30–1:45] Live progress**
Screen: the progress view — "awaiting_buyer_response", sell price, buyer link.
> "And now I watch it live. This is polling the real backend — not a demo timer."

**[1:45–2:05] Buyer accepts**
Action: switch to Tab B, paste the buyer link, click **Accept**.
> "In a second tab, that's the buyer's link. They review the quote and accept."

**[2:05–2:20] Committed**
Action: switch back to Tab A — without refreshing — and let it update to "committed" on its own.
> "Back on my side, without touching refresh, the case updates to committed. That's a real Commit Certificate, backed by an actual supplier commitment — not a status flag someone can fake."

**[2:20–2:35] Close**
Screen: hold on the committed state, or cut to the deck's closing slide.
> "One promise, dated and certified. The supplier commits first — the certificate is the last thing created, not the first. That's Novel."

---

## Optional: B2B mention (10s add-on, if you want judges to know it's bigger than one flow)

Insert after the hook, before "Setup":
> "The same protocol runs a second flow today: a six-agent commitment desk that evaluates a company's own ERP data and returns a certificate, a counteroffer, or a clean no-commit. That one's screen isn't public yet — this demo is the buyer-facing half."

Only use this line if the B2B backend is something you're prepared to speak to if asked — it's real and tested, but has no UI in this build yet.
