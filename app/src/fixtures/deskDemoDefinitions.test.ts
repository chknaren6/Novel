import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_DESK_COMMITTED, FIXTURE_DESK_NEGOTIATING, FIXTURE_DESK_CANNOT_COMMIT } from "@/fixtures/deskDemoDefinitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
// Scripts live in gateway/deskDemoScripts.ts (not duplicated here) so the exact same
// honest, test-verified role behavior is also available to demoModelGateway.ts for a
// real (non-test) local-preview gateway — see that module's own comment for why.
import { scriptForCommitted, scriptForNegotiating, scriptForCannotCommit } from "@/gateway/deskDemoScripts";

describe("desk demo fixtures reach their documented terminal state under honest role behavior", () => {
  beforeEach(resetTestDb);

  it("FIXTURE_DESK_COMMITTED reaches prepared (runDealSubmitted's own terminal state for a feasible-from-the-start case; the fixture's 'committed' label refers to the separate commit step run afterward)", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    const gateway = new FakeModelGateway(scriptForCommitted);

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-desk-committed", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("prepared");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("prepared");
  });

  it("FIXTURE_DESK_NEGOTIATING reaches negotiating with a 30% advance counteroffer", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_NEGOTIATING);
    const gateway = new FakeModelGateway(scriptForNegotiating);

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-desk-negotiating", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("negotiating");
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("negotiating");

    const v2 = await testDb.termsVersion.findFirstOrThrow({ where: { caseId: dealCase.id, version: 2 } });
    expect(v2.paymentTerms).toBe("ADVANCE_30");
  });

  it("FIXTURE_DESK_CANNOT_COMMIT reaches cannot_commit on the unresolved-domains branch (no supplier coverage exists for the 950-unit shortfall)", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_CANNOT_COMMIT);
    const gateway = new FakeModelGateway(scriptForCannotCommit);

    const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-desk-cannot-commit", buyerLinkSigningSecret: "test-secret" });

    expect(result.status).toBe("cannot_commit");
    if (result.status === "cannot_commit") {
      // Confirms this hits dealSubmitted.ts's early missingDomains hard-fail branch
      // (reason "unresolved_domains:supplier"), not the later
      // prepareCommitCertificate try/catch branch or a risk_veto.
      expect(result.reason).toBe("unresolved_domains:supplier");
    }
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("cannot_commit");
  });
});
