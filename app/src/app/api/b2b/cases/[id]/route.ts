import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveDeskState } from "@/workflow/deriveDeskState";
import { fromJsonColumn } from "@/lib/json-column";
import type { CaseStatus, DomainDecision } from "@/lib/types";

// The Commitment Desk's per-case detail view: the live six-role checklist plus overall
// outcome (see deriveDeskState.ts), joined with the customer/company names the UI header
// needs. DealCase.customerId is a bare column, not a Prisma relation (prisma/schema.prisma
// has no `customer` relation field on either model — same gap the sibling GET
// /api/b2b/cases list route already documents), so Customer is fetched separately.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const dealCase = await db.dealCase.findUnique({ where: { id: params.id }, include: { company: true } });
  if (!dealCase) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const customer = await db.customer.findUnique({ where: { id: dealCase.customerId } });

  // Scoped to the case's *active* terms version: a decision recorded against a prior
  // version (e.g. before a counteroffer bumped activeTermsVersion) is stale and must
  // not be shown as if it applied to the terms currently in play.
  const decisionRows = await db.domainDecision.findMany({
    where: { caseId: dealCase.id, caseVersion: dealCase.activeTermsVersion },
  });
  // Prisma types role/decision as plain strings and payload/evidenceRefs as JSON-in-TEXT
  // columns (see prisma/schema.prisma and lib/json-column.ts) — decisionRow.payload is
  // the exact DomainDecisionSchema object persistDecision wrote (src/roles/roleRuntime.ts),
  // so parsing it back out is the full, real DomainDecision, not a reconstruction.
  const decisions: DomainDecision[] = decisionRows.map((row) => fromJsonColumn<DomainDecision>(row.payload));

  const status = dealCase.status as CaseStatus;
  const extra = await loadExtra(dealCase.id, dealCase.activeTermsVersion, status);
  const state = deriveDeskState({ status }, decisions, extra);

  return NextResponse.json({ state, customerName: customer?.name ?? null, companyName: dealCase.company.name });
}

async function loadExtra(caseId: string, activeTermsVersion: number, status: CaseStatus) {
  if (status === "committed") {
    const certificate = await db.commitCertificate.findFirst({
      where: { caseId, caseVersion: activeTermsVersion },
      orderBy: { createdAt: "desc" },
    });
    return { certificateId: certificate?.id ?? null };
  }

  if (status === "cannot_commit" || status === "escalated") {
    const eventType = status === "cannot_commit" ? "case.cannot_commit" : "case.escalated";
    const event = await db.caseEvent.findFirst({
      where: { caseId, eventType },
      orderBy: { sequence: "desc" },
    });
    const reason = event ? fromJsonColumn<{ reason?: string }>(event.payload).reason ?? null : null;
    return { reason };
  }

  if (status === "negotiating") {
    const counteroffer = await db.counteroffer.findFirst({
      where: { caseId, sourceTermsVersion: activeTermsVersion },
      orderBy: { createdAt: "desc" },
    });
    if (!counteroffer) return {};
    const proposedTerms = await db.termsVersion.findFirst({
      where: { caseId, version: counteroffer.proposedTermsVersion },
    });
    if (!proposedTerms) return {};
    return { counterofferTerms: { paymentTerms: proposedTerms.paymentTerms, totalValueMinor: proposedTerms.totalValueMinor } };
  }

  return {};
}
