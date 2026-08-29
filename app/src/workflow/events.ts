import type { PrismaClient, Prisma } from "@prisma/client";
import { toJsonColumn } from "@/lib/json-column";

export interface EmitCaseEventInput {
  caseId: string;
  eventType: string;
  caseVersion: number;
  actorType: "operator" | "buyer" | "agent" | "coordinator" | "adapter" | "scheduler";
  actorRef: string;
  payload: Record<string, unknown>;
  traceId: string;
}

// Client here can be `db`, `testDb`, or a `$transaction` callback client — every caller
// runs this inside the same transaction as the state mutation it is logging, so the
// event log and the state it describes are always consistent.
type Db = PrismaClient | Prisma.TransactionClient;

// `sequence` is unique per case and provides the stable evidence timeline
// (04-DATA-AND-STATE-SPEC.md). Computed as max(sequence)+1 inside the caller's
// transaction so concurrent writers to different cases never contend.
export async function emitCaseEvent(db: Db, input: EmitCaseEventInput) {
  const last = await db.caseEvent.findFirst({
    where: { caseId: input.caseId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  return db.caseEvent.create({
    data: {
      caseId: input.caseId,
      sequence,
      eventType: input.eventType,
      caseVersion: input.caseVersion,
      actorType: input.actorType,
      actorRef: input.actorRef,
      payload: toJsonColumn(input.payload),
      traceId: input.traceId,
    },
  });
}
