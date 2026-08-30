# Novel — mockup source & integration notes

## Files
- `Novel Workspace.dc.html` — the entire mockup: markup in the top section, all logic in the `<script>` class at the bottom. Opens directly in a browser (keep `support.js` beside it).
- `support.js` — the small runtime that renders the template. Not part of your product; replace it when you port to React/Next.

## What to port
The mockup is one component with one state object. Everything the UI shows is derived in `renderVals()` from that state — there is no hidden state and no data fetching. To integrate, replace the two timers with real events and keep the derivations.

### Commitment desk (B2B)
`state.stage` 0–8 drives the whole run:

| stage | meaning | backend event |
|---|---|---|
| 0 | composer, nothing submitted | — |
| 1 | request received | case created |
| 2 | Sales reading the request | `sales.normalized` |
| 3 | four checks running in parallel | `agent.started` × finance, inventory, procurement, logistics |
| 4 | four have answered | 4 × `domain_decision` |
| 5 | Risk reviewing | `agent.started` risk (gated on the four above) |
| 6 | coordinator verifying | coordinator checks |
| 7 | certificate issued | `commit_certificate` valid |
| 8 | answer ready | — |

- `gate()` is the fail-closed rule: the run cannot pass stage 4 until `state.attested` is true. Wire this to a real missing-evidence condition (here: no unit weight for the SKU); the modal is the only way forward, by design.
- `MODS[]` is the six checks — `status`, `line`, `why`, `evidence` per check. Replace with `domain_decision.payload`. `why` is what the diagram tooltip and the list view show; it must come from the decision record, never from a fresh model call.
- `dots` and `dotsLabel` derive from stage — the six-dot animation needs no separate feed.
- Nodes/pipes: `MODS[].x/y` and `PIPES` are the graph geometry (900×540 logical, auto-scaled by the ResizeObserver in `componentDidMount`).

### Marketplace (Phase 2, B2C)
`state.mstage` 0–7 across the three clusters: 1–3 Check agent, 4–5 Negotiate + margin, 6–7 Commit agent. `state.noMatch` switches to the no-supplier path (demand signal logged, graceful decline, no outward certificate). `spread` is derived from `mstage` + `noMatch` — it must never show a price or margin before both are agreed.

### Other state
`screen` (workspace / market / data / profile), `sel` (selected case), `view` (diagram / list), `followUp` (panel open), `guideSeen` (first-visit explainer), `sent` (negotiation closed), `vw` (viewport width → the `mob` breakpoint at 780px).

## Design rules worth keeping
1. Nothing is presented as promised until every hold exists.
2. No status is ever shown that the backend has not confirmed — labels are derived from stage, never hardcoded.
3. Every animation has a static equivalent (the list view mirrors the diagram).
4. Human intervention is a modal, not a banner, and is recorded against a named user.

## Fonts
Familjen Grotesk (UI), Source Serif 4 (display), IBM Plex Mono (IDs, timestamps) — all Google Fonts, loaded in the `<helmet>` block.
