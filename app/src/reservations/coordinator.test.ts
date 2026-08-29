// src/reservations/coordinator.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { testDb, resetTestDb } from "@/lib/testDb";
import { prepareCommitCertificate, commitOrder, abortCommitment } from "./coordinator";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { ToolError, type ReservationDomain } from "@/lib/types";
import { toJsonColumn } from "@/lib/json-column";
import { deriveIdempotencyKey } from "@/policy/idempotency";

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

  it("returns the same certificate when called twice with identical inputs", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const first = await prepareCommitCertificate(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"],
    });
    const second = await prepareCommitCertificate(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"],
    });
    expect(second.id).toBe(first.id);

    const certificates = await testDb.commitCertificate.findMany({ where: { caseId: dealCase.id } });
    expect(certificates).toHaveLength(1);
  });

  it("returns the winner's row when the DB rejects a duplicate idempotency key (P2002)", async () => {
    // This branch only fires under true concurrent execution with weaker isolation than
    // SQLite's serialized transactions give us (e.g. a future Postgres swap) — it can't
    // be reached through this app's real DB today, so it's exercised here with a stubbed
    // client instead of the real testDb, mirroring inventoryAdapter.test.ts's P2002 test.
    const { dealCase, reservationIds } = await seedReadyCase();
    const args = { caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"] as ReservationDomain[] };
    const idempotencyKey = deriveIdempotencyKey({
      caseId: args.caseId,
      caseVersion: args.caseVersion,
      actionType: "prepare_commit_certificate",
      resourceRef: [...args.reservationIds].sort().join(","),
    });
    const winnerRow = { id: "winner-certificate-id", idempotencyKey, status: "valid" };

    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-transaction check: no certificate yet
      .mockResolvedValueOnce(winnerRow); // post-catch refetch: the real winner has since committed

    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`idempotencyKey`)", {
      code: "P2002",
      clientVersion: "test",
    });

    const fakeDb = {
      commitCertificate: { findUnique },
      $transaction: vi.fn().mockRejectedValue(p2002),
    } as unknown as PrismaClient;

    const result = await prepareCommitCertificate(fakeDb, args);

    expect(result).toBe(winnerRow);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("does not block a legitimate re-issuance at a new caseVersion with the same termsHash and reservation shape", async () => {
    // certificateHash is deliberately computed without caseVersion, so a legitimate
    // repair re-issuance can share the same termsHash and an equivalent reservation set
    // as an earlier certificate. The idempotency key must include caseVersion so this
    // case is NOT mistaken for a duplicate of the version-1 call.
    const { dealCase, customer, reservationIds } = await seedReadyCase();
    const first = await prepareCommitCertificate(testDb, {
      caseId: dealCase.id, caseVersion: 1, termsHash: "hash-1", reservationIds, requiredDomains: ["inventory", "credit"],
    });

    // Top up the shared pools so a second, independent hold at case version 2 can
    // succeed with the same terms hash, simulating a repair re-issuance rather than
    // reusing any resource from the version-1 hold above.
    await testDb.inventoryPosition.updateMany({ where: { sku: "MAT-10001" }, data: { availableQuantity: 50 } });
    const inventoryReservation2 = await holdInventory(testDb, {
      caseId: dealCase.id, caseVersion: 2, termsHash: "hash-1", sku: "MAT-10001", warehouseId: "WH-BLR", quantity: 50, ttlSeconds: 600,
    });
    const creditReservation2 = await holdCreditEnvelope(testDb, {
      caseId: dealCase.id, caseVersion: 2, termsHash: "hash-1", customerId: customer.id, paymentTerms: "ADVANCE_30", exposureMinor: 1_000_000, ttlSeconds: 600,
    });

    const second = await prepareCommitCertificate(testDb, {
      caseId: dealCase.id,
      caseVersion: 2,
      termsHash: "hash-1",
      reservationIds: [inventoryReservation2.id, creditReservation2.id],
      requiredDomains: ["inventory", "credit"],
    });

    expect(second.id).not.toBe(first.id);
    expect(second.caseVersion).toBe(2);
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

    const crmEvent = await testDb.crmStageEvent.findFirstOrThrow({ where: { caseId: dealCase.id, stage: "committed" } });
    expect(crmEvent.caseId).toBe(dealCase.id);

    const outboxMessage = await testDb.outboxMessage.findFirstOrThrow({ where: { caseId: dealCase.id, messageType: "backed_promise" } });
    expect(outboxMessage.certificateId).toBe(certificate.id);

    const sandboxOrder = await testDb.sandboxOrder.findFirstOrThrow({ where: { caseId: dealCase.id } });
    expect(sandboxOrder.status).toBe("accepted");
    expect(sandboxOrder.sku).toBe("MAT-10001");
    expect(sandboxOrder.quantity).toBe(350);
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
    const { dealCase, customer, reservationIds } = await seedReadyCase();
    const first = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    const second = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    expect(first).toHaveLength(2);
    expect(first.every((r) => r.status === "released")).toBe(true);
    expect(second).toHaveLength(0); // nothing left in "held" status to release

    const reservations = await testDb.reservation.findMany({ where: { id: { in: reservationIds } } });
    expect(reservations.every((r) => r.status === "released")).toBe(true);

    const position = await testDb.inventoryPosition.findFirstOrThrow({ where: { sku: "MAT-10001" } });
    expect(position.availableQuantity).toBe(350); // restored to its pre-hold value

    const reloadedCustomer = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloadedCustomer.currentExposureMinor).toBe(0); // restored to its pre-hold value
  });

  it("reports a failed release without losing the results of releases that succeeded", async () => {
    const { dealCase, reservationIds } = await seedReadyCase();
    const [inventoryReservationId, creditReservationId] = reservationIds;
    // Corrupt one reservation's domain so its release hits the "unknown domain" branch
    // and throws mid-loop, without preventing the other reservation from releasing.
    await testDb.reservation.update({ where: { id: inventoryReservationId }, data: { domain: "bogus" } });

    const results = await abortCommitment(testDb, { caseId: dealCase.id, caseVersion: 1 });
    expect(results).toHaveLength(2);

    const failed = results.find((r) => r.reservationId === inventoryReservationId);
    const released = results.find((r) => r.reservationId === creditReservationId);
    expect(failed?.status).toBe("failed");
    expect(released?.status).toBe("released");

    const creditReservation = await testDb.reservation.findUniqueOrThrow({ where: { id: creditReservationId } });
    expect(creditReservation.status).toBe("released");

    const untouchedReservation = await testDb.reservation.findUniqueOrThrow({ where: { id: inventoryReservationId } });
    expect(untouchedReservation.status).toBe("held"); // the failed release never transitioned it
  });
});
