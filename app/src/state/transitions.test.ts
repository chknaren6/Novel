// src/state/transitions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { assertValidTransition, transitionCase, InvalidTransitionError } from "./transitions";
import { ToolError } from "@/lib/types";

describe("assertValidTransition", () => {
  it("allows the documented happy-path transitions", () => {
    expect(() => assertValidTransition("intake", "evaluating")).not.toThrow();
    expect(() => assertValidTransition("evaluating", "negotiating")).not.toThrow();
    expect(() => assertValidTransition("negotiating", "evaluating")).not.toThrow();
    expect(() => assertValidTransition("evaluating", "prepared")).not.toThrow();
    expect(() => assertValidTransition("prepared", "committing")).not.toThrow();
    expect(() => assertValidTransition("committing", "committed")).not.toThrow();
    expect(() => assertValidTransition("committed", "repair_needed")).not.toThrow();
    expect(() => assertValidTransition("repair_needed", "compensating")).not.toThrow();
    expect(() => assertValidTransition("compensating", "repaired")).not.toThrow();
  });

  it("rejects an arbitrary status update", () => {
    expect(() => assertValidTransition("intake", "committed")).toThrow(InvalidTransitionError);
    expect(() => assertValidTransition("cannot_commit", "evaluating")).toThrow(InvalidTransitionError);
  });

  it("only allows evaluating -> repaired when explicitly processing a repair version", () => {
    expect(() => assertValidTransition("evaluating", "repaired")).toThrow(InvalidTransitionError);
    expect(() => assertValidTransition("evaluating", "repaired", { isRepairVersion: true })).not.toThrow();
  });
});

describe("transitionCase", () => {
  beforeEach(resetTestDb);

  it("updates status only when the expected status and version both match", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "intake", createdBy: "seed" },
    });

    await transitionCase(testDb, { caseId: dealCase.id, expectedStatus: "intake", expectedVersion: 1, nextStatus: "evaluating" });

    const reloaded = await testDb.dealCase.findUniqueOrThrow({ where: { id: dealCase.id } });
    expect(reloaded.status).toBe("evaluating");
  });

  it("throws STALE_CASE_VERSION when the current status no longer matches", async () => {
    const company = await testDb.company.create({ data: { name: "Acme" } });
    const dealCase = await testDb.dealCase.create({
      data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" },
    });

    await expect(
      transitionCase(testDb, { caseId: dealCase.id, expectedStatus: "intake", expectedVersion: 1, nextStatus: "evaluating" }),
    ).rejects.toThrow(ToolError);
  });
});
