import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveMarketState } from "@/workflow/b2c/deriveMarketState";
import type { CaseStatus } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const dealCase = await db.dealCase.findUnique({ where: { id: params.id } });
  if (!dealCase) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const events = await db.caseEvent.findMany({ where: { caseId: dealCase.id }, orderBy: { sequence: "asc" } });
  const terms = await db.termsVersion.findFirst({ where: { caseId: dealCase.id, version: dealCase.activeTermsVersion } });
  // Prisma types DealCase.status as a plain string; cast-based narrowing (same
  // trust-the-DB-value convention as readTools.ts's `paymentTerms as PaymentTerms`) is
  // safe here since only the state machine ever writes this column.
  const state = deriveMarketState({ status: dealCase.status as CaseStatus }, events, terms?.totalValueMinor ?? null);
  return NextResponse.json({ state, eventTypes: events.map((e) => e.eventType) });
}
