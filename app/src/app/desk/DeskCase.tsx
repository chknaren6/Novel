"use client";

import { useEffect, useRef, useState } from "react";
import { INK, SUB, MUTE, LINE, OK, BAD, SANS, SERIF, MONO } from "@/app/market/styles";
import type { DeskStage, RoleStatus } from "@/workflow/deriveDeskState";
import { SixDots } from "./SixDots";
import { DeskDiagram } from "./DeskDiagram";
import { DeskChecklist } from "./DeskChecklist";
import { buildDiagramNodes, buildPipeStates, buildDots, REVEAL_STEPS, type OutcomeKind } from "./deskDiagramData";

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

const OUTCOME_KIND: Partial<Record<DeskStage, OutcomeKind>> = { committed: "ok", negotiating: "warn", cannot_commit: "bad", escalated: "bad" };

const label = { font: `400 10.5px ${MONO}`, letterSpacing: ".14em", color: MUTE, textTransform: "uppercase" as const };

function formatMinor(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

function coordinatorWhy(state: DeskViewState): string {
  if (state.stage === "committed") return "Every required domain had a matching hold; a certificate was issued.";
  if (state.stage === "negotiating") return "Every domain but credit was covered — sent back with a revised payment term.";
  if (state.stage === "cannot_commit" || state.stage === "escalated") return `Could not commit: ${state.reason ?? "unknown reason"}.`;
  return "Verifying every hold is in place…";
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
  const [finalState, setFinalState] = useState<DeskViewState | null>(null);
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [view, setView] = useState<"diagram" | "list">("diagram");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submitted = result !== null;

  // Plays the reveal animation over already-final, already-confirmed data (finalState),
  // pacing disclosure rather than simulating anything the backend hasn't actually
  // decided — see deskDiagramData.ts's own comment on REVEAL_STEPS.
  useEffect(() => {
    if (!finalState) return;
    const step = REVEAL_STEPS[revealedSteps];
    if (!step) return;
    timerRef.current = setTimeout(() => setRevealedSteps((s) => s + 1), step.delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [finalState, revealedSteps]);

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

      // The submit response doesn't carry the six-role decisions — fetch the case's
      // real, already-persisted state once so the reveal animation has real content to
      // pace out, rather than enriching SubmitResult's shape just for this.
      const stateRes = await fetch(`/api/b2b/cases/${caseId}`);
      if (stateRes.ok) {
        const stateBody = await stateRes.json();
        setFinalState(stateBody.state);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const outcomeKind = finalState ? OUTCOME_KIND[finalState.stage] ?? null : null;
  const settled = revealedSteps >= REVEAL_STEPS.length;
  const nodes = finalState ? buildDiagramNodes(finalState.roles, revealedSteps, outcomeKind, coordinatorWhy(finalState), finalState.certificateId) : [];
  const pipes = buildPipeStates(revealedSteps);
  const dots = finalState ? buildDots(finalState.roles, revealedSteps) : [];

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "42px 40px" }}>
      <h2 style={{ font: `500 30px/1.2 ${SERIF}`, letterSpacing: "-.012em", margin: 0, color: INK }}>{companyName}</h2>
      <p style={{ font: `400 15px/1.6 ${SANS}`, color: SUB, margin: "10px 0 0" }}>{customerName}</p>

      <div style={{ display: "flex", gap: 32, marginTop: 20, flexWrap: "wrap", borderBottom: `1px solid ${LINE}`, paddingBottom: 20 }}>
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
          {submitting ? "Running evaluation…" : "Check and commit"}
        </button>
      )}

      {submitted && (
        <>
          <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 16 }}>
            <SixDots dots={dots} />
            <span style={{ font: `400 13.5px ${SANS}`, color: SUB }}>
              {!finalState
                ? "Six-role evaluation in progress."
                : settled
                  ? "All six checked · answer ready"
                  : `${dots.filter((d) => !d.pulsing && d.color !== "#D8D5C9").length} of six answered`}
            </span>
          </div>

          <div style={{ marginTop: 24, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={label}>The six checks</div>
            <div style={{ display: "flex", gap: 16 }}>
              <button
                onClick={() => setView("diagram")}
                style={{ font: `500 13px ${SANS}`, background: "none", border: "none", padding: 0, cursor: "pointer", color: view === "diagram" ? INK : MUTE, borderBottom: view === "diagram" ? `2px solid ${INK}` : "2px solid transparent" }}
              >
                Diagram
              </button>
              <button
                onClick={() => setView("list")}
                style={{ font: `500 13px ${SANS}`, background: "none", border: "none", padding: 0, cursor: "pointer", color: view === "list" ? INK : MUTE, borderBottom: view === "list" ? `2px solid ${INK}` : "2px solid transparent" }}
              >
                List
              </button>
            </div>
          </div>
          <p style={{ font: `400 12.5px ${SANS}`, color: MUTE, margin: "6px 0 0" }}>{view === "diagram" ? "Hover a box for the reasoning." : ""}</p>

          {finalState && view === "diagram" && <DeskDiagram nodes={nodes} pipes={pipes} />}
          {finalState && view === "list" && <DeskChecklist nodes={nodes} />}

          {settled && finalState?.stage === "committed" && (
            <div style={{ marginTop: 24, padding: "16px", border: `1px solid ${OK}`, borderRadius: 8 }}>
              <div style={{ font: `600 14px ${SANS}`, color: OK }}>Committed — certificate issued.</div>
              {finalState.certificateId && (
                <div style={{ font: `400 13px ${MONO}`, color: SUB, marginTop: 8, wordBreak: "break-all" }}>{finalState.certificateId}</div>
              )}
            </div>
          )}

          {settled && (finalState?.stage === "cannot_commit" || finalState?.stage === "escalated") && (
            <div style={{ marginTop: 24, padding: "16px", border: `1px solid ${BAD}`, borderRadius: 8 }}>
              <div style={{ font: `600 14px ${SANS}`, color: BAD }}>This needs your attention</div>
              <p style={{ font: `400 14px/1.6 ${SANS}`, color: SUB, marginTop: 6 }}>{finalState.reason}</p>
            </div>
          )}

          {settled && finalState?.stage === "negotiating" && (
            <div style={{ marginTop: 24, padding: "16px 0", borderTop: `1px solid ${LINE}` }}>
              <div style={{ font: `600 14px ${SANS}`, color: INK }}>Counteroffer sent</div>
              {finalState.counterofferTerms && (
                <div style={{ display: "flex", gap: 32, marginTop: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={label}>Payment terms</div>
                    <div style={{ font: `400 15px ${SANS}`, marginTop: 6, color: INK }}>{finalState.counterofferTerms.paymentTerms}</div>
                  </div>
                  <div>
                    <div style={label}>Total value</div>
                    <div style={{ font: `500 15px ${MONO}`, marginTop: 6, color: INK }}>{formatMinor(finalState.counterofferTerms.totalValueMinor)}</div>
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
