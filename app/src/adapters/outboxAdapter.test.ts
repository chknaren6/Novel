import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { sendBackedPromise, sendCorrection } from "./outboxAdapter";
import { fromJsonColumn } from "@/lib/json-column";
import { ToolError } from "@/lib/types";

describe("outboxAdapter", () => {
  beforeEach(resetTestDb);

  it("writes a backed promise message", async () => {
    const payload = { termsVersion: 2, checkoutUrl: "https://example.test/checkout" };
    const message = await sendBackedPromise(testDb, { caseId: "CASE-1", certificateId: "CERT-1", payload });
    expect(message.messageType).toBe("backed_promise");
    expect(fromJsonColumn(message.payload)).toEqual(payload);
  });

  it("links a correction to the original without deleting it", async () => {
    const original = await sendBackedPromise(testDb, { caseId: "CASE-1", certificateId: "CERT-1", payload: {} });
    const correction = await sendCorrection(testDb, { caseId: "CASE-1", certificateId: "CERT-2", correctsId: original.id, payload: { reason: "supplier disruption repaired" } });
    expect(correction.correctsId).toBe(original.id);

    const stillThere = await testDb.outboxMessage.findUniqueOrThrow({ where: { id: original.id } });
    expect(stillThere).toBeTruthy();
  });

  it("refuses to send a correction for a nonexistent correctsId", async () => {
    await expect(
      sendCorrection(testDb, { caseId: "CASE-1", certificateId: "CERT-1", correctsId: "does-not-exist", payload: {} }),
    ).rejects.toThrow(ToolError);
  });
});
