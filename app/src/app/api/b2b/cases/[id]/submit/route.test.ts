import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

vi.mock("@/lib/openaiClient", () => ({
  getOpenAIClient: () => ({ client: {}, modelId: "fake-model-v1", timeoutMs: 2000 }),
}));

// Gateway-mocking choice: OpenAIModelGateway's real implementation drives the OpenAI
// Chat Completions API in two distinct response shapes per role (a tool-round call,
// then a json_schema-constrained final-response call) — faithfully hand-rolling both
// shapes across six roles would mean reproducing a lot of OpenAI response-shape detail
// this test doesn't actually care about, and would duplicate roleModelOutputJsonSchema
// knowledge that belongs to openaiGateway.test.ts (if one exists), not here. The route
// also doesn't accept an injected ModelGateway — it always constructs
// `new OpenAIModelGateway(client, modelId)` itself — so there is no seam to hand it a
// FakeModelGateway directly. Instead, the "@/gateway/openaiGateway" module itself is
// mocked: the mocked OpenAIModelGateway ignores its (fake, unused) client argument and
// delegates to the real FakeModelGateway (src/gateway/fakeGateway.ts), driven by the
// same honest-evidence script deskDemoDefinitions.test.ts already proves reaches
// "prepared" for FIXTURE_DESK_COMMITTED. This exercises the real tool `execute`
// functions and the real evaluateAndRoute/runCommit logic end-to-end, exactly like that
// existing test, without inventing a parallel raw-OpenAI-response fixture or asserting
// blindly on a hand-waved fake gateway.
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({
  decision: "approve",
  constraints: [],
  reservationRequests: [],
  counterterms: [],
  evidenceRefs,
  explanation,
});

// Mirrors deskDemoDefinitions.test.ts's scriptForCommitted: FIXTURE_DESK_COMMITTED's
// numbers (ADVANCE_30 from the start, on-hand inventory alone covers the full 40-unit
// request) are engineered so every role's *honest* read of the real fixture data
// approves, and evaluateAndRoute reaches "prepared" -> runB2BEvaluation auto-commits it.
const scriptForCommitted: FakeRoleScript = (input: RoleRunInput) => {
  switch (input.role) {
    case "sales":
      return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
    case "finance":
      return {
        toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 9_800_000, ttlSeconds: 900 } },
        output: APPROVE(["EVID-FIN"], "30% advance keeps exposure well within the Rs 10L limit."),
      };
    case "inventory":
      return {
        toolCall: { name: "hold_inventory", args: { warehouseId: "WH-DESK-1", quantity: 40, ttlSeconds: 900 } },
        output: APPROVE(["EVID-INV"], "Full 40 units available from WH-DESK-1."),
      };
    case "procurement":
      return {
        toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-DESK-1", quantity: 40, maxUnitCostMinor: 300_000, maxLeadDays: 10, ttlSeconds: 900 } },
        output: APPROVE(["EVID-PROC"], "VEND-DESK-1 option held as a hedge, without knowing inventory already covers the request."),
      };
    case "logistics":
      return {
        toolCall: { name: "hold_delivery_slot", args: { planId: "RT-DESK-1", quantity: 40, ttlSeconds: 900 } },
        output: APPROVE(["EVID-LOG"], "RT-DESK-1 delivers the full 40 units in 5 days, inside the 21-day deadline."),
      };
    case "risk":
    default:
      return { toolCall: null, output: APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
  }
};

vi.mock("@/gateway/openaiGateway", () => ({
  OpenAIModelGateway: class {
    private readonly fake = new FakeModelGateway(scriptForCommitted);
    constructor(_client: unknown, _modelId: string) {}
    runRole(input: RoleRunInput) {
      return this.fake.runRole(input);
    }
  },
}));

import { testDb, resetTestDb } from "@/lib/testDb";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_DESK_COMMITTED } from "@/fixtures/deskDemoDefinitions";
import { POST } from "./route";

const SIGNING_SECRET = "test-secret";

describe("POST /api/b2b/cases/[id]/submit", () => {
  beforeEach(async () => {
    await resetTestDb();
    process.env.BUYER_LINK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("evaluates a feasible-from-the-start case and auto-commits it", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    const request = new Request(`http://localhost/api/b2b/cases/${dealCase.id}/submit`, { method: "POST" });

    const response = await POST(request, { params: { id: dealCase.id } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.status).toBe("committed");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
  });

  it("returns a 400 client error, not a 500, when the case is not in \"intake\" status", async () => {
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    // Move the case away from "intake" first, the same way b2b/cases/route.test.ts's
    // "excludes a case that has moved past intake" test does.
    await testDb.dealCase.update({ where: { id: dealCase.id }, data: { status: "evaluating" } });

    const request = new Request(`http://localhost/api/b2b/cases/${dealCase.id}/submit`, { method: "POST" });
    const response = await POST(request, { params: { id: dealCase.id } });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("STALE_CASE_VERSION");

    // State was not corrupted: the case is left exactly where it was, not silently
    // shifted or committed on a wrong-status resubmit.
    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("evaluating");
  });

  it("returns 500 when BUYER_LINK_SIGNING_SECRET is not set", async () => {
    delete process.env.BUYER_LINK_SIGNING_SECRET;
    const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_COMMITTED);
    const request = new Request(`http://localhost/api/b2b/cases/${dealCase.id}/submit`, { method: "POST" });

    const response = await POST(request, { params: { id: dealCase.id } });
    expect(response.status).toBe(500);
  });
});
