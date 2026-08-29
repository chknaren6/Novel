import type { PaymentTerms } from "@/lib/types";

export interface CreditPolicyInput {
  creditLimitMinor: number;
  currentExposureMinor: number;
  overdueReceivablesMinor: number;
  allowedPaymentTerms: string[];
  paymentTerms: PaymentTerms;
  newExposureMinor: number; // DealEconomics.creditExposureMinor for the proposed terms
}

export type CreditPolicyCode =
  | "WITHIN_POLICY"
  | "PAYMENT_TERMS_NOT_ALLOWED"
  | "CREDIT_LIMIT_EXCEEDED"
  | "OVERDUE_RECEIVABLES_BLOCK";

export interface CreditPolicyResult {
  passed: boolean;
  code: CreditPolicyCode;
  totalExposureMinor: number;
  headroomMinor: number;
}

export function evaluateCreditPolicy(input: CreditPolicyInput): CreditPolicyResult {
  if (input.overdueReceivablesMinor > 0) {
    return {
      passed: false,
      code: "OVERDUE_RECEIVABLES_BLOCK",
      totalExposureMinor: input.currentExposureMinor,
      headroomMinor: input.creditLimitMinor - input.currentExposureMinor,
    };
  }
  if (!input.allowedPaymentTerms.includes(input.paymentTerms)) {
    return {
      passed: false,
      code: "PAYMENT_TERMS_NOT_ALLOWED",
      totalExposureMinor: input.currentExposureMinor,
      headroomMinor: input.creditLimitMinor - input.currentExposureMinor,
    };
  }
  const totalExposureMinor = input.currentExposureMinor + input.newExposureMinor;
  const headroomMinor = input.creditLimitMinor - totalExposureMinor;
  if (headroomMinor < 0) {
    return { passed: false, code: "CREDIT_LIMIT_EXCEEDED", totalExposureMinor, headroomMinor };
  }
  return { passed: true, code: "WITHIN_POLICY", totalExposureMinor, headroomMinor };
}
