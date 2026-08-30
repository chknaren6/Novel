"use client";

import { useEffect, useState } from "react";
import { INK, SUB, MUTE, LINE, OK, WARN, BAD, SANS, SERIF, MONO } from "@/app/market/styles";
import type { DeskStage, RoleDecision, RoleStatus } from "@/workflow/deriveDeskState";

type SubmitResult =
  | { status: "committed"; certificateId: string; receipts: unknown; depositMinor: number }
  | { status: "escalated"; reason: string; [key: string]: unknown }
  | { status: "negotiating"; counterofferId: string; buyerToken: string; salesExplanation: string }
  | { status: "cannot_commit"; reason: string };

type DeskViewState = {
  stage: DeskStage;
  label: string;
  roles: RoleStatus[];
  certificateId: string | null;
  reason: string | null;
  counterofferTerms: { paymentTerms: string; totalValueMinor: number } | null;
};

const TERMINAL_STAGES = new Set<DeskStage>(["committed", "cannot_commit", "escalated"]);

const DECISION_COLOR: Record<RoleDecision, string> = {
  approve: OK,
  counter: WARN,
  veto: BAD,
  unavailable: MUTE,
  pending: MUTE,
};

const DECISION_LABEL: Record<RoleDecision, string> = {
  approve: "Approve",
  counter: "Counter",
  veto: "Veto",
  unavailable: "Unavailable",
  pending: "Waiting…",
};

const label = { font: `400 10.5px ${MONO}`, letterSpacing: ".14em", color: MUTE, textTransform: "uppercase" as const };

function formatMinor(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

export function DeskCase({
  caseId,
  customerName,
  companyName,
  sku,
  quantity,
  totalValueMinor,
  paymentTerms,
  onBack,
}: {
  caseId: string;
  customerName: string;
  companyName: string;
  sku: string;
  quantity: number;
  totalValueMinor: number;
  paymentTerms: string;
  onBack: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [buyerLink, setBuyerLink] = useState<string | null>(null);
  const [state, setState] = useState<DeskViewState | null>(null);

  const submitted = result !== null;

  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    async function poll() {
      const res = await fetch(`/api/b2b/cases/${caseId}`);
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
  }, [caseId, submitted, state?.stage]);

  async function runEvaluation() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/b2b/cases/${caseId}/submit`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not run this evaluation.");
      const r: SubmitResult = body.result;
      if (r.status === "negotiating") {
        setBuyerLink(`${window.location.origin}/desk/${caseId}/respond?token=${encodeURIComponent(r.buyerToken)}`);
      }
      setResult(r);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "42px 40px" }}>
      <h2 style={{ font: `500 30px/1.2 ${SERIF}`, letterSpacing: "-.012em", margin: 0, color: INK }}>{companyName}</h2>
      <p style={{ font: `400 15px/1.6 ${SANS}`, color: SUB, margin: "10px 0 0" }}>{customerName}</p>

      <div style={{ display: "flex", gap: 32, marginTop: 20, flexWrap: "wrap" }}>
        <div>
          <div style={label}>SKU</div>
          <div style={{ font: `400 15px ${SANS}`, marginTop: 6, color: INK }}>{sku}</div>
        </div>
        <div>
          <div style={label}>Quantity</div>
          <div style={{ font: `400 15px ${SANS}`, marginTop: 6, color: INK }}>{quantity}</div>
        </div>
        <div>
          <div style={label}>Total value</div>
          <div style={{ font: `500 15px ${MONO}`, marginTop: 6, color: INK }}>{formatMinor(totalValueMinor)}</div>
        </div>
        <div>
          <div style={label}>Payment terms</div>
          <div style={{ font: `400 15px ${SANS}`, marginTop: 6, color: INK }}>{paymentTerms}</div>
        </div>
      </div>

      {submitError && (
        <div style={{ marginTop: 20, padding: "12px 16px", border: `1px solid ${LINE}`, borderRadius: 8, color: BAD, font: `400 14px ${SANS}` }}>
          {submitError}
        </div>
      )}

      {!submitted && (
        <button
          disabled={submitting}
          onClick={runEvaluation}
          style={{ marginTop: 24, font: `500 14px ${SANS}`, color: "#fff", background: INK, border: "none", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}
        >
          {submitting ? "Running evaluation…" : "Run evaluation"}
        </button>
      )}

      {submitted && (
        <>
          <div style={{ marginTop: 28, padding: "20px 0", borderTop: `1px solid ${LINE}` }}>
            <div style={label}>Six-role checklist</div>
            <div style={{ marginTop: 12 }}>
              {(state?.roles ?? []).map((role) => (
                <div key={role.role} style={{ padding: "12px 0", borderBottom: "1px solid #EDEAE1" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        font: `600 11px ${MONO}`,
                        letterSpacing: ".06em",
                        textTransform: "uppercase" as const,
                        color: "#fff",
                        background: DECISION_COLOR[role.decision],
                        borderRadius: 5,
                        padding: "3px 8px",
                        opacity: role.decision === "pending" ? 0.55 : 1,
                        border: role.decision === "pending" ? `1px dashed ${MUTE}` : "none",
                      }}
                    >
                      {DECISION_LABEL[role.decision]}
                    </span>
                    <span style={{ font: `500 15px ${SANS}`, color: INK, textTransform: "capitalize" as const }}>{role.role}</span>
                  </div>
                  {role.explanation && (
                    <p style={{ font: `400 13.5px/1.6 ${SANS}`, color: SUB, marginTop: 6 }}>{role.explanation}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {state?.stage === "committed" && (
            <div style={{ marginTop: 24, padding: "16px", border: `1px solid ${OK}`, borderRadius: 8 }}>
              <div style={{ font: `600 14px ${SANS}`, color: OK }}>Committed — certificate issued.</div>
              {state.certificateId && (
                <div style={{ font: `400 13px ${MONO}`, color: SUB, marginTop: 8, wordBreak: "break-all" }}>{state.certificateId}</div>
              )}
            </div>
          )}

          {(state?.stage === "cannot_commit" || state?.stage === "escalated") && (
            <div style={{ marginTop: 24, padding: "16px", border: `1px solid ${BAD}`, borderRadius: 8 }}>
              <div style={{ font: `600 14px ${SANS}`, color: BAD }}>This needs your attention</div>
              <p style={{ font: `400 14px/1.6 ${SANS}`, color: SUB, marginTop: 6 }}>{state.reason}</p>
            </div>
          )}

          {state?.stage === "negotiating" && (
            <div style={{ marginTop: 24, padding: "16px 0", borderTop: `1px solid ${LINE}` }}>
              <div style={{ font: `600 14px ${SANS}`, color: INK }}>Counteroffer sent</div>
              {state.counterofferTerms && (
                <div style={{ display: "flex", gap: 32, marginTop: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={label}>Payment terms</div>
                    <div style={{ font: `400 15px ${SANS}`, marginTop: 6, color: INK }}>{state.counterofferTerms.paymentTerms}</div>
                  </div>
                  <div>
                    <div style={label}>Total value</div>
                    <div style={{ font: `500 15px ${MONO}`, marginTop: 6, color: INK }}>{formatMinor(state.counterofferTerms.totalValueMinor)}</div>
                  </div>
                </div>
              )}
              {buyerLink ? (
                <div style={{ marginTop: 20 }}>
                  <div style={{ font: `400 11px ${MONO}`, letterSpacing: ".16em", color: MUTE }}>BUYER LINK</div>
                  <div style={{ font: `400 13px ${MONO}`, color: SUB, marginTop: 8, wordBreak: "break-all" }}>{buyerLink}</div>
                  <p style={{ font: `400 13.5px/1.6 ${SANS}`, color: SUB, marginTop: 8 }}>Send this to the customer to accept or decline.</p>
                </div>
              ) : (
                <p style={{ font: `400 14px/1.6 ${SANS}`, color: SUB, marginTop: 12 }}>A counteroffer is pending the customer&apos;s response.</p>
              )}
            </div>
          )}
        </>
      )}

      <button
        onClick={onBack}
        style={{ marginTop: 28, font: `500 13.5px ${SANS}`, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 18px", cursor: "pointer" }}
      >
        Back to inbox
      </button>
    </div>
  );
}
