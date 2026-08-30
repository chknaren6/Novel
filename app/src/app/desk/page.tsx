"use client";

import { useEffect, useState } from "react";
import { INK, SUB, MUTE, LINE, SANS, SERIF, MONO } from "@/app/market/styles";
import { NavBar } from "@/app/NavBar";
import { DeskCase } from "./DeskCase";

type CaseSummary = {
  caseId: string;
  customerName: string;
  companyName: string;
  sku: string;
  quantity: number;
  totalValueMinor: number;
  paymentTerms: string;
  deliveryDeadline: string;
};

const label = { font: `400 10.5px ${MONO}`, letterSpacing: ".14em", color: MUTE, textTransform: "uppercase" as const };

export default function DeskPage() {
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/b2b/cases");
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load the inbox.");
        setCases(body.cases);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = cases.find((c) => c.caseId === selectedCaseId) ?? null;

  if (selected) {
    return (
      <>
        <NavBar />
        <DeskCase
          caseId={selected.caseId}
          customerName={selected.customerName}
          companyName={selected.companyName}
          sku={selected.sku}
          quantity={selected.quantity}
          totalValueMinor={selected.totalValueMinor}
          paymentTerms={selected.paymentTerms}
          onBack={() => setSelectedCaseId(null)}
        />
      </>
    );
  }

  return (
    <>
      <NavBar />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "42px 40px" }}>
      <h2 style={{ font: `500 34px/1.2 ${SERIF}`, letterSpacing: "-.012em", margin: 0, color: INK }}>Commitment Desk</h2>
      <p style={{ font: `400 16.5px/1.75 ${SANS}`, color: SUB, margin: "14px 0 0" }}>
        Pending B2B cases waiting for evaluation. Run each through the six-role check to commit, counter, or escalate.
      </p>

      {loading && <div style={{ marginTop: 28, font: `400 15px ${SANS}`, color: SUB }}>Loading…</div>}

      {error && (
        <div style={{ marginTop: 20, padding: "12px 16px", border: `1px solid ${LINE}`, borderRadius: 8, color: "#96352C", font: `400 14px ${SANS}` }}>
          {error}
        </div>
      )}

      {!loading && !error && cases.length === 0 && (
        <div style={{ marginTop: 28, font: `400 15px ${SANS}`, color: SUB }}>No pending cases.</div>
      )}

      {!loading && cases.length > 0 && (
        <div style={{ marginTop: 28, borderTop: `1px solid ${LINE}` }}>
          {cases.map((c) => (
            <div
              key={c.caseId}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: `1px solid #EDEAE1` }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ font: `500 15px ${SANS}`, color: INK }}>{c.companyName}</div>
                <div style={{ font: `400 13px ${SANS}`, color: SUB, marginTop: 2 }}>{c.customerName}</div>
              </div>
              <div style={{ font: `400 13px ${SANS}`, color: SUB, minWidth: 120 }}>{c.sku} × {c.quantity}</div>
              <div style={{ font: `400 14px ${MONO}`, color: INK, minWidth: 100, textAlign: "right" as const }}>
                ₹{(c.totalValueMinor / 100).toFixed(2)}
              </div>
              <div style={{ font: `400 12px ${MONO}`, color: MUTE, minWidth: 90 }}>{c.paymentTerms}</div>
              <button
                onClick={() => setSelectedCaseId(c.caseId)}
                style={{ font: `500 13px ${SANS}`, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 7, padding: "7px 14px", cursor: "pointer" }}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
