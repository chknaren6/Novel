import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

vi.mock("@/lib/openaiClient", () => ({
  getOpenAIClient: () => ({ client: { chat: { completions: { create: mockCreate } } }, modelId: "gpt-5-nano", timeoutMs: 30_000 }),
}));

import { testDb, resetTestDb } from "@/lib/testDb";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { seedFixture } from "@/fixtures/seedFixture";
import { FIXTURE_DESK_NEGOTIATING } from "@/fixtures/deskDemoDefinitions";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { RoleRunInput } from "@/gateway/modelGateway";
import type { FakeRoleScript } from "@/gateway/fakeGateway";
import type { RoleModelOutput } from "@/lib/types";
import { POST } from "./route";

const SIGNING_SECRET = "test-secret";

const APPROVE = (evidenceRefs: string[], explanation: string): RoleModelOutput => ({ decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs, explanation });

// Same shape as deskDemoDefinitions.test.ts's scriptForNegotiating (used to drive
// FIXTURE_DESK_NEGOTIATING to "negotiating" below) and runB2BCounterofferResponse.test.ts's
// own scriptFor (used there to prove the exact same "counter on NET_60, approve on
// ADVANCE_30" shape re-evaluates cleanly to committed) — combined here into one
// paymentTerms-parameterized script over FIXTURE_DESK_NEGOTIATING's own domain data
// (SKU-DESK-MCB-32A / WH-DESK-2 / VEND-DESK-2 / RT-DESK-2), so the same function scripts
// both the pre-accept (NET_60, counters) and post-accept (ADVANCE_30, approves) calls.
function scriptForDeskNegotiating(paymentTerms: string): FakeRoleScript {
  return (input: RoleRunInput) => {
    switch (input.role) {
      case "sales":
        return { toolCall: null, output: APPROVE(["EVID-SALES"], "Normalized buyer request.") };
      case "finance":
        if (paymentTerms === "NET_60") {
          return {
            toolCall: null,
            output: {
              decision: "counter" as const,
              constraints: [{ domain: "finance" as const, code: "CREDIT_POLICY_BREACH", severity: "blocking" as const, message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-FIN"] }],
              reservationRequests: [],
              counterterms: [{ field: "payment_terms" as const, proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy; a 30% advance would pass." }],
              evidenceRefs: ["EVID-FIN"],
              explanation: "Net-60 pushes total exposure to Rs 22.13L, over the Rs 20L limit; 30% advance would pass.",
            },
          };
        }
        return { toolCall: { name: "hold_credit_envelope", args: { exposureMinor: 102_900_000, ttlSeconds: 900 } }, output: APPROVE(["EVID-FIN"], "30% advance keeps exposure within the Rs 20L limit.") };
      case "inventory":
        return { toolCall: { name: "hold_inventory", args: { warehouseId: "WH-DESK-2", quantity: 199, ttlSeconds: 900 } }, output: { ...APPROVE(["EVID-INV"], "Only 199 of 350 units currently available."), decision: "counter" } };
      case "procurement":
        return { toolCall: { name: "hold_supplier_option", args: { supplierId: "VEND-DESK-2", quantity: 151, maxUnitCostMinor: 300_000, maxLeadDays: 21, ttlSeconds: 900 } }, output: APPROVE(["EVID-PROC"], "VEND-DESK-2 option covers the 151-unit shortfall.") };
      case "logistics":
        return { toolCall: { name: "hold_delivery_slot", args: { planId: "RT-DESK-2", quantity: 350, ttlSeconds: 900 } }, output: APPROVE(["EVID-LOG"], "Split shipment meets the 21-day deadline.") };
      case "risk":
      default:
        return { toolCall: null, output: APPROVE(["EVID-RISK"], "Evidence is fresh and coverage matches decisions.") };
    }
  };
}

// Adapts a FakeRoleScript into a raw OpenAI chat-completions mock, so the exact same
// scripted decisions used above (against FakeModelGateway) can also drive the route's
// real OpenAIModelGateway (via a mocked @/lib/openaiClient) for the post-accept
// re-evaluation. Role is recovered from the system prompt (buildSystemPrompt always
// starts "You are the <role> role agent...", src/roles/roleConfigs.ts); tool-round vs.
// final-round is recovered from whether `tools` was offered on this call (every role
// has at least one read tool, so every role makes exactly two calls: a tool round, then
// a final response_format=json_schema round — src/gateway/openaiGateway.ts).
function mockCreateFromScript(script: FakeRoleScript) {
  return vi.fn(async (params: { messages: Array<{ content: unknown }>; tools?: unknown[] }) => {
    const systemContent = String(params.messages[0]?.content ?? "");
    const match = systemContent.match(/You are the (\w+) role agent/);
    if (!match) throw new Error(`mockCreateFromScript: could not determine role from system prompt: ${systemContent}`);
    const role = match[1] as RoleRunInput["role"];
    const scripted = script({ role } as RoleRunInput);

    if (params.tools) {
      const toolCalls = scripted.toolCall
        ? [{ id: `call-${role}`, type: "function" as const, function: { name: scripted.toolCall.name, arguments: JSON.stringify(scripted.toolCall.args) } }]
        : [];
      return { id: `resp-${role}-tool`, choices: [{ message: { role: "assistant", content: null, tool_calls: toolCalls } }] };
    }
    return { id: `resp-${role}-final`, choices: [{ message: { role: "assistant", content: JSON.stringify(scripted.output) } }] };
  });
}

// Drives FIXTURE_DESK_NEGOTIATING to "negotiating" via the same path a real B2B
// submission takes, capturing the real buyerToken createCounteroffer produced.
async function seedNegotiatingCase() {
  const { dealCase } = await seedFixture(testDb, FIXTURE_DESK_NEGOTIATING);
  const gateway = new FakeModelGateway(scriptForDeskNegotiating("NET_60"));
  const result = await runDealSubmitted(testDb, gateway, { caseId: dealCase.id, modelId: "fake-model-v1", timeoutMs: 2000, traceId: "trace-1", buyerLinkSigningSecret: SIGNING_SECRET });
  if (result.status !== "negotiating") throw new Error(`expected negotiating, got ${result.status}`);
  return { dealCase, buyerToken: result.buyerToken };
}

describe("POST /api/b2b/cases/[id]/respond", () => {
  beforeEach(async () => {
    await resetTestDb();
    mockCreate.mockReset();
    process.env.BUYER_LINK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("accepts a counteroffer and returns a committed result", async () => {
    const { dealCase, buyerToken } = await seedNegotiatingCase();
    mockCreate.mockImplementation(mockCreateFromScript(scriptForDeskNegotiating("ADVANCE_30")));

    const request = new Request(`http://localhost/api/b2b/cases/${dealCase.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ buyerToken, response: "accept" }),
    });
    const response = await POST(request, { params: { id: dealCase.id } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.status).toBe("committed");

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("committed");
    expect(reloaded.activeTermsVersion).toBe(2);
  });

  it("returns 400 for an invalid response value", async () => {
    const request = new Request("http://localhost/api/b2b/cases/x/respond", { method: "POST", body: JSON.stringify({ buyerToken: "t", response: "maybe" }) });
    const response = await POST(request, { params: { id: "x" } });
    expect(response.status).toBe(400);
  });

  it("returns 400 when buyerToken is missing", async () => {
    const request = new Request("http://localhost/api/b2b/cases/x/respond", { method: "POST", body: JSON.stringify({ response: "accept" }) });
    const response = await POST(request, { params: { id: "x" } });
    expect(response.status).toBe(400);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const request = new Request("http://localhost/api/b2b/cases/x/respond", { method: "POST", body: "not-json{{{" });
    const response = await POST(request, { params: { id: "x" } });
    expect(response.status).toBe(400);
  });
});
