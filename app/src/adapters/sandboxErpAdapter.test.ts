import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createSandboxOrder, markSandboxOrderRepairPending, markSandboxOrderRepaired, updateCrmStage } from "./sandboxErpAdapter";
import { ToolError } from "@/lib/types";

describe("sandboxErpAdapter", () => {
  beforeEach(resetTestDb);

  it("creates a sandbox order", async () => {
    const order = await createSandboxOrder(testDb, { caseId: "CASE-1", certificateId: "CERT-1", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000 });
    expect(order.status).toBe("accepted");
  });

  it("throws when marking repair-pending for a case with no sandbox order", async () => {
    await expect(markSandboxOrderRepairPending(testDb, "CASE-DOES-NOT-EXIST")).rejects.toThrow(ToolError);
  });

  it("throws when marking repaired for a case with no sandbox order", async () => {
    await expect(markSandboxOrderRepaired(testDb, "CASE-DOES-NOT-EXIST", "CERT-NEW")).rejects.toThrow(ToolError);
  });

  it("appends a CRM stage event without deleting prior history", async () => {
    await updateCrmStage(testDb, { caseId: "CASE-1", stage: "quote_sent", note: "Initial normalization" });
    await updateCrmStage(testDb, { caseId: "CASE-1", stage: "committed", note: "Certificate consumed" });
    const events = await testDb.crmStageEvent.findMany({ where: { caseId: "CASE-1" }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.stage)).toEqual(["quote_sent", "committed"]);
  });
});
