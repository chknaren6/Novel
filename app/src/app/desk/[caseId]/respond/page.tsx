"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { INK, SUB, GREEN, BAD, SANS, SERIF } from "@/app/market/styles";

export default function RespondPage({ params }: { params: { caseId: string } }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [result, setResult] = useState<{ status: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function respond(response: "accept" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/b2b/cases/${params.caseId}/respond`, { method: "POST", body: JSON.stringify({ buyerToken: token, response }) });
      const body = await res.json();
      setResult(body.result);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: SUB }}>This link is missing its token.</div>;
  }

  if (result?.status === "invalid_or_expired") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: BAD }}>This link has expired or is no longer valid.</div>;
  }
  if (result?.status === "committed") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `500 21px/1.3 ${SERIF}`, color: INK }}>Confirmed — the order is committed.</div>;
  }
  if (result?.status === "cannot_commit") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: SUB }}>This request could not be committed.</div>;
  }
  if (result?.status === "escalated") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: BAD }}>Something went wrong completing this — Novel's team has been notified.</div>;
  }
  if (result?.status === "negotiating") {
    return <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px", font: `400 15px ${SANS}`, color: SUB }}>Your response was received — a revised offer is being prepared.</div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 20px" }}>
      <h2 style={{ font: `500 27px/1.3 ${SERIF}`, color: INK, margin: 0 }}>A revised offer from Novel</h2>
      <p style={{ font: `400 15px/1.7 ${SANS}`, color: SUB, marginTop: 12 }}>Review the revised terms sent to you and accept or decline below.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button disabled={busy} onClick={() => respond("accept")} style={{ font: `500 14px ${SANS}`, color: "#fff", background: GREEN, border: "none", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}>Accept</button>
        <button disabled={busy} onClick={() => respond("reject")} style={{ font: `500 14px ${SANS}`, background: "transparent", border: "1px solid #E4E2D9", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}>Decline</button>
      </div>
    </div>
  );
}
