import type { CaseStatus, RoleId } from "@/lib/types";
import type { RecordedRoleCall } from "@/gateway/recordingGateway";
import type { CanonicalStage, CanonicalTrajectory } from "./canonicalTrajectories";

// One evaluation run's outcome, assembled by scripts/evaluate.ts. Pure data — no DB or
// gateway dependency — so every function below is unit-testable in isolation.
export interface RunRecord {
  fixtureId: string;
  runIndex: number;
  expectedTerminalState: CaseStatus;
  actualTerminalState: CaseStatus;
  elapsedMs: number;
  // Wall-clock ms from the run's start to the moment the case was first observed at
  // "committed", or null if the case never reached "committed" during this run.
  committedAtMs: number | null;
  // The `status` field of runSupplierDisruption's result if a supplier-disruption-and-
  // repair sequence actually ran during this run, else null.
  disruptionOutcome: "repaired" | "cannot_commit" | null;
  // A snapshot of RecordingModelGateway.calls at the end of this run (see
  // gateway/recordingGateway.ts) — used by toolCallAccuracy and trajectoryMatchRate.
  trajectory: RecordedRoleCall[];
  // This run's persisted DomainDecision rows (all case versions), reduced to just the
  // two fields hallucinationRate needs. Read back from the DB separately from
  // `trajectory` because roleRuntime.ts persists only `output`, not tool-call data.
  decisions: Array<{ decision: string; evidenceRefsCount: number }>;
}

// Fraction of runs where the actual terminal CaseStatus equals the fixture's expected
// terminal state. Mirrors τ-bench's evaluation methodology of comparing final state
// against an annotated goal state rather than grading intermediate reasoning
// (arXiv:2406.12045, "τ-bench: A Benchmark for Tool-Agent-User Interaction in
// Real-World Domains").
export function taskSuccessRate(runs: RunRecord[]): number {
  if (runs.length === 0) return 0;
  const passing = runs.filter((run) => run.actualTerminalState === run.expectedTerminalState).length;
  return passing / runs.length;
}

// Aligns one run's recorded calls to its canonical trajectory's stages using the
// static role->stage membership the trajectory defines (never call timing/order,
// since concurrent stage-2 roles have no reliable relative order): for each role, its
// successive actual calls are matched positionally to that role's successive
// canonical-stage appearances, in trajectory order. Shared by toolCallAccuracy and
// trajectoryMatchRate so both metrics group a run's calls into stages identically.
interface AlignedStage {
  stage: CanonicalStage;
  actualRoles: Set<RoleId>;
  actualCallsByRole: Partial<Record<RoleId, RecordedRoleCall>>;
}

function alignRunToStages(trajectory: CanonicalTrajectory, calls: RecordedRoleCall[]): AlignedStage[] {
  const queues = new Map<RoleId, RecordedRoleCall[]>();
  for (const call of calls) {
    const queue = queues.get(call.role) ?? [];
    queue.push(call);
    queues.set(call.role, queue);
  }
  const pointers = new Map<RoleId, number>();

  return trajectory.stages.map((stage) => {
    const actualRoles = new Set<RoleId>();
    const actualCallsByRole: Partial<Record<RoleId, RecordedRoleCall>> = {};
    for (const role of stage.roles) {
      const queue = queues.get(role) ?? [];
      const index = pointers.get(role) ?? 0;
      const call = queue[index];
      if (call) {
        actualRoles.add(role);
        actualCallsByRole[role] = call;
        pointers.set(role, index + 1);
      }
    }
    return { stage, actualRoles, actualCallsByRole };
  });
}

function toolCallMatches(actual: RecordedRoleCall | undefined, expected: { name: string; resourceArgKey: string; resourceArgValue: unknown }): boolean {
  if (!actual || actual.toolCallName !== expected.name) return false;
  const args = actual.toolArgs as Record<string, unknown> | null;
  return args !== null && typeof args === "object" && args[expected.resourceArgKey] === expected.resourceArgValue;
}

// Over every individual recorded role-turn across all runs that has a canonical
// expected tool call defined for it, the fraction whose actual toolCallName and
// resource-identifying arg value exactly match canonical. Turns with no canonical
// tool call expected (e.g. sales/risk, which never call a mutation tool) are excluded
// from both numerator and denominator.
export function toolCallAccuracy(runs: RunRecord[], trajectories: CanonicalTrajectory[]): number {
  let matches = 0;
  let total = 0;
  for (const run of runs) {
    const trajectory = trajectories.find((t) => t.fixtureId === run.fixtureId);
    if (!trajectory) continue;
    const aligned = alignRunToStages(trajectory, run.trajectory);
    for (const { stage, actualCallsByRole } of aligned) {
      for (const role of Object.keys(stage.expectedToolCalls) as RoleId[]) {
        const expected = stage.expectedToolCalls[role];
        if (!expected) continue;
        total += 1;
        if (toolCallMatches(actualCallsByRole[role], expected)) matches += 1;
      }
    }
  }
  return total === 0 ? 0 : matches / total;
}

// Fraction of runs (not turns) where every stage's actual role-set equals the
// canonical role-set for that stage (order-independent within a stage, since stage-2
// roles run concurrently by design) AND every role's actual tool call matches
// canonical, for every stage. Runs whose fixtureId has no canonical trajectory
// defined are excluded from the denominator (there is nothing to compare against).
export function trajectoryMatchRate(runs: RunRecord[], trajectories: CanonicalTrajectory[]): number {
  const comparable = runs.filter((run) => trajectories.some((t) => t.fixtureId === run.fixtureId));
  if (comparable.length === 0) return 0;

  let matching = 0;
  for (const run of comparable) {
    const trajectory = trajectories.find((t) => t.fixtureId === run.fixtureId)!;
    const aligned = alignRunToStages(trajectory, run.trajectory);
    const runMatches = aligned.every(({ stage, actualRoles, actualCallsByRole }) => {
      const expectedRoles = new Set(stage.roles);
      if (expectedRoles.size !== actualRoles.size) return false;
      for (const role of expectedRoles) {
        if (!actualRoles.has(role)) return false;
      }
      for (const role of Object.keys(stage.expectedToolCalls) as RoleId[]) {
        const expected = stage.expectedToolCalls[role];
        if (!expected) continue;
        if (!toolCallMatches(actualCallsByRole[role], expected)) return false;
      }
      return true;
    });
    if (runMatches) matching += 1;
  }
  return matching / comparable.length;
}

// Real p-th percentile (nearest-rank method: sort ascending, index =
// ceil(p/100 * n) - 1, clamped to [0, n-1]) of `elapsedMs` across all runs. This
// measures pipeline/orchestration latency under the deterministic FakeModelGateway
// harness (DB round-trips + adapter logic only) and explicitly does NOT include real
// LLM inference latency — it is not comparable to any external agent-latency
// benchmark, and none is claimed.
export function latencyPercentile(runs: RunRecord[], p: number): number {
  return nearestRankPercentile(runs.map((run) => run.elapsedMs), p);
}

function nearestRankPercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.max(Math.ceil((p / 100) * sorted.length) - 1, 0), sorted.length - 1);
  return sorted[index]!;
}

// Fraction of persisted role decisions (across all runs) where decision !==
// "unavailable" AND the decision cited zero evidence (evidenceRefsCount === 0). This
// is an internally-defined proxy (no external industry baseline exists for this
// metric in this domain) for "the role asserted something substantive without citing
// any evidence." Harness limitation: because this evaluation runner drives a
// fully-scripted, deterministic FakeModelGateway rather than a real, freely-generating
// LLM, this number will trivially be near 0% by construction (the script's author
// controls every citation) — it is NOT evidence that a real OpenAI-gateway-backed run
// (see Task 20's OpenAI-backed ModelGateway) would also score near 0%; validating that
// would require running this same check against real-gateway decision logs, which is
// a live-inference, non-deterministic exercise outside this repeatable regression
// harness's scope.
export function hallucinationRate(runs: RunRecord[]): number {
  const decisions = runs.flatMap((run) => run.decisions);
  if (decisions.length === 0) return 0;
  const hallucinated = decisions.filter((d) => d.decision !== "unavailable" && d.evidenceRefsCount === 0).length;
  return hallucinated / decisions.length;
}

// Fraction of runs whose actualTerminalState is in {"escalated", "cannot_commit"}.
// Internally-defined proxy for "this run reached a state the system itself flags as
// requiring manual reconciliation" (per 04-DATA-AND-STATE-SPEC.md's state-machine
// terminality) — no live human operator exists in this harness, so this counts
// system-flagged-for-human-review outcomes, not literally recorded human actions; no
// external baseline exists for this metric either.
export function humanOverrideRate(runs: RunRecord[]): number {
  if (runs.length === 0) return 0;
  const overridden = runs.filter((run) => run.actualTerminalState === "escalated" || run.actualTerminalState === "cannot_commit").length;
  return overridden / runs.length;
}

// Over runs where committedAtMs is non-null (i.e. the run reached "committed" at some
// point, even if a later fixture phase moves it further, e.g. the disruption fixture
// continues on to "repaired" after committing), the count/mean/p95 of committedAtMs.
// Returns null if no runs ever committed.
export function timeToCommitStats(runs: RunRecord[]): { count: number; meanMs: number; p95Ms: number } | null {
  const committedMs = runs.map((run) => run.committedAtMs).filter((ms): ms is number => ms !== null);
  if (committedMs.length === 0) return null;
  const meanMs = committedMs.reduce((sum, ms) => sum + ms, 0) / committedMs.length;
  return { count: committedMs.length, meanMs, p95Ms: nearestRankPercentile(committedMs, 95) };
}

// Over runs where disruptionOutcome !== null (i.e. a supplier-disruption-and-repair
// sequence actually ran), the fraction where disruptionOutcome === "repaired". Returns
// null if no runs exercised disruption.
export function recoverySuccessRate(runs: RunRecord[]): { count: number; rate: number } | null {
  const disruptionRuns = runs.filter((run) => run.disruptionOutcome !== null);
  if (disruptionRuns.length === 0) return null;
  const repaired = disruptionRuns.filter((run) => run.disruptionOutcome === "repaired").length;
  return { count: disruptionRuns.length, rate: repaired / disruptionRuns.length };
}
