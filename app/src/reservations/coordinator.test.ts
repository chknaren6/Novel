// src/reservations/coordinator.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetTestDb } from "@/lib/testDb";
import { prepareCommitCertificate, commitOrder, abortCommitment } from "./coordinator";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { ToolError } from "@/lib/types";
import { toJsonColumn } from "@/lib/json-column";

async function seedReadyCase() {
  const company = await testDb.company.create({ data: { name: "Acme" } });
  const dealCase = await testDb.dealCase.create({ data: { companyId: company.id, customerId: "CUST-1", activeTermsVersion: 1, status: "evaluating", createdBy: "seed" } });
  const customer = await testDb.customer.create({ data: { companyId: company.id, name: "Beacon", creditLimitMinor: 200_000_000, currentExposureMinor: 0, overdueReceivablesMinor: 0, allowedPaymentTerms: toJsonColumn(["ADVANCE_30"]), policyVersion: "credit-policy-v1" } });
  await testDb.inventoryPosition.create({ data: { sku: "MAT-10001", warehouseId: "WH-BLR", availableQuantity: 350 } });

  const inventoryReservation = await holdInventory(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 350, ttlSeconds: 600 });
  const creditReservation = await holdCreditEnvelope(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 102_900_000, ttlSeconds: 600 });

  return { dealCase, customer, reservationIds: [inventoryReservation.id, creditReservation.id] };
}

describe("prepareCommitCertificate", () => {
  beforeEach(resetTestDb);

  it("issues a valid certificate when every required domain is held, fresh, and same terms hash", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"],
    });
    expect(certificate.status).toBe("valid");
  });

  it("refuses a reservation set missing a required domain", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    await expect(
      prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit", "logistics"] }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses a reservation bound to a different terms hash", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    await expect(
      prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-2", reservationIds, requiredDomains: ["inventory", "credit"] }),
    ).rejects.toThrow(ToolError);
  });

  it("refuses an already-expired reservation", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    await testDb.reservation.update({ where: { id: reservationIds[0] }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(
      prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] }),
    ).rejects.toThrow(ToolError);
  });
});

describe("commitOrder", () => {
  beforeEach(resetTestDb);

  it("commits reservations, marks the certificate consumed, and writes required receipts exactly once", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });

    const result = await commitOrder(testDb, {
      caseId: dealCase.id, caseVersion: 1, certificateId: certificate.id, certificateHash: certificate.certificateHash,
      sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, depositMinor: 44_100_000,
    });
    expect(result.orderReceipt.status).toBe("succeeded");
    expect(result.checkoutReceipt.status).toBe("succeeded");
    expect(result.outboxReceipt.status).toBe("succeeded");

    const reloadedCert = await testDb.commitCertificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(reloadedCert.status).toBe("consumed");

    const reservations = await testDb.reservation.findMany({ where: { id: { in: reservationIds } } });
    expect(reservations.every((r) => r.status === "committed")).toBe(true);
  });

  it("refuses to consume a certificate whose hash does not match", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const certificate = await prepareCommitCertificate(testDb, { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] });
    await expect(
      commitOrder(testDb, { caseId: dealCase.id, caseVersion: 1, certificateId: certificate.id, certificateHash: "wrong-hash", sku: "MAT-10001", quantity: 350, totalValueMinor: 147_000_000, depositMinor: 44_100_000 }),
    ).rejects.toThrow(ToolError);
  });
});

describe("abortCommitment", () => {
  beforeEach(resetTestDb);

  it("releases every held reservation for the case version and is idempotent on retry", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const first = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    const second = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0); // nothing left in "held" status to release

    const reservations = await testDb.reservation.findMany({ where: { id: { in: reservationIds } } });
    expect(reservations.every((r) => r.status === "released")).toBe(true);
  });
});
