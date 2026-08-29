import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { createDepositCheckout, expireCheckout } from "./stripeMockAdapter";
import { ToolError } from "@/lib/types";

describe("stripeMockAdapter", () => {
  beforeEach(resetTestDb);

  it("creates a checkout session for the deposit amount", async () => {
    const checkout = await createDepositCheckout(testDb, { caseId: "CASE-1", certificateId: "CERT-1", amountMinor: 44_100_000 });
    expect(checkout.status).toBe("created");
    expect(checkout.amountMinor).toBe(44_100_000);
  });

  it("expires a created checkout idempotently", async () => {
    const checkout = await createDepositCheckout(testDb, { caseId: "CASE-1", certificateId: "CERT-1", amountMinor: 44_100_000 });
    const expired = await expireCheckout(testDb, checkout.id);
    const expiredAgain = await expireCheckout(testDb, checkout.id);
    expect(expired.status).toBe("expired");
    expect(expiredAgain.status).toBe("expired");
    // Guards against a future refactor that accidentally does a full-object overwrite
    // instead of a partial update.
    expect(expired.amountMinor).toBe(44_100_000);
    expect(expired.caseId).toBe("CASE-1");
    expect(expired.certificateId).toBe("CERT-1");
  });

  it("refuses to expire a completed checkout (no test-mode refund path in this build)", async () => {
    const checkout = await createDepositCheckout(testDb, { caseId: "CASE-1", certificateId: "CERT-1", amountMinor: 44_100_000 });
    await testDb.stripeCheckoutMock.update({ where: { id: checkout.id }, data: { status: "completed" } });
    await expect(expireCheckout(testDb, checkout.id)).rejects.toThrow(ToolError);
  });
});
