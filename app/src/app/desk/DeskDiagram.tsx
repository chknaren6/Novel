"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { INK, LINE, SANS, MONO } from "@/app/market/styles";
import { DIAGRAM_WIDTH, DIAGRAM_HEIGHT, KIND_COLOR, type DiagramNode } from "./deskDiagramData";

const DASH_KEYFRAME = `@keyframes nvDash{to{stroke-dashoffset:-18}}`;

export function DeskDiagram({ nodes, pipes }: { nodes: DiagramNode[]; pipes: Array<{ d: string; on: boolean }> }) {
  const [containerWidth, setContainerWidth] = useState(DIAGRAM_WIDTH);
  const [hover, setHover] = useState<string | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  const setEl = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el;
    if (el) {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setContainerWidth(w);
    }
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.max(0.55, Math.min(1, containerWidth / DIAGRAM_WIDTH));
  const left = Math.max(0, Math.round((containerWidth - DIAGRAM_WIDTH * scale) / 2));
  const height = Math.round(DIAGRAM_HEIGHT * scale);

  const hovered = hover ? nodes.find((n) => n.name === hover) : null;
  const tipX = hovered ? Math.max(0, Math.min(hovered.x - 75, DIAGRAM_WIDTH - 330)) : 0;
  const tipY = hovered ? hovered.y + 100 : 0;

  return (
    <div ref={setEl} style={{ position: "relative", width: "100%", overflowX: "auto", marginTop: 16, height }}>
      <style>{DASH_KEYFRAME}</style>
      <div style={{ position: "absolute", top: 0, width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT, transformOrigin: "top left", transform: `scale(${scale})`, left }}>
        <svg width={DIAGRAM_WIDTH} height={DIAGRAM_HEIGHT} viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {pipes.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill="none"
              stroke={p.on ? "#B6B4A6" : "#EDEAE1"}
              strokeWidth={1.5}
              strokeDasharray={p.on ? "0" : "3 5"}
              style={{ animation: "none" }}
            />
          ))}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            onMouseEnter={() => setHover(n.name)}
            onMouseLeave={() => setHover(null)}
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              width: 158,
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${hover === n.name ? INK : LINE}`,
              boxShadow: hover === n.name ? "0 10px 26px rgba(25,26,23,.12)" : "none",
              background: "#fff",
              opacity: n.on ? 1 : 0.38,
              transition: "opacity .3s, box-shadow .2s",
              cursor: "default",
            }}
          >
            <div style={{ font: `600 14.5px ${SANS}`, color: INK }}>{n.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: KIND_COLOR[n.kind], flexShrink: 0 }} />
              <span style={{ font: `500 12.5px ${SANS}`, color: KIND_COLOR[n.kind] }}>{n.statusText}</span>
            </div>
          </div>
        ))}

        {hovered && (
          <div
            style={{
              position: "absolute",
              width: 330,
              background: "#23241F",
              color: "#fff",
              borderRadius: 10,
              padding: "16px 18px 17px",
              zIndex: 8,
              boxShadow: "0 14px 36px rgba(25,26,23,.24)",
              left: tipX,
              top: tipY,
            }}
          >
            <div style={{ font: `400 10.5px ${MONO}`, letterSpacing: ".13em", color: "#A9AA9C" }}>WHY {hovered.name.toUpperCase()} SAID THIS</div>
            <div style={{ font: `400 14px/1.6 ${SANS}`, marginTop: 9 }}>{hovered.why ?? "No decision yet."}</div>
            {hovered.evidence && (
              <div style={{ font: `400 11.5px/1.6 ${MONO}`, color: "#A9AA9C", marginTop: 11, paddingTop: 10, borderTop: "1px solid #3A3C33" }}>{hovered.evidence}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
