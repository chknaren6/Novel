import type { PrismaClient } from "@prisma/client";

export interface CreateSandboxOrderInput {
  caseId: string;
  certificateId: string;
  sku: string;
  quantity: number;
  totalValueMinor: number;
}

export async function createSandboxOrder(db: PrismaClient, input: CreateSandboxOrderInput) {
  return db.sandboxOrder.create({ data: { ...input, status: "accepted" } });
}

export async function markSandboxOrderRepairPending(db: PrismaClient, caseId: string) {
  return db.sandboxOrder.updateMany({ where: { caseId }, data: { status: "repair_pending" } });
}

export async function markSandboxOrderRepaired(db: PrismaClient, caseId: string, newCertificateId: string) {
  return db.sandboxOrder.updateMany({ where: { caseId }, data: { status: "repaired", certificateId: newCertificateId } });
}

export interface UpdateCrmStageInput {
  caseId: string;
  stage: string;
  note: string;
}

// Append-only: CRM stage is a history of events, never an overwritten single field, so
// the repair timeline can show "with history" (04-DATA-AND-STATE-SPEC.md compensation table).
export async function updateCrmStage(db: PrismaClient, input: UpdateCrmStageInput) {
  return db.crmStageEvent.create({ data: input });
}
