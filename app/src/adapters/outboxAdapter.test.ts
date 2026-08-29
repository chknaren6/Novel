import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { sendBackedPromise, sendCorrection } from "./outboxAdapter";

describe("outboxAdapter", () => {
  beforeEach(resetTestDb);

  it("writes a backed promise message", async () => {
    const message = await sendBackedPromise(testDb, { caseId: "CASE-1", certificateId: "CERT-1", payload: { termsVersion: 2, checkoutUrl: "https://example.test/checkout" } });
    expect(message.messageType).toBe("backed_promise");
  });

  it("links a correction to the original without deleting it", async () => {
    const original = await sendBackedPromise(testDb, { caseId: "CASE-1", certificateId: "CERT-1", payload: {} });
    const correction = await sendCorrection(testDb, { caseId: "CASE-1", certificateId: "CERT-2", correctsId: original.id, payload: { reason: "supplier disruption repaired" } });
    expect(correction.correctsId).toBe(original.id);

    const stillThere = await testDb.outboxMessage.findUniqueOrThrow({ where: { id: original.id } });
    expect(stillThere).toBeTruthy();
  });
});
