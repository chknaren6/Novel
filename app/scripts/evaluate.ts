import { config } from "dotenv";

// Same convention as scripts/liveDemo.ts and prisma/seed.ts: local env vars live in
// .env.local (this supplies BUYER_LINK_SIGNING_SECRET; DATABASE_URL points at
// prisma/dev.db, the same dev database the rest of this app runs against).
config({ path: ".env.local" });
config();

import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { seedFixture } from "@/fixtures/seedFixture";
import { ALL_FIXTURES, type FixtureDefinition } from "@/fixtures/definitions";
import { ALL_CANONICAL_TRAJECTORIES } from "@/fixtures/canonicalTrajectories";
import { buildEvaluationScript } from "@/fixtures/evaluationScripts";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import { RecordingModelGateway } from "@/gateway/recordingGateway";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { runBuyerResponse } from "@/workflow/buyerResponse";
import { runSupplierDisruption, type RunSupplierDisruptionResult } from "@/workflow/supplierDisrupted";
import { verifyTerminalState } from "@/reservations/coordinator";
import { fromJsonColumn } from "@/lib/json-column";
import type { CaseStatus } from "@/lib/types";
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
} from "@/fixtures/metrics";

const RUNS_PER_FIXTURE = 10;
const MODEL_ID = "fake-model-v1";
const TIMEOUT_MS = 2000;
const BUYER_LINK_SIGNING_SECRET = process.env.BUYER_LINK_SIGNING_SECRET ?? "eval-harness-signing-secret";
const SUBMISSION_DIR = path.resolve(__dirname, "..", "submission");

// Deliberately drives the deterministic FakeModelGateway, never the real OpenAI-backed
// gateway (src/gateway/openaiGateway.ts). CASE-STALE-SUPPLIER-HOLD's whole point is a
// supplier hold that is *already expired* the instant it's created (ttlSeconds: 0) —
// no real LLM can be reliably scripted to request a zero TTL, so a deterministic
// FakeModelGateway is the only way to reproduce that fixture on demand. Reusing the
// same gateway for all three fixtures keeps this a single, repeatable regression
// harness rather than mixing a live-inference path into it.
async function runOnce(fixture: FixtureDefinition, runIndex: number): Promise<RunRecord> {
  // Known limitation, not fixed here: seedFixture() unconditionally create()s fresh
  // Company/Customer rows every call with no reset (unlike its own documented
  // mitigation for InventoryPosition/SupplierOption). This script calls seedFixture 30
  // times per invocation and is meant to be re-run repeatedly against the shared
  // prisma/dev.db, so repeated `npm run evaluate` runs accumulate orphaned
  // Company/Customer rows there over time. A full fix would need a corresponding
  // natural-key reset/cleanup inside seedFixture.ts itself — out of scope here.
  const { dealCase } = await seedFixture(db, fixture);
  const script = buildEvaluationScript({ supplierTtlSeconds: fixture.fixtureId === "CASE-STALE-SUPPLIER-HOLD" ? 0 : 900 });
  const gateway = new RecordingModelGateway(new FakeModelGateway(script));

  const startedAt = Date.now();
  let committedAtMs: number | null = null;
  let disruptionOutcome: RunSupplierDisruptionResult["status"] | null = null;
  const traceIdBase = `eval-${fixture.fixtureId}-${runIndex}`;

  const submitted = await runDealSubmitted(db, gateway, {
    caseId: dealCase.id,
    modelId: MODEL_ID,
    timeoutMs: TIMEOUT_MS,
    traceId: `${traceIdBase}-submit`,
    buyerLinkSigningSecret: BUYER_LINK_SIGNING_SECRET,
  });

  // All three fixtures start at NET_60 (see fixtures/definitions.ts's shared
  // INITIAL_TERMS), so runDealSubmitted always routes to "negotiating" first — mirroring
  // the exact sequencing already proven in dealSubmitted.test.ts / buyerResponse.test.ts
  // / supplierDisrupted.test.ts / staleSupplierHold.test.ts. Assumption: committedAtMs
  // is only ever set below, inside this branch. That's correct for all 3 current
  // fixtures, but a future fixture whose initial terms committed directly (without ever
  // negotiating) would silently leave committedAtMs: null despite
  // actualTerminalState === "committed" — worth remembering if a new fixture is added.
  if (submitted.status === "negotiating") {
    const accepted = await runBuyerResponse(db, gateway, {
      buyerToken: submitted.buyerToken,
      response: "accept",
      modelId: MODEL_ID,
      timeoutMs: TIMEOUT_MS,
      traceId: `${traceIdBase}-accept`,
      buyerLinkSigningSecret: BUYER_LINK_SIGNING_SECRET,
    });
    if (accepted.status === "committed") {
      committedAtMs = Date.now() - startedAt;
    }
  }

  if (fixture.fixtureId === "CASE-POST-COMMIT-DISRUPTION" && committedAtMs !== null) {
    const disrupted = await runSupplierDisruption(db, gateway, {
      caseId: dealCase.id,
      disruptedSupplierId: "VEND-2003",
      modelId: MODEL_ID,
      timeoutMs: TIMEOUT_MS,
      traceId: `${traceIdBase}-disrupt`,
    });
    disruptionOutcome = disrupted.status;
  }

  const elapsedMs = Date.now() - startedAt;
  const report = await verifyTerminalState(db, dealCase.id);

  // Tool-call data is never persisted to the DB (roleRuntime.ts keeps only `output`),
  // so it's captured live via RecordingModelGateway.calls above; but the persisted
  // DomainDecision rows are still the right source for hallucinationRate, since that
  // metric is defined over what was actually recorded as this case's domain decisions
  // (all versions), not just this run's in-memory gateway trace.
  const decisionRows = await db.domainDecision.findMany({ where: { caseId: dealCase.id } });
  const decisions = decisionRows.map((row) => ({ decision: row.decision, evidenceRefsCount: fromJsonColumn<string[]>(row.evidenceRefs).length }));

  const trajectory = [...gateway.calls];
  // No-op today: `gateway` is a fresh RecordingModelGateway constructed at the top of
  // this same runOnce() call, so there is nothing accumulated for reset() to clear.
  // Kept anyway as a defensive habit in case a future refactor starts reusing one
  // gateway instance across multiple runs.
  gateway.reset();

  return {
    fixtureId: fixture.fixtureId,
    runIndex,
    expectedTerminalState: fixture.expectedTerminalState,
    actualTerminalState: report.caseStatus as CaseStatus,
    elapsedMs,
    committedAtMs,
    disruptionOutcome,
    trajectory,
    decisions,
  };
}

function writeCsv(runs: RunRecord[]) {
  const header = "fixtureId,run,expected,actual,pass,elapsedMs";
  const lines = runs.map((run) => [run.fixtureId, run.runIndex, run.expectedTerminalState, run.actualTerminalState, run.expectedTerminalState === run.actualTerminalState, run.elapsedMs].join(","));
  fs.writeFileSync(path.join(SUBMISSION_DIR, "three-case-results.csv"), [header, ...lines].join("\n") + "\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildReport(runs: RunRecord[]): string {
  const byFixture = (fixtureId: string) => runs.filter((run) => run.fixtureId === fixtureId);

  const overallSuccess = taskSuccessRate(runs);
  const perFixtureSuccess = ALL_FIXTURES.map((f) => ({ fixtureId: f.fixtureId, rate: taskSuccessRate(byFixture(f.fixtureId)) }));

  const overallToolAccuracy = toolCallAccuracy(runs, ALL_CANONICAL_TRAJECTORIES);
  const overallTrajectoryMatch = trajectoryMatchRate(runs, ALL_CANONICAL_TRAJECTORIES);

  const overallP95 = latencyPercentile(runs, 95);
  const perFixtureP95 = ALL_FIXTURES.map((f) => ({ fixtureId: f.fixtureId, p95: latencyPercentile(byFixture(f.fixtureId), 95) }));

  const overallHallucination = hallucinationRate(runs);
  const overallOverride = humanOverrideRate(runs);
  const perFixtureOverride = ALL_FIXTURES.map((f) => ({ fixtureId: f.fixtureId, rate: humanOverrideRate(byFixture(f.fixtureId)) }));

  const ttc = timeToCommitStats(runs);
  const recovery = recoverySuccessRate(runs);

  const totalRuns = runs.length;

  return `# CommitOS Evaluation Report

Generated by \`scripts/evaluate.ts\` (\`npm run evaluate\`) over ${totalRuns} total runs (${RUNS_PER_FIXTURE} repetitions x ${ALL_FIXTURES.length} fixtures).

## Why FakeModelGateway, not the real OpenAI-backed gateway

This harness drives \`FakeModelGateway\` (src/gateway/fakeGateway.ts), never the real
\`OpenAIModelGateway\` (src/gateway/openaiGateway.ts). CASE-STALE-SUPPLIER-HOLD's entire
premise is a supplier reservation hold that is already expired the instant it's
created (\`ttlSeconds: 0\`); no real LLM can be reliably prompted to request a zero TTL
on demand, so a deterministic scripted gateway is the only way to reproduce that
fixture's failure mode repeatably. Reusing the same deterministic gateway for all three
fixtures keeps this a single, repeatable regression harness rather than mixing a
live, non-deterministic inference path into it — see
src/workflow/staleSupplierHold.test.ts for the pre-existing test this generalizes.

## Metrics

### 1. Task Success Rate

**Definition:** fraction of runs where \`actualTerminalState === expectedTerminalState\`
(see \`taskSuccessRate\` in src/fixtures/metrics.ts).

**Measured:** ${pct(overallSuccess)} overall (${runs.filter((r) => r.actualTerminalState === r.expectedTerminalState).length}/${totalRuns}).

Per fixture:
${perFixtureSuccess.map((f) => `- ${f.fixtureId}: ${pct(f.rate)}`).join("\n")}

**External context (methodology only, not a numeric target):** τ-bench evaluates
agents the same way — comparing final state to an annotated goal state rather than
grading intermediate reasoning — and reports that even GPT-4o succeeds on under 50% of
τ-bench's tasks, with \`pass^8\` reliability under 25% in its retail domain (Yao et al.,
"τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains",
https://arxiv.org/abs/2406.12045). τ-bench's domain (customer-service agents handling
open-ended user dialogue) and CommitOS's domain (a deterministic, scripted supply-chain
commitment workflow) are not directly comparable in raw percentage terms — this
citation grounds the *definition* of the metric, not a claim that CommitOS's number
"beats" τ-bench's.

**Business-domain analogy (not the same metric):** APQC's Perfect Order Performance
benchmark reports median organizations achieving a 90% perfect order index and
top-quartile performers 95%+, where a "perfect order" is itself a composite of
on-time delivery, order completeness, damage-free, and accurate-documentation rates
(APQC, "Perfect order performance",
https://www.apqc.org/resources/benchmarking/open-standards-benchmarking/measures/perfect-order-performance).
This is a real-world, high-volume fulfillment KPI measured across a population of
companies, not the same measurement as a 30-run deterministic regression suite's pass
rate — CommitOS's own number is reported above honestly as context, not as a claim of
superiority.

**Second analogy:** OTIF (On-Time-In-Full) industry benchmarks report 88-93% for
Industrial Equipment manufacturing and 90-94% for Industrial Distribution (MetricHQ,
"On-Time In-Full (OTIF)", https://www.metrichq.org/supply-chain/on-time-in-full/). Same
caveat as above: a real-world fulfillment KPI, not the same measurement.

### 2. Tool Call Accuracy

**Definition:** over every individual recorded role-turn across all runs that has a
canonical expected tool call defined for it (src/fixtures/canonicalTrajectories.ts),
the fraction whose actual tool call matches canonical. Most roles are checked on tool
name AND resource-identifying argument; finance's \`hold_credit_envelope\` is checked on
tool name only, since its only arguments — exposureMinor/ttlSeconds — are policy
parameters with no resource identity to compare. Turns with no canonical tool call
expected at all (sales/risk, which never call a mutation tool in any stage) are
excluded from both numerator and denominator.

**Measured:** ${pct(overallToolAccuracy)} overall.

**External baseline:** none exists or is claimed as a numeric target. τ-bench observes
that agent failures in its benchmark "come from wrong action selection and wrong
arguments, not from insufficient reasoning" (arXiv:2406.12045) — cited here only as
conceptual grounding for why this metric matters, not as a numeric target, since
τ-bench does not publish tool-call accuracy as a standalone percentage.

### 3. Trajectory Match Rate

**Definition:** fraction of runs (not turns) where every stage's actual role-set
equals the canonical role-set for that stage (order-independent within a stage, since
stage-2 roles run concurrently via \`Promise.all\` by design) AND every role's actual
tool call matches canonical, for every stage.

**Measured:** ${pct(overallTrajectoryMatch)} overall.

**External baseline:** none, for the same reason as Tool Call Accuracy above — same
τ-bench conceptual grounding, no standalone published percentage to compare against.

### 4. Latency (p95)

**Definition:** the 95th percentile (nearest-rank method) of \`elapsedMs\` — total
wall-clock time for one run's full workflow chain — across all runs.

**Measured:** ${overallP95}ms overall.

Per fixture:
${perFixtureP95.map((f) => `- ${f.fixtureId}: ${f.p95}ms`).join("\n")}

**No external baseline exists or is claimed.** This measures pipeline/orchestration
latency under the deterministic FakeModelGateway harness (DB round-trips + adapter
logic only) and explicitly does NOT include real LLM inference latency — it is not
comparable to any external agent-latency benchmark.

### 5. Hallucination Rate

**Definition:** fraction of persisted role decisions (across all runs) where
\`decision !== "unavailable"\` AND the decision cited zero evidence
(\`evidenceRefsCount === 0\`).

**Measured:** ${pct(overallHallucination)} overall.

**No external baseline exists** for this metric in this domain. This is an
internally-defined proxy for "the role asserted something substantive without citing
any evidence." Harness limitation, stated plainly: because this evaluation runner
drives a fully-scripted, deterministic FakeModelGateway rather than a real,
freely-generating LLM, this number is trivially near 0% by construction (the script's
author controls every citation) — it is NOT evidence that a real OpenAI-gateway-backed
run would also score near 0%. Validating that would require running this same check
against real-gateway decision logs, a live-inference, non-deterministic exercise
outside this repeatable regression harness's scope.

### 6. Human Override Rate

**Definition:** fraction of runs whose \`actualTerminalState\` is in
\`{"escalated", "cannot_commit"}\` — the two states that mean this case needs a human to
reconcile it (\`"repaired"\` is a successful automated-recovery terminal state and does
NOT count).

**Measured:** ${pct(overallOverride)} overall.

Per fixture:
${perFixtureOverride.map((f) => `- ${f.fixtureId}: ${pct(f.rate)}`).join("\n")}

**No external baseline exists.** Internally-defined proxy for "this run reached a
state the system itself flags as requiring manual reconciliation" (per
04-DATA-AND-STATE-SPEC.md's state-machine terminality) — no live human operator exists
in this harness, so this counts system-flagged-for-human-review outcomes, not
literally recorded human actions.

### 7. Time-to-Commit

**Definition:** over runs where \`committedAtMs\` is non-null (the run reached
"committed" at some point, even if a later phase moves it further, e.g. the disruption
fixture continues on to "repaired"), the count/mean/p95 of \`committedAtMs\`.

**Measured:** ${ttc ? `count=${ttc.count}, mean=${ttc.meanMs.toFixed(1)}ms, p95=${ttc.p95Ms}ms` : "null (no runs ever committed)"}.

**No external citation.** CommitOS's own measured stats are reported plainly with no
comparison claimed.

### 8. Recovery Success Rate

**Definition:** over runs where \`disruptionOutcome !== null\` (a
supplier-disruption-and-repair sequence actually ran, i.e. CASE-POST-COMMIT-DISRUPTION
runs only), the fraction where \`disruptionOutcome === "repaired"\`.

**Measured:** ${recovery ? `${pct(recovery.rate)} (${recovery.count} disruption runs)` : "null (no runs exercised disruption)"}.

**Qualitative architectural comparison only — no fabricated percentage.** Per an
explicit standing product decision, CommitOS's own measured number above is reported
plainly with its sample size; no percentage is compared against it, because Snowflake
has not published one for the comparable case. Snowflake's blog post on agentic AI
security states, regarding resilience: "capabilities such as WORM (write once, read
many) backups, point-in-time recovery and cross-region replication help support
recovery if something goes wrong" (Snowflake, "Agentic AI Security: Snowflake's
Data-Model-Agent Framework", https://www.snowflake.com/en/blog/securing-the-agentic-enterprise/)
— this post contains no recovery success-rate benchmark or percentage of any kind, so
none is being compared against. Separately, Snowflake's Cortex Agent versioning
documentation describes rollback in terms of reverting an agent's
configuration/version to a previously-committed named version
(https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-versioning) —
a fundamentally different recovery unit than CommitOS's, which is a live in-flight
*business transaction* (a specific deal case with already-consumed reservations and a
committed certificate) recovering via compensating actions (\`compensateCommitment\`)
and re-negotiation to a new terms version while the case is still open, not a system
administrator reverting which agent build is deployed. The comparison, stated plainly:
config/deployment rollback vs. runtime compensating-transaction recovery of an
in-flight business commitment — and CommitOS's number, unlike Snowflake's page, comes
with a stated, reproducible measurement methodology (this very harness) rather than no
published number at all.

## Limitations

- **Small sample size.** 30 total runs (10 per fixture) makes the percentile-based
  metrics (Latency p95, Time-to-Commit p95) indicative, not statistically rigorous —
  a nearest-rank p95 over 10 or 30 points is heavily influenced by a single outlier.
- **Hallucination Rate cannot be a genuine signal here.** A fully-scripted
  deterministic FakeModelGateway controls every citation the harness records, so a
  near-0% hallucination rate reflects the script's authorship, not a real LLM's
  behavior — restated briefly here per the metric's own doc-comment above.
- **The APQC/OTIF/τ-bench comparisons are context, not head-to-head equivalence
  claims.** Different domains, different populations, different measurement units;
  they are included to help a reader calibrate what "good" looks like in adjacent
  fields, not to claim CommitOS's numbers are directly comparable to them.
`;
}

async function main() {
  const runs: RunRecord[] = [];
  for (const fixture of ALL_FIXTURES) {
    for (let runIndex = 0; runIndex < RUNS_PER_FIXTURE; runIndex++) {
      const record = await runOnce(fixture, runIndex);
      runs.push(record);
      // eslint-disable-next-line no-console
      console.log(`[${fixture.fixtureId} run ${runIndex}] expected=${record.expectedTerminalState} actual=${record.actualTerminalState} elapsedMs=${record.elapsedMs}`);
    }
  }

  fs.mkdirSync(SUBMISSION_DIR, { recursive: true });
  writeCsv(runs);
  fs.writeFileSync(path.join(SUBMISSION_DIR, "evaluation-report.md"), buildReport(runs));

  console.log(`\nWrote ${runs.length} run records to submission/three-case-results.csv and submission/evaluation-report.md`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
