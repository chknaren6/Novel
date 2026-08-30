import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { createModelGateway, requireEnv } from "@/gateway/createGateway";

export async function POST(_request: Request, { params }: { params: { caseId: string } }) {
  try {
    const gateway = createModelGateway();
    const result = await runDealSubmitted(db, gateway, {
      caseId: params.caseId,
      modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 20000),
      traceId: randomUUID(),
      buyerLinkSigningSecret: requireEnv("BUYER_LINK_SIGNING_SECRET"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
