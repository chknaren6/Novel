import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCaseDetail } from "@/api/casesService";

export async function GET(_request: Request, { params }: { params: { caseId: string } }) {
  const detail = await getCaseDetail(db, params.caseId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
