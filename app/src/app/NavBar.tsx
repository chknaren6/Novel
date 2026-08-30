"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { INK, SUB, LINE, GREEN, SANS, MONO } from "@/app/market/styles";

const TABS = [
  { href: "/market", label: "Marketplace" },
  { href: "/desk", label: "Commitment Desk" },
] as const;

// Shared between /market and /desk — the two operator-facing top-level features. The
// buyer/customer-facing token pages ([caseId]/accept, [caseId]/respond, /login) render
// their own minimal layout without this bar, since those aren't the operator's own view.
export function NavBar() {
  const pathname = usePathname();

  return (
    <nav style={{ borderBottom: `1px solid ${LINE}`, padding: "18px clamp(20px, 6vw, 40px)", display: "flex", alignItems: "center", gap: 28 }}>
      <span style={{ font: `500 13px ${MONO}`, letterSpacing: ".08em", color: INK }}>NOVEL</span>
      <div style={{ display: "flex", gap: 20 }}>
        {TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                font: `500 14px ${SANS}`,
                color: active ? INK : SUB,
                textDecoration: "none",
                paddingBottom: 4,
                borderBottom: active ? `2px solid ${GREEN}` : "2px solid transparent",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
