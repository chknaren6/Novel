import { describe, it, expect } from "vitest";
import {
  taskSuccessRate,
  toolCallAccuracy,
  trajectoryMatchRate,
  latencyPercentile,
  hallucinationRate,
  humanOverrideRate,
  timeToCommitStats,
  recoverySuccessRate,
  type RunRecord,
} from "./metrics";
import type { CanonicalTrajectory } from "./canonicalTrajectories";
import type { RecordedRoleCall } from "@/gateway/recordingGateway";

function call(role: RecordedRoleCall["role"], toolCallName: string | null, toolArgs: unknown, decision = "approve", evidenceRefsCount = 1): RecordedRoleCall {
  return { role, toolCallName, toolArgs, decision, evidenceRefsCount };
}

function baseRun(overrides: Partial<RunRecord>): RunRecord {
  return {
    fixtureId: "CASE-FEASIBLE-AFTER-ADVANCE",
    runIndex: 0,
    expectedTerminalState: "committed",
    actualTerminalState: "committed",
    elapsedMs: 100,
    committedAtMs: null,
    disruptionOutcome: null,
    trajectory: [],
    decisions: [],
    ...overrides,
  };
}

describe("taskSuccessRate", () => {
  it("returns the fraction of runs whose actual terminal state matches expected", () => {
    const runs: RunRecord[] = [
      baseRun({ expectedTerminalState: "committed", actualTerminalState: "committed" }),
      baseRun({ expectedTerminalState: "committed", actualTerminalState: "cannot_commit" }),
      baseRun({ expectedTerminalState: "cannot_commit", actualTerminalState: "cannot_commit" }),
      baseRun({ expectedTerminalState: "repaired", actualTerminalState: "repaired" }),
    ];
    expect(taskSuccessRate(runs)).toBeCloseTo(3 / 4);
  });
});

// A simple two-stage trajectory: stage 1 is "sales" alone (no mutation call), stage 2
// is a concurrent pair ("inventory", "procurement") each expected to call a specific
// mutation tool identified by exactly one resource-identity argument.
const TEST_TRAJECTORY: CanonicalTrajectory = {
  fixtureId: "TEST-FIXTURE",
  stages: [
    { roles: ["sales"], expectedToolCalls: {} },
    {
      roles: ["inventory", "procurement"],
      expectedToolCalls: {
        inventory: { name: "hold_inventory", resourceArgKey: "warehouseId", resourceArgValue: "WH-BLR" },
        procurement: { name: "hold_supplier_option", resourceArgKey: "supplierId", resourceArgValue: "VEND-2003" },
      },
    },
  ],
};

describe("toolCallAccuracy", () => {
  it("counts a matching tool name + resource arg as correct", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          call("inventory", "hold_inventory", { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 }),
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003", quantity: 151, ttlSeconds: 900 }),
        ],
      }),
    ];
    expect(toolCallAccuracy(runs, [TEST_TRAJECTORY])).toBe(1);
  });

  it("counts a wrong resource arg value (e.g. wrong warehouse) as a mismatch", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          call("inventory", "hold_inventory", { warehouseId: "WH-WRONG", quantity: 199, ttlSeconds: 900 }),
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003", quantity: 151, ttlSeconds: 900 }),
        ],
      }),
    ];
    // 1 of 2 canonical-tool-call turns matches (procurement); inventory is wrong.
    expect(toolCallAccuracy(runs, [TEST_TRAJECTORY])).toBeCloseTo(0.5);
  });

  it("excludes turns with no canonical tool call expected (e.g. sales) from numerator and denominator", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          call("inventory", "hold_inventory", { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 900 }),
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003", quantity: 151, ttlSeconds: 900 }),
        ],
      }),
    ];
    // Both non-excluded turns match, so this must be exactly 1, not diluted by sales.
    expect(toolCallAccuracy(runs, [TEST_TRAJECTORY])).toBe(1);
  });
});

describe("trajectoryMatchRate", () => {
  it("matches a run whose concurrent-stage roles are recorded in a different order than canonical", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          // procurement recorded before inventory here — concurrency means no reliable
          // relative order, and this must still count as a full match.
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003" }),
          call("inventory", "hold_inventory", { warehouseId: "WH-BLR" }),
        ],
      }),
    ];
    expect(trajectoryMatchRate(runs, [TEST_TRAJECTORY])).toBe(1);
  });

  it("fails a run missing an entire role from a stage's role-set", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          // procurement never called at all — stage 2's actual role-set is only
          // {inventory}, not {inventory, procurement}.
          call("inventory", "hold_inventory", { warehouseId: "WH-BLR" }),
        ],
      }),
    ];
    expect(trajectoryMatchRate(runs, [TEST_TRAJECTORY])).toBe(0);
  });

  it("fails a run whose role-set matches but whose tool call args don't", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          call("inventory", "hold_inventory", { warehouseId: "WH-WRONG" }),
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003" }),
        ],
      }),
    ];
    expect(trajectoryMatchRate(runs, [TEST_TRAJECTORY])).toBe(0);
  });

  it("fails a run where a role with no canonical tool call makes one anyway (exceeds its authority)", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          // sales has expectedToolCalls: {} for this stage, but calls a mutation tool
          // anyway — this must NOT be silently treated as a match.
          call("sales", "hold_inventory", { warehouseId: "WH-BLR" }),
          call("inventory", "hold_inventory", { warehouseId: "WH-BLR" }),
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003" }),
        ],
      }),
    ];
    expect(trajectoryMatchRate(runs, [TEST_TRAJECTORY])).toBe(0);
  });

  it("fails a run where a role makes a duplicate/extra call beyond what canonical ever expects", () => {
    const runs: RunRecord[] = [
      baseRun({
        fixtureId: "TEST-FIXTURE",
        trajectory: [
          call("sales", null, null),
          call("inventory", "hold_inventory", { warehouseId: "WH-BLR" }),
          call("procurement", "hold_supplier_option", { supplierId: "VEND-2003" }),
          // procurement only ever appears once in TEST_TRAJECTORY's stages, so this
          // second call is unconsumed — it must not be silently dropped.
          call("procurement", "hold_supplier_option", { supplierId: "VEND-BOGUS" }),
        ],
      }),
    ];
    expect(trajectoryMatchRate(runs, [TEST_TRAJECTORY])).toBe(0);
  });
});

describe("latencyPercentile", () => {
  it("computes the exact p95 of a small known array via nearest-rank", () => {
    const runs: RunRecord[] = [10, 20, 30, 40, 50].map((elapsedMs, i) => baseRun({ runIndex: i, elapsedMs }));
    // n=5, p=95: index = ceil(0.95*5) - 1 = ceil(4.75) - 1 = 4 -> sorted[4] = 50
    expect(latencyPercentile(runs, 95)).toBe(50);
  });

  it("computes p50 of a small known array via nearest-rank", () => {
    const runs: RunRecord[] = [10, 20, 30, 40].map((elapsedMs, i) => baseRun({ runIndex: i, elapsedMs }));
    // n=4, p=50: index = ceil(0.5*4) - 1 = ceil(2) - 1 = 1 -> sorted[1] = 20
    expect(latencyPercentile(runs, 50)).toBe(20);
  });
});

describe("hallucinationRate", () => {
  it("counts a substantive decision with zero evidence as a hallucination", () => {
    const runs: RunRecord[] = [
      baseRun({ decisions: [{ decision: "approve", evidenceRefsCount: 0 }] }),
    ];
    expect(hallucinationRate(runs)).toBe(1);
  });

  it("does not count an 'unavailable' decision with zero evidence as a hallucination", () => {
    const runs: RunRecord[] = [
      baseRun({ decisions: [{ decision: "unavailable", evidenceRefsCount: 0 }] }),
    ];
    expect(hallucinationRate(runs)).toBe(0);
  });

  it("mixes both cases correctly across multiple decisions", () => {
    const runs: RunRecord[] = [
      baseRun({
        decisions: [
          { decision: "approve", evidenceRefsCount: 0 }, // hallucination
          { decision: "approve", evidenceRefsCount: 2 }, // fine
          { decision: "unavailable", evidenceRefsCount: 0 }, // excluded, not a hallucination
          { decision: "veto", evidenceRefsCount: 1 }, // fine
        ],
      }),
    ];
    expect(hallucinationRate(runs)).toBeCloseTo(1 / 4);
  });
});

describe("humanOverrideRate", () => {
  it("counts escalated and cannot_commit but not repaired", () => {
    const runs: RunRecord[] = [
      baseRun({ actualTerminalState: "escalated" }),
      baseRun({ actualTerminalState: "cannot_commit" }),
      baseRun({ actualTerminalState: "repaired" }),
      baseRun({ actualTerminalState: "committed" }),
    ];
    expect(humanOverrideRate(runs)).toBeCloseTo(2 / 4);
  });
});

describe("timeToCommitStats", () => {
  it("returns null when no runs ever committed", () => {
    const runs: RunRecord[] = [baseRun({ committedAtMs: null }), baseRun({ committedAtMs: null })];
    expect(timeToCommitStats(runs)).toBeNull();
  });

  it("computes count/mean/p95 over runs that committed", () => {
    const runs: RunRecord[] = [
      baseRun({ committedAtMs: 100 }),
      baseRun({ committedAtMs: 200 }),
      baseRun({ committedAtMs: null }), // never committed, excluded
    ];
    const stats = timeToCommitStats(runs);
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(2);
    expect(stats!.meanMs).toBe(150);
  });
});

describe("recoverySuccessRate", () => {
  it("returns null when no runs exercised a disruption", () => {
    const runs: RunRecord[] = [baseRun({ disruptionOutcome: null }), baseRun({ disruptionOutcome: null })];
    expect(recoverySuccessRate(runs)).toBeNull();
  });

  it("computes the fraction of disruption runs that repaired", () => {
    const runs: RunRecord[] = [
      baseRun({ disruptionOutcome: "repaired" }),
      baseRun({ disruptionOutcome: "repaired" }),
      baseRun({ disruptionOutcome: "cannot_commit" }),
      baseRun({ disruptionOutcome: null }), // not a disruption run, excluded
    ];
    const result = recoverySuccessRate(runs);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(3);
    expect(result!.rate).toBeCloseTo(2 / 3);
  });
});
