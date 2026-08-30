import { z } from "zod";

export const RoleIdSchema = z.enum([
  "sales",
  "finance",
  "inventory",
  "procurement",
  "logistics",
  "risk",
]);
export type RoleId = z.infer<typeof RoleIdSchema>;

export const DecisionSchema = z.enum(["approve", "counter", "veto", "unavailable"]);
export type Decision = z.infer<typeof DecisionSchema>;

export const ReservationDomainSchema = z.enum(["credit", "inventory", "supplier", "logistics"]);
export type ReservationDomain = z.infer<typeof ReservationDomainSchema>;

export const ReservationStatusSchema = z.enum([
  "requested",
  "held",
  "committed",
  "released",
  "expired",
  "failed",
]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const CertificateStatusSchema = z.enum([
  "draft",
  "valid",
  "consumed",
  "broken",
  "compensated",
  "superseded",
]);
export type CertificateStatus = z.infer<typeof CertificateStatusSchema>;

export const ReceiptStatusSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "compensation_pending",
  "compensated",
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const ReceiptProviderSchema = z.enum([
  "sandbox_erp",
  "sandbox_crm",
  "inventory",
  "supplier",
  "logistics",
  "stripe",
  "outbox",
]);
export type ReceiptProvider = z.infer<typeof ReceiptProviderSchema>;

export const CaseStatusSchema = z.enum([
  "intake",
  "evaluating",
  "negotiating",
  "prepared",
  "committing",
  "committed",
  "cannot_commit",
  "aborting",
  "repair_needed",
  "compensating",
  "repaired",
  "escalated",
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const PaymentTermsSchema = z.enum(["NET_60", "ADVANCE_30", "OTHER_BOUNDED"]);
export type PaymentTerms = z.infer<typeof PaymentTermsSchema>;

export const TermsSourceSchema = z.enum([
  "buyer_request",
  "sales_normalization",
  "counteroffer",
  "buyer_acceptance",
  "repair",
]);
export type TermsSource = z.infer<typeof TermsSourceSchema>;

export const CounterofferStatusSchema = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);
export type CounterofferStatus = z.infer<typeof CounterofferStatusSchema>;

export const ToolErrorCodeSchema = z.enum([
  "FORBIDDEN_TOOL",
  "STALE_CASE_VERSION",
  "TERMS_HASH_MISMATCH",
  "RESOURCE_UNAVAILABLE",
  "POLICY_VIOLATION",
  "RESERVATION_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "PROVIDER_UNAVAILABLE",
  "INVALID_INPUT",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export class ToolError extends Error {
  code: ToolErrorCode;
  retryable: boolean;
  evidenceRefs: string[];
  constructor(code: ToolErrorCode, message: string, retryable: boolean, evidenceRefs: string[] = []) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.evidenceRefs = evidenceRefs;
  }
}

const ConstraintFindingSchema = z.object({
  domain: RoleIdSchema,
  code: z.string(),
  severity: z.enum(["info", "blocking"]),
  message: z.string(),
  evidenceRefs: z.array(z.string()),
});
export type ConstraintFinding = z.infer<typeof ConstraintFindingSchema>;

const ReservationRequestSchema = z.object({
  domain: ReservationDomainSchema,
  resourceRef: z.string(),
  quantity: z.number().int().nullable(),
  limitMinor: z.number().int().nullable(),
  ttlSeconds: z.number().int().positive(),
});
export type ReservationRequest = z.infer<typeof ReservationRequestSchema>;

const CountertermSchema = z.object({
  field: z.enum(["payment_terms", "quantity", "delivery_deadline", "discount_bps"]),
  proposedValue: z.string(),
  rationale: z.string(),
});
export type Counterterm = z.infer<typeof CountertermSchema>;

// What a role agent (real or fake) is allowed to produce. Every other DomainDecision
// field is assigned by server code, never trusted from the model.
export const RoleModelOutputSchema = z.object({
  decision: DecisionSchema,
  constraints: z.array(ConstraintFindingSchema),
  reservationRequests: z.array(ReservationRequestSchema),
  counterterms: z.array(CountertermSchema),
  evidenceRefs: z.array(z.string()),
  explanation: z.string(),
});
export type RoleModelOutput = z.infer<typeof RoleModelOutputSchema>;

export const DomainDecisionSchema = RoleModelOutputSchema.extend({
  decisionId: z.string(),
  caseId: z.string(),
  caseVersion: z.number().int(),
  termsHash: z.string(),
  role: RoleIdSchema,
  expiresAt: z.string(),
});
export type DomainDecision = z.infer<typeof DomainDecisionSchema>;

export interface DealTerms {
  sku: string;
  quantity: number;
  currency: "INR";
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: PaymentTerms;
  deliveryDeadline: string;
}

export interface Evidence<T> {
  evidenceId: string;
  observedAt: string;
  source: string;
  data: T;
}

export interface MutationReceipt<T> {
  receiptId: string;
  idempotencyKey: string;
  status: "succeeded" | "failed";
  providerRef: string | null;
  occurredAt: string;
  data: T;
}
