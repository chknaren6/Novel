import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runSupplierDisruption } from "@/workflow/supplierDisrupted";
import { createModelGateway } from "@/gateway/createGateway";

export async function POST(request: Request, { params }: { params: { caseId: string } }) {
  const body = await request.json().catch(() => ({}));
  const disruptedSupplierId = typeof body.disruptedSupplierId === "string" ? body.disruptedSupplierId : "VEND-2003";
  try {
    const gateway = createModelGateway();
    const result = await runSupplierDisruption(db, gateway, {
      caseId: params.caseId,
      disruptedSupplierId,
      modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 20000),
      traceId: randomUUID(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
