"use client";

import type { DotState } from "./deskDiagramData";

const DOT_KEYFRAMES = `@keyframes nvDot{0%,100%{transform:scale(.66);opacity:.26}45%{transform:scale(1);opacity:1}}`;

// The six-dot progress row from the mockup, ported verbatim (staggered 0.12s delay per
// dot so they pulse in sequence) but colored by each role's real decision once revealed,
// not a hardcoded per-role kind.
export function SixDots({ dots }: { dots: DotState[] }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <style>{DOT_KEYFRAMES}</style>
      {dots.map((dot, i) => (
        <span
          key={dot.role}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: dot.color,
            display: "inline-block",
            animation: dot.pulsing ? "nvDot 1.05s ease-in-out infinite" : "none",
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}
