import { describe, it, expect } from "vitest";
import { buildDiagramNodes, buildPipeStates, buildDots, REVEAL_STEPS, ROLE_ORDER } from "./deskDiagramData";
import type { RoleStatus } from "@/workflow/deriveDeskState";

const ALL_APPROVED: RoleStatus[] = ROLE_ORDER.map((role) => ({ role, decision: "approve", explanation: `${role} approved.`, evidenceRefs: [`EVID-${role.toUpperCase()}`] }));

describe("buildDiagramNodes", () => {
  it("shows every role as idle/waiting before any reveal step has played", () => {
    const nodes = buildDiagramNodes(ALL_APPROVED, 0, null, "", null);
    const sales = nodes.find((n) => n.id === "sales")!;
    expect(sales.kind).toBe("revealing"); // step 1 is next up
    const finance = nodes.find((n) => n.id === "finance")!;
    expect(finance.kind).toBe("idle");
    expect(finance.on).toBe(false);
    const coordinator = nodes.find((n) => n.id === "coordinator")!;
    expect(coordinator.kind).toBe("idle");
  });

  it("reveals sales's real decision content once step 1 has played, without touching the still-pending roles", () => {
    const nodes = buildDiagramNodes(ALL_APPROVED, 1, null, "", null);
    const sales = nodes.find((n) => n.id === "sales")!;
    expect(sales.kind).toBe("ok");
    expect(sales.why).toBe("sales approved.");
    expect(sales.evidence).toBe("EVID-SALES");
    const finance = nodes.find((n) => n.id === "finance")!;
    expect(finance.kind).toBe("revealing"); // step 2 is next up
  });

  it("reveals all four parallel roles together at step 2, never partially", () => {
    const nodes = buildDiagramNodes(ALL_APPROVED, 2, null, "", null);
    for (const role of ["finance", "inventory", "procurement", "logistics"]) {
      expect(nodes.find((n) => n.id === role)!.kind).toBe("ok");
    }
    expect(nodes.find((n) => n.id === "risk")!.kind).toBe("revealing");
  });

  it("uses a counter/veto real decision to color the node warn/bad, not a hardcoded per-role kind", () => {
    const mixed: RoleStatus[] = ALL_APPROVED.map((r) => (r.role === "inventory" ? { ...r, decision: "counter" as const } : r.role === "risk" ? { ...r, decision: "veto" as const } : r));
    const nodes = buildDiagramNodes(mixed, REVEAL_STEPS.length, "bad", "Six checks, one failed.", null);
    expect(nodes.find((n) => n.id === "inventory")!.kind).toBe("warn");
    expect(nodes.find((n) => n.id === "risk")!.kind).toBe("bad");
  });

  it("reveals the coordinator with the real outcome kind only after step 4", () => {
    const beforeCoordinator = buildDiagramNodes(ALL_APPROVED, 3, "ok", "All clear.", "CERT-1");
    expect(beforeCoordinator.find((n) => n.id === "coordinator")!.kind).toBe("revealing");

    const afterCoordinator = buildDiagramNodes(ALL_APPROVED, 4, "ok", "All clear.", "CERT-1");
    const coordinator = afterCoordinator.find((n) => n.id === "coordinator")!;
    expect(coordinator.kind).toBe("ok");
    expect(coordinator.why).toBe("All clear.");
    expect(coordinator.evidence).toBe("CERT-1");
  });
});

describe("buildPipeStates", () => {
  it("turns pipes on only as their feeding roles are revealed", () => {
    expect(buildPipeStates(0).every((p) => !p.on)).toBe(true);
    const atStep2 = buildPipeStates(2);
    expect(atStep2.filter((p) => p.on)).toHaveLength(4); // sales -> four parallel roles
    expect(buildPipeStates(4).every((p) => p.on)).toBe(true);
  });
});

describe("buildDots", () => {
  it("pulses exactly the role whose reveal step is next, and colors revealed roles by their real decision", () => {
    const dots = buildDots(ALL_APPROVED, 0);
    expect(dots.find((d) => d.role === "sales")!.pulsing).toBe(true);
    expect(dots.filter((d) => d.pulsing)).toHaveLength(1);

    const afterSales = buildDots(ALL_APPROVED, 1);
    expect(afterSales.find((d) => d.role === "sales")!.pulsing).toBe(false);
    expect(afterSales.find((d) => d.role === "sales")!.color).not.toBe("#D8D5C9");
  });
});
