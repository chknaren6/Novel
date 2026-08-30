"use client";

import { INK, MUTE, SANS } from "@/app/market/styles";
import { KIND_COLOR, type DiagramNode } from "./deskDiagramData";

// The list view mirrors the diagram exactly — same nodes, same real content, laid out as
// rows instead of a graph (INTEGRATION.md design rule: "every animation has a static
// equivalent"). `why` shows inline once revealed, instead of on hover.
export function DeskChecklist({ nodes }: { nodes: DiagramNode[] }) {
  return (
    <div style={{ marginTop: 16 }}>
      {nodes.map((n) => (
        <div key={n.id} style={{ padding: "16px 0 17px", borderBottom: "1px solid #EDEAE1", transition: "opacity .45s", opacity: n.on ? 1 : 0.38 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 14px" }}>
            <span style={{ flex: "none", font: `600 15px ${SANS}`, minWidth: 104, color: INK }}>{n.name}</span>
            <span style={{ flex: "1 1 240px", minWidth: 200, font: `400 15px/1.6 ${SANS}`, color: INK }}>{n.line}</span>
            <span style={{ flex: "none", marginLeft: "auto", font: `500 13px ${SANS}`, color: KIND_COLOR[n.kind] }}>{n.statusText}</span>
          </div>
          {n.why && <div style={{ font: `400 14px/1.7 ${SANS}`, color: MUTE, marginTop: 8 }}>{n.why}</div>}
        </div>
      ))}
    </div>
  );
}
