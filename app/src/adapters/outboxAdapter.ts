import type { PrismaClient } from "@prisma/client";
import { toJsonColumn } from "@/lib/json-column";
import { ToolError } from "@/lib/types";

export interface SendBackedPromiseInput {
  caseId: string;
  certificateId: string;
  payload: Record<string, unknown>;
}

export async function sendBackedPromise(db: PrismaClient, input: SendBackedPromiseInput) {
  return db.outboxMessage.create({
    data: {
      caseId: input.caseId,
      messageType: "backed_promise",
      certificateId: input.certificateId,
      payload: toJsonColumn(input.payload),
    },
  });
}

export interface SendCorrectionInput {
  caseId: string;
  certificateId: string;
  correctsId: string;
  payload: Record<string, unknown>;
}

// Never deletes or overwrites the original promise message
// (04-DATA-AND-STATE-SPEC.md compensation table, "Customer message").
export async function sendCorrection(db: PrismaClient, input: SendCorrectionInput) {
  // correctsId has no FK constraint in the schema, so a typo'd or stale id would
  // otherwise silently create a dangling correction with no signal anywhere. Validate
  // the original exists before creating the correction.
  const original = await db.outboxMessage.findUnique({ where: { id: input.correctsId } });
  if (!original) {
    throw new ToolError("RESOURCE_UNAVAILABLE", `Cannot correct outbox message ${input.correctsId}: original not found`, false);
  }
  return db.outboxMessage.create({
    data: {
      caseId: input.caseId,
      messageType: "correction",
      certificateId: input.certificateId,
      correctsId: input.correctsId,
      payload: toJsonColumn(input.payload),
    },
  });
}
