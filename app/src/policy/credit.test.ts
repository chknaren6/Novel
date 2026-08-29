import { describe, it, expect } from "vitest";
import { evaluateCreditPolicy } from "./credit";

const baseCustomer = {
  creditLimitMinor: 200_000_000, // Rs 20L (KNKK.KLIMK for CUST-1010 = 2,000,000 rupees)
  currentExposureMinor: 0,
  overdueReceivablesMinor: 0,
  allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"],
};

describe("evaluateCreditPolicy", () => {
  it("rejects NET_60 when it is not in the customer's allowed terms", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      paymentTerms: "NET_60",
      newExposureMinor: 147_000_000,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("PAYMENT_TERMS_NOT_ALLOWED");
  });

  it("approves ADVANCE_30 when the reduced exposure fits inside the credit limit", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      paymentTerms: "ADVANCE_30",
      newExposureMinor: 102_900_000, // 147L total minus 44.1L deposit
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBe("WITHIN_POLICY");
    expect(result.headroomMinor).toBe(200_000_000 - 102_900_000);
  });

  it("rejects when overdue receivables exist regardless of exposure", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      overdueReceivablesMinor: 1,
      paymentTerms: "ADVANCE_30",
      newExposureMinor: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("OVERDUE_RECEIVABLES_BLOCK");
  });

  it("rejects when exposure would exceed the credit limit", () => {
    const result = evaluateCreditPolicy({
      ...baseCustomer,
      paymentTerms: "ADVANCE_30",
      newExposureMinor: 250_000_000,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("CREDIT_LIMIT_EXCEEDED");
  });
});
