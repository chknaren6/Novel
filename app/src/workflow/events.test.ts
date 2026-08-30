// src/workflow/events.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { emitCaseEvent } from "./events";

describe("emitCaseEvent", () => {
  beforeEach(resetTestDb);

  it("assigns a strictly increasing sequence per case", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });

    const first = await emitCaseEvent(testDb, {
      caseId: dealCase.id,
      eventType: "deal.submitted",
      caseVersion: 1,
      actorType: "operator",
      actorRef: "seed",
      payload: { note: "first" },
      traceId: "trace-1",
    });
    const second = await emitCaseEvent(testDb, {
      caseId: dealCase.id,
      eventType: "finance.decided",
      caseVersion: 1,
      actorType: "agent",
      actorRef: "finance",
      payload: { note: "second" },
      traceId: "trace-1",
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
  });

  it("keeps sequences independent across cases", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const caseA = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "C-A", activeTermsVersion: 1, status: "intake", createdBy: "seed" } });
    const caseB = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "C-B", activeTermsVersion: 1, status: "intake", createdBy: "seed" } });

    const a1 = await emitCaseEvent(testDb, { caseId: caseA.id, eventType: "deal.submitted", caseVersion: 1, actorType: "operator", actorRef: "seed", payload: {}, traceId: "t" });
    const b1 = await emitCaseEvent(testDb, { caseId: caseB.id, eventType: "deal.submitted", caseVersion: 1, actorType: "operator", actorRef: "seed", payload: {}, traceId: "t" });

    expect(a1.sequence).toBe(1);
    expect(b1.sequence).toBe(1);
  });
});
