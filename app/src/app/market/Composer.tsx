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
