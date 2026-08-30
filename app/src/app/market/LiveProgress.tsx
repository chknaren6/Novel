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
