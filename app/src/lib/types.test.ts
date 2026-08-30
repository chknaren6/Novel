import { describe, it, expect } from "vitest";
import { RoleModelOutputSchema, DomainDecisionSchema, RoleIdSchema, PaymentTermsSchema } from "./types";

describe("RoleIdSchema", () => {
  it("accepts the six locked roles and rejects others", () => {
    for (const role of ["sales", "finance", "inventory", "procurement", "logistics", "risk"]) {
      expect(RoleIdSchema.parse(role)).toBe(role);
    }
    expect(() => RoleIdSchema.parse("marketing")).toThrow();
  });
});

describe("RoleModelOutputSchema", () => {
  it("accepts a minimal valid model output", () => {
    const parsed = RoleModelOutputSchema.parse({
      decision: "approve",
      constraints: [],
      reservationRequests: [],
      counterterms: [],
      evidenceRefs: ["EVID-1"],
      explanation: "Stock covers the request.",
    });
    expect(parsed.decision).toBe("approve");
  });

  it("rejects a decision value outside the enum", () => {
    expect(() =>
      RoleModelOutputSchema.parse({
        decision: "maybe",
        constraints: [],
        reservationRequests: [],
        counterterms: [],
        evidenceRefs: [],
        explanation: "",
      }),
    ).toThrow();
  });
});

describe("DomainDecisionSchema", () => {
  it("extends RoleModelOutput with server-assigned identity fields", () => {
    const parsed = DomainDecisionSchema.parse({
      decisionId: "DEC-1",
      caseId: "CASE-1",
      caseVersion: 1,
      termsHash: "hash-1",
      role: "finance",
      decision: "veto",
      constraints: [
        { domain: "finance", code: "CREDIT_POLICY_BREACH", severity: "blocking", message: "Net-60 exceeds policy.", evidenceRefs: ["EVID-2"] },
      ],
      reservationRequests: [],
      counterterms: [{ field: "payment_terms", proposedValue: "ADVANCE_30", rationale: "Net-60 breaches credit policy." }],
      evidenceRefs: ["EVID-2"],
      expiresAt: new Date().toISOString(),
      explanation: "Net-60 breaches credit policy; 30% advance is within policy.",
    });
    expect(parsed.role).toBe("finance");
  });
});

describe("PaymentTermsSchema", () => {
  it("accepts the existing B2B terms plus the new B2C variable-advance term", () => {
    for (const term of ["NET_60", "ADVANCE_30", "OTHER_BOUNDED", "ADVANCE_VARIABLE"]) {
      expect(PaymentTermsSchema.parse(term)).toBe(term);
    }
    expect(() => PaymentTermsSchema.parse("NET_90")).toThrow();
  });
});
