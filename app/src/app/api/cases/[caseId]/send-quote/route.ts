import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendQuote } from "@/api/casesService";

export async function POST(request: Request, { params }: { params: { caseId: string } }) {
  const body = await request.json().catch(() => ({}));
  const result = await sendQuote(db, params.caseId, typeof body.mode === "string" ? body.mode : "");
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
