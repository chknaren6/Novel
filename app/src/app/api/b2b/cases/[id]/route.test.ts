import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { testDb } = await import("@/lib/testDb");
  return { db: testDb };
});

import { testDb, resetTestDb } from "@/lib/testDb";
import { toJsonColumn } from "@/lib/json-column";
import { GET } from "./route";

async function makeCase(overrides: { status: string; activeTermsVersion?: number }) {
  const company = await testDb.company.create({ data: { name: "Aravali Electricals" } });
  const customer = await testDb.customer.create({
    data: {
      companyId: company.id,
      name: "Krishna Hardware",
      creditLimitMinor: 200_000_000,
      currentExposureMinor: 0,
      overdueReceivablesMinor: 0,
      allowedPaymentTerms: toJsonColumn(["ADVANCE_30", "NET_60"]),
      policyVersion: "credit-policy-v1",
    },
  });
  const activeTermsVersion = overrides.activeTermsVersion ?? 1;
  const dealCase = await testDb.dealCase.create({
    data: { companyId: company.id, customerId: customer.id, channel: "b2b", activeTermsVersion, status: overrides.status, createdBy: "test" },
  });
  await testDb.termsVersion.create({
    data: {
      caseId: dealCase.id,
      version: 1,
      source: "buyer_request",
      termsHash: "hash-1",
      sku: "SKU-DESK-1",
      quantity: 40,
      totalValueMinor: 14_000_000,
      discountBps: 0,
      paymentTerms: "NET_60",
      deliveryDeadline: new Date(),
    },
  });
  return { company, customer, dealCase };
}

function decisionRow(caseId: string, caseVersion: number, role: string, decision: string) {
  return testDb.domainDecision.create({
    data: {
      caseId,
      caseVersion,
      termsHash: "hash-1",
      role,
      decision,
      payload: toJsonColumn({
        decisionId: `dec-${role}`,
        caseId,
        caseVersion,
        termsHash: "hash-1",
        role,
        decision,
        constraints: [],
        reservationRequests: [],
        counterterms: [],
        evidenceRefs: [`evidence-${role}`],
        explanation: `${role} explanation`,
        expiresAt: new Date().toISOString(),
      }),
      evidenceRefs: toJsonColumn([`evidence-${role}`]),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      modelId: "test-model",
      traceId: "trace-1",
    },
  });
}

describe("GET /api/b2b/cases/[id]", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns 404 for an unknown case id", async () => {
    const response = await GET(new Request("http://localhost/api/b2b/cases/nonexistent"), { params: { id: "nonexistent" } });
    expect(response.status).toBe(404);
  });

  it("surfaces partial per-role progress mid-evaluation, plus customer/company names", async () => {
    const { dealCase, customer, company } = await makeCase({ status: "evaluating" });
    await decisionRow(dealCase.id, 1, "sales", "approve");
    await decisionRow(dealCase.id, 1, "finance", "approve");
    await decisionRow(dealCase.id, 1, "inventory", "counter");

    const response = await GET(new Request(`http://localhost/api/b2b/cases/${dealCase.id}`), { params: { id: dealCase.id } });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.customerName).toBe(customer.name);
    expect(body.companyName).toBe(company.name);
    expect(body.state.stage).toBe("evaluating");

    const byRole = new Map(body.state.roles.map((r: { role: string }) => [r.role, r]));
    expect(byRole.get("sales")).toMatchObject({ decision: "approve" });
    expect(byRole.get("finance")).toMatchObject({ decision: "approve" });
    expect(byRole.get("inventory")).toMatchObject({ decision: "counter", explanation: "inventory explanation" });
    expect(byRole.get("procurement")).toMatchObject({ decision: "pending" });
    expect(byRole.get("logistics")).toMatchObject({ decision: "pending" });
    expect(byRole.get("risk")).toMatchObject({ decision: "pending" });
  });

  it("returns the certificate id for a committed case", async () => {
    const { dealCase } = await makeCase({ status: "committed" });
    const certificate = await testDb.commitCertificate.create({
      data: {
        caseId: dealCase.id,
        caseVersion: 1,
        termsHash: "hash-1",
        reservationIds: toJsonColumn([]),
        policyVersions: toJsonColumn({}),
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        status: "consumed",
        certificateHash: "cert-hash-1",
        idempotencyKey: "idem-1",
        consumedAt: new Date(),
      },
    });

    const response = await GET(new Request(`http://localhost/api/b2b/cases/${dealCase.id}`), { params: { id: dealCase.id } });
    const body = await response.json();
    expect(body.state.stage).toBe("committed");
    expect(body.state.certificateId).toBe(certificate.id);
  });

  it("returns the recorded reason for a cannot_commit case", async () => {
    const { dealCase } = await makeCase({ status: "cannot_commit" });
    await testDb.caseEvent.create({
      data: {
        caseId: dealCase.id,
        sequence: 1,
        eventType: "case.cannot_commit",
        caseVersion: 1,
        actorType: "coordinator",
        actorRef: "workflow",
        payload: toJsonColumn({ reason: "risk_veto" }),
        traceId: "trace-1",
      },
    });

    const response = await GET(new Request(`http://localhost/api/b2b/cases/${dealCase.id}`), { params: { id: dealCase.id } });
    const body = await response.json();
    expect(body.state.stage).toBe("cannot_commit");
    expect(body.state.reason).toBe("risk_veto");
  });

  it("returns the proposed counteroffer terms for a negotiating case", async () => {
    const { dealCase } = await makeCase({ status: "negotiating" });
    await testDb.termsVersion.create({
      data: {
        caseId: dealCase.id,
        version: 2,
        parentVersion: 1,
        source: "counteroffer",
        termsHash: "hash-2",
        sku: "SKU-DESK-1",
        quantity: 40,
        totalValueMinor: 14_000_000,
        discountBps: 0,
        paymentTerms: "ADVANCE_30",
        deliveryDeadline: new Date(),
      },
    });
    await testDb.counteroffer.create({
      data: {
        caseId: dealCase.id,
        sourceTermsVersion: 1,
        proposedTermsVersion: 2,
        tokenHash: "token-hash-1",
        status: "sent",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const response = await GET(new Request(`http://localhost/api/b2b/cases/${dealCase.id}`), { params: { id: dealCase.id } });
    const body = await response.json();
    expect(body.state.stage).toBe("negotiating");
    expect(body.state.counterofferTerms).toEqual({ paymentTerms: "ADVANCE_30", totalValueMinor: 14_000_000 });
  });
});
