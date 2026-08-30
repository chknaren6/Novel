import { OK, WARN, BAD, MUTE, INK } from "@/app/market/styles";
import type { RoleId } from "@/lib/types";
import type { RoleDecision, RoleStatus } from "@/workflow/deriveDeskState";

// Geometry ported verbatim from the mockup (Novel Workspace.dc.html / INTEGRATION.md) —
// a fixed 900x540 logical canvas, six role nodes plus a seventh "Coordinator" node fed
// by all six. Positions are pure layout, not content, so there is nothing dishonest
// about reusing them exactly.
export const DIAGRAM_WIDTH = 900;
export const DIAGRAM_HEIGHT = 540;

export const ROLE_LABEL: Record<RoleId, string> = {
  sales: "Sales",
  finance: "Finance",
  inventory: "Inventory",
  procurement: "Procurement",
  logistics: "Logistics",
  risk: "Risk",
};

const ROLE_POSITION: Record<RoleId, { x: number; y: number }> = {
  sales: { x: 360, y: 0 },
  finance: { x: 0, y: 160 },
  inventory: { x: 240, y: 160 },
  procurement: { x: 480, y: 160 },
  logistics: { x: 720, y: 160 },
  risk: { x: 360, y: 320 },
};

export const COORDINATOR_ID = "coordinator";
export const COORDINATOR_POSITION = { x: 360, y: 440 };
export const COORDINATOR_NAME = "Coordinator";

// [pathD, the reveal step at which this pipe turns "on" — see REVEAL_STEPS] — same
// fan-out shape as the mockup: Sales -> the four parallel roles -> Risk -> Coordinator.
export const PIPES: Array<{ d: string; onAtStep: number }> = [
  { d: "M450,86 C450,126 90,120 90,160", onAtStep: 2 },
  { d: "M450,86 C450,126 330,120 330,160", onAtStep: 2 },
  { d: "M450,86 C450,126 570,120 570,160", onAtStep: 2 },
  { d: "M450,86 C450,126 810,120 810,160", onAtStep: 2 },
  { d: "M90,246 C90,292 400,282 400,320", onAtStep: 3 },
  { d: "M330,246 C330,288 435,288 435,320", onAtStep: 3 },
  { d: "M570,246 C570,288 465,288 465,320", onAtStep: 3 },
  { d: "M810,246 C810,292 500,282 500,320", onAtStep: 3 },
  { d: "M450,406 C450,422 450,424 450,440", onAtStep: 4 },
];

// The order dealSubmitted.ts actually runs the six roles in: sales alone, then the four
// in parallel, then risk. The reveal animation below follows this same real order.
export const ROLE_ORDER: RoleId[] = ["sales", "finance", "inventory", "procurement", "logistics", "risk"];

// Client-side reveal steps, played only after the real (already-final) result has come
// back from POST /submit. This paces disclosure of already-confirmed facts — it does
// not simulate or guess at anything the backend hasn't actually decided (deriveDeskState
// only ever returns "pending" before a case is submitted at all; by the time this
// component has a result, every role has a real, confirmed decision). Step numbers here
// are also what PIPES.onAtStep compares against.
export const REVEAL_STEPS: Array<{ roles: RoleId[]; delayMs: number }> = [
  { roles: ["sales"], delayMs: 500 },
  { roles: ["finance", "inventory", "procurement", "logistics"], delayMs: 1100 },
  { roles: ["risk"], delayMs: 900 },
  { roles: [], delayMs: 700 }, // coordinator's deterministic check
  { roles: [], delayMs: 500 }, // final outcome
];

export type NodeKind = "idle" | "revealing" | "ok" | "warn" | "bad";

const DECISION_KIND: Record<RoleDecision, NodeKind> = {
  approve: "ok",
  counter: "warn",
  veto: "bad",
  unavailable: "bad",
  pending: "idle",
};

export const KIND_COLOR: Record<NodeKind, string> = { idle: MUTE, revealing: INK, ok: OK, warn: WARN, bad: BAD };

const DECISION_LABEL: Record<RoleDecision, string> = {
  approve: "Approved",
  counter: "Countered",
  veto: "Vetoed",
  unavailable: "Unavailable",
  pending: "Waiting",
};

export interface DiagramNode {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: NodeKind;
  statusText: string;
  line: string;
  why: string | null;
  evidence: string | null;
  on: boolean; // whether this node has been reached by the reveal animation yet
}

export type OutcomeKind = "ok" | "warn" | "bad" | null;

// Which step (index into REVEAL_STEPS, 1-based "steps completed so far") a role belongs
// to, derived from ROLE_ORDER's grouping in REVEAL_STEPS — used to compute `on` per node.
function stepIndexForRole(role: RoleId): number {
  return REVEAL_STEPS.findIndex((step) => step.roles.includes(role)) + 1;
}

// Builds the six role nodes plus the Coordinator, given the real per-role decisions and
// how many reveal steps have played so far (revealedSteps: 0 = nothing shown yet, up to
// REVEAL_STEPS.length = everything including the final outcome).
export function buildDiagramNodes(roles: RoleStatus[], revealedSteps: number, outcomeKind: OutcomeKind, coordinatorWhy: string, coordinatorEvidence: string | null): DiagramNode[] {
  const byRole = new Map(roles.map((r) => [r.role, r]));
  const roleNodes = ROLE_ORDER.map((role): DiagramNode => {
    const status = byRole.get(role);
    const pos = ROLE_POSITION[role];
    const revealed = revealedSteps >= stepIndexForRole(role);
    const isRevealingNow = revealedSteps + 1 === stepIndexForRole(role);
    if (!status || !revealed) {
      return {
        id: role,
        name: ROLE_LABEL[role],
        x: pos.x,
        y: pos.y,
        kind: isRevealingNow ? "revealing" : "idle",
        statusText: isRevealingNow ? "Checking…" : "Waiting",
        line: isRevealingNow ? "Checking…" : "Waiting",
        why: null,
        evidence: null,
        on: isRevealingNow,
      };
    }
    return {
      id: role,
      name: ROLE_LABEL[role],
      x: pos.x,
      y: pos.y,
      kind: DECISION_KIND[status.decision],
      statusText: DECISION_LABEL[status.decision],
      line: status.explanation ?? DECISION_LABEL[status.decision],
      why: status.explanation,
      evidence: status.evidenceRefs.length > 0 ? status.evidenceRefs.join(" · ") : null,
      on: true,
    };
  });

  const coordinatorRevealed = revealedSteps >= 4;
  const coordinatorRevealing = revealedSteps === 3;
  const coordinatorNode: DiagramNode = {
    id: COORDINATOR_ID,
    name: COORDINATOR_NAME,
    x: COORDINATOR_POSITION.x,
    y: COORDINATOR_POSITION.y,
    kind: coordinatorRevealed ? (outcomeKind ?? "ok") : coordinatorRevealing ? "revealing" : "idle",
    statusText: coordinatorRevealed ? "Checked" : coordinatorRevealing ? "Verifying…" : "Waiting",
    line: coordinatorRevealed ? coordinatorWhy : coordinatorRevealing ? "Verifying every hold is in place…" : "Waiting",
    why: coordinatorRevealed ? coordinatorWhy : null,
    evidence: coordinatorRevealed ? coordinatorEvidence : null,
    on: coordinatorRevealed || coordinatorRevealing,
  };

  return [...roleNodes, coordinatorNode];
}

export function buildPipeStates(revealedSteps: number): Array<{ d: string; on: boolean }> {
  return PIPES.map((p) => ({ d: p.d, on: revealedSteps >= p.onAtStep }));
}

export interface DotState {
  role: RoleId;
  color: string;
  pulsing: boolean;
}

export function buildDots(roles: RoleStatus[], revealedSteps: number): DotState[] {
  const byRole = new Map(roles.map((r) => [r.role, r]));
  return ROLE_ORDER.map((role) => {
    const status = byRole.get(role);
    const revealed = revealedSteps >= stepIndexForRole(role);
    const isRevealingNow = revealedSteps + 1 === stepIndexForRole(role);
    if (!status || !revealed) {
      return { role, color: isRevealingNow ? KIND_COLOR.revealing : "#D8D5C9", pulsing: isRevealingNow };
    }
    return { role, color: KIND_COLOR[DECISION_KIND[status.decision]], pulsing: false };
  });
}
