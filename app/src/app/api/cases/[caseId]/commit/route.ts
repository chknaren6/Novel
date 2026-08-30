import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runCommit } from "@/workflow/commit";

export async function POST(_request: Request, { params }: { params: { caseId: string } }) {
  try {
    const result = await runCommit(db, { caseId: params.caseId, traceId: randomUUID() });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
