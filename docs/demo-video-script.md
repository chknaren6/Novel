# Novel — 3-minute demo video script

**Target length:** 3:00. **Format:** local screen recording, three browser tabs, voiceover live or dubbed after. Covers both real flows: the B2C Marketplace and the B2B Commitment Desk.

## Before you record

1. **Recording mode for reliability:** run the Commitment Desk half with `DESK_MODEL_MODE=demo npm run dev` — same real backend/UI code, but the six-role reveal uses honest, test-verified scripted answers instead of a live LLM call, so timing in this script is exact and repeatable. If your `OPENAI_API_KEY` is working by record day, you can run live instead — just expect the six-role wait to vary a few seconds and adjust the cut points in **1:35–2:35** accordingly.
2. Reseed clean demo data right before recording so case IDs/status are fresh: `npm run seed:b2c-demo` and `npm run seed:b2b-demo`.
3. Log in once before recording so the login screen doesn't eat runtime (auth only gates the app when Supabase env vars are set — skip if they're not).
4. Have three browser tabs positioned:
   - **Tab A** — `/market` (B2C operator view)
   - **Tab B** — ready to paste the B2C buyer link
   - **Tab C** — `/desk` (B2B Commitment Desk)
5. Do one full dry run first. The B2C negotiation brief is a real LLM call even in demo mode (only the desk's six roles are scripted) — its timing will vary a few seconds run to run.

---

## Script

**[0:00–0:15] Hook**
Screen: title card / pitch deck opening slide — "Novel — Never promise what you have not reserved."
> "Every business promise made before the facts agree becomes a fire drill. Novel is an agentic commitment layer for B2B trade — it won't let you promise something until it's actually been reserved. I'll show you both sides of it: buyers finding suppliers, and a company's own ERP data running through a six-agent check."

**[0:15–0:25] B2C setup**
Screen: Tab A, `/market`, empty composer.
> "First, the marketplace. A buyer just tells us what they need — no forms, no dropdowns."

**[0:25–0:40] Intake → candidates**
Action: type the request (e.g. *"Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore"*), type the seeded SKU, click **Find suppliers**; ranked list appears.
> "Novel parses that, checks it against the live supplier network, and ranks who can actually fulfill it — today, not eventually." *(click Choose on one)*

**[0:40–0:55] Negotiation brief**
Screen: brief appears — market note, opening price, walk-away price, levers.
> "Before I talk to the supplier, an AI-prepared brief gives me the market range and a walk-away price. It doesn't negotiate for me — it makes sure I walk in prepared."

**[0:55–1:10] Confirm, send, and commit**
Action: enter negotiated price and buyer details, click **Confirm and send**; switch to Tab B, paste the buyer link, click **Accept**; cut back to Tab A updating live to "committed" with no refresh.
> "I send a secure buyer link — no account needed on their end. They accept, and back on my side the case updates to committed on its own. That's a real Commit Certificate: the supplier commits first, the certificate is the last thing created, not the first."

**[1:10–1:20] Turn to B2B**
Screen: cut to Tab C, `/desk` inbox — three pending cases listed.
> "That's the buyer-facing half. The other half is the Commitment Desk — the same discipline applied inside one company's own ERP data."

**[1:20–1:35] Open a case**
Action: click into the "committed"-bound case (Sundara Electricals / Aravali Electricals).
> "Every pending deal sits here. I open one, and instead of a person manually checking credit, stock, suppliers, and freight, six agents do it — in parallel — before anything is promised."

**[1:35–2:05] The six-role run**
Action: click **Check and commit**; diagram view plays: Sales reads the request, then Finance / Inventory / Procurement / Logistics run together, then Risk, then the Coordinator; hover one or two nodes to show the tooltip reasoning.
> "Sales normalizes the request. Then finance, inventory, procurement, and logistics check in parallel — each one holds a real reservation, not just an opinion. Risk reviews everyone's evidence last. Nothing here is a status I can fake — hover any box and you see exactly why it decided what it decided, straight from that role's own record."

**[2:05–2:15] Certificate issued**
Screen: settled state — "Committed — certificate issued," certificate id visible.
> "Six for six — a certificate is issued, the same kind of dated, backed promise as the marketplace side."

**[2:15–2:40] The other two outcomes**
Action: back to inbox, open the "negotiating" case, run it — show the finance counterterm and buyer link; back to inbox, open the "cannot_commit" case, run it — show the real failure reason.
> "Not every deal clears cleanly. Here, finance counters with a 30% advance instead of a straight veto — Novel sends that back as a real counteroffer with its own buyer link. And here, there's simply no supplier coverage for the shortfall — Novel says so plainly instead of promising a date it can't hold."

**[2:40–2:50] Same protocol, one product**
Screen: split or quick cut between the market page and the desk diagram.
> "Two very different-looking screens, buyers on one side, a company's own operators on the other — running on the exact same rule: nothing is promised until it's actually reserved."

**[2:50–3:00] Close**
Screen: hold on the desk's committed state, or cut to the deck's closing slide.
> "One commitment layer. Real holds, real certificates, real no's when the answer is no. That's Novel."

---

## Cut list if you're over time

Trim in this order — each cut loses the least narrative weight first:
1. Drop the tooltip hover beat in **1:35–2:05** (saves ~5s).
2. Cut the cannot_commit case in **2:15–2:40**, keep only negotiating (saves ~10s).
3. Merge **2:40–2:50** into the close line (saves ~10s).
