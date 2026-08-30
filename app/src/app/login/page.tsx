"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { INK, SUB, GREEN, LINE, BAD, SANS, SERIF } from "@/app/market/styles";

const label = { font: `400 10.5px 'IBM Plex Mono', monospace`, letterSpacing: ".14em", color: SUB, textTransform: "uppercase" as const };
const box = { border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 14px", font: `400 15px ${SANS}`, width: "100%" };

// Single-operator MVP: there is no self-service signup page. The one operator account
// is created directly in the Supabase dashboard (Authentication -> Users -> Add user),
// which avoids building and securing a public signup flow this project doesn't need.
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    const next = searchParams.get("next") ?? "/market";
    router.push(next);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 380, margin: "80px auto", padding: "0 20px" }}>
      <h2 style={{ font: `500 27px/1.3 ${SERIF}`, color: INK, margin: 0 }}>Novel operator login</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
        {error && (
          <div style={{ marginBottom: 16, padding: "12px 16px", border: `1px solid ${LINE}`, borderRadius: 8, color: BAD, font: `400 14px ${SANS}` }}>
            {error}
          </div>
        )}
        <div style={label}>Email</div>
        <input
          type="email"
          required
          autoComplete="email"
          style={{ ...box, marginTop: 6 }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div style={{ ...label, marginTop: 16 }}>Password</div>
        <input
          type="password"
          required
          autoComplete="current-password"
          style={{ ...box, marginTop: 6 }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !email || !password}
          style={{ marginTop: 20, width: "100%", font: `500 14px ${SANS}`, color: "#fff", background: GREEN, border: "none", borderRadius: 8, padding: "12px 20px", cursor: "pointer" }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
