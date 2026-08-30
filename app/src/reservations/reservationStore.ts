import type { PrismaClient, Prisma } from "@prisma/client";
import type { ReservationDomain } from "@/lib/types";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateHeldReservationInput {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  domain: ReservationDomain;
  resourceRef: string;
  quantityMinor: number | null;
  limitMinor: number | null;
  policyVersion: string;
  ttlSeconds: number;
  idempotencyKey: string;
}

// Every hold adapter ends its transaction here. Idempotency is enforced by the unique
// constraint on `idempotencyKey`: a retry with the same key returns the row that
// already exists instead of creating a second one.
export async function createHeldReservation(db: Db, input: CreateHeldReservationInput) {
  const existing = await db.reservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  return db.reservation.create({
    data: {
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      domain: input.domain,
      resourceRef: input.resourceRef,
      quantityMinor: input.quantityMinor,
      limitMinor: input.limitMinor,
      status: "held",
      policyVersion: input.policyVersion,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
    },
  });
}
