import type { PrismaClient } from "@prisma/client";
import { ToolError } from "@/lib/types";

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
  // A case has exactly one sandbox order per the domain model, so count must be exactly
  // 1: zero matches means a typo'd caseId or an order that was never created (a silent
  // no-op that would otherwise look like success); more than one would mean this update
  // silently touched rows it shouldn't have.
  const result = await db.sandboxOrder.updateMany({ where: { caseId }, data: { status: "repair_pending" } });
  if (result.count !== 1) {
    throw new ToolError("RESOURCE_UNAVAILABLE", `Expected exactly one sandbox order for case ${caseId}, matched ${result.count}`, false);
  }
  return result;
}

export async function markSandboxOrderRepaired(db: PrismaClient, caseId: string, newCertificateId: string) {
  // Same one-order-per-case invariant as markSandboxOrderRepairPending above: guard
  // against a typo'd caseId silently no-opping or an unexpected multi-row match
  // silently mass-updating.
  const result = await db.sandboxOrder.updateMany({ where: { caseId }, data: { status: "repaired", certificateId: newCertificateId } });
  if (result.count !== 1) {
    throw new ToolError("RESOURCE_UNAVAILABLE", `Expected exactly one sandbox order for case ${caseId}, matched ${result.count}`, false);
  }
  return result;
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
