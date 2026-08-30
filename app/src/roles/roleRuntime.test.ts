// src/roles/roleRuntime.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { runRoleAgent } from "./roleRuntime";
import { FakeModelGateway } from "@/gateway/fakeGateway";
import type { ModelGateway } from "@/gateway/modelGateway";
import { fromJsonColumn } from "@/lib/json-column";

async function seedCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" } });
  await testDb.termsVersion.create({ data: { caseId: dealCase.id, version: 1, source: "buyer_request", termsHash: "hash-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, discountBps: 1000, paymentTerms: "NET_60", deliveryDeadline: new Date("2026-09-12") } });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 199 } });
  return dealCase;
}

const baseInput = (dealCase: { id: string }) => ({
  role: "inventory" as const,
  caseId: dealCase.id,
  caseVersion: 1,
  termsHash: "hash-1",
  contextSummary: { requestedQuantity: 350 },
  toolContext: { customerId: "CUST-1", sku: "MAT-10001", destinationId: "ZONE-SOUTH", paymentTerms: "NET_60" as const },
  traceId: "trace-1",
  timeoutMs: 200,
});

describe("runRoleAgent", () => {
  beforeEach(resetTestDb);

  it("executes the role's scoped mutation tool and persists a DomainDecision", async () => {
    const dealCase = await seedCase();
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 600 } },
      output: { decision: "counter", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: ["EVID-1"], explanation: "Can only cover 199 of 350 units." },
    }));

    const decision = await runRoleAgent(testDb, gateway, baseInput(dealCase), "fake-model-v1");
    expect(decision.role).toBe("inventory");
    expect(decision.decision).toBe("counter");
    expect(decision.caseId).toBe(dealCase.id);

    const stored = await testDb.domainDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(stored.role).toBe("inventory");

    const reservation = await testDb.reservation.findFirstOrThrow({ where: { caseId: dealCase.id, domain: "inventory" } });
    expect(reservation.quantityMinor).toBe(199);
  });

  it("round-trips payload and evidenceRefs through the JSON-column helpers", async () => {
    const dealCase = await seedCase();
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 600 } },
      output: { decision: "counter", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: ["EVID-1"], explanation: "Can only cover 199 of 350 units." },
    }));

    const decision = await runRoleAgent(testDb, gateway, baseInput(dealCase), "fake-model-v1");
    const stored = await testDb.domainDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });

    expect(fromJsonColumn<string[]>(stored.evidenceRefs)).toEqual(["EVID-1"]);
    const payload = fromJsonColumn<typeof decision>(stored.payload);
    expect(payload.decision).toBe("counter");
    expect(payload.explanation).toBe("Can only cover 199 of 350 units.");
    expect(payload.decisionId).toBe(decision.decisionId);
  });

  it("marks the role unavailable and still persists a decision when the gateway never responds", async () => {
    const dealCase = await seedCase();
    let calls = 0;
    const neverRespondingGateway: ModelGateway = {
      runRole: () => {
        calls++;
        return new Promise(() => {});
      },
    };

    const decision = await runRoleAgent(testDb, neverRespondingGateway, baseInput(dealCase), "fake-model-v1");
    expect(decision.decision).toBe("unavailable");
    // Confirms runRoleAgent actually retried once (attempt + one retry = 2 calls), not
    // that it simply gave up after the first timeout.
    expect(calls).toBe(2);

    const stored = await testDb.domainDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(stored.decision).toBe("unavailable");
  }, 10_000);

  it("recovers on retry: persists the second attempt's decision after the first attempt times out", async () => {
    const dealCase = await seedCase();
    let calls = 0;
    const fakeGateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_inventory", args: { warehouseId: "WH-BLR", quantity: 199, ttlSeconds: 600 } },
      output: { decision: "counter", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: ["EVID-1"], explanation: "Recovered on retry." },
    }));
    const gateway: ModelGateway = {
      runRole: (input) => {
        calls++;
        // First attempt never resolves, forcing the timeout path; second attempt
        // delegates to a real FakeModelGateway run so the retry's own output (not the
        // "unavailable" fallback) is what gets persisted.
        if (calls === 1) return new Promise(() => {});
        return fakeGateway.runRole(input);
      },
    };

    const decision = await runRoleAgent(testDb, gateway, baseInput(dealCase), "fake-model-v1");
    expect(calls).toBe(2);
    expect(decision.decision).toBe("counter");
    expect(decision.explanation).toBe("Recovered on retry.");

    const stored = await testDb.domainDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(stored.decision).toBe("counter");
  }, 10_000);
});
