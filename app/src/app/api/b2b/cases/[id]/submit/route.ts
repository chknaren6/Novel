import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { OpenAIModelGateway } from "@/gateway/openaiGateway";
import { runB2BEvaluation } from "@/workflow/runB2BEvaluation";
import { ToolError } from "@/lib/types";

// Operator-triggered: "run this intake case through the six-agent evaluation and, if it
// clears, commit it" (runB2BEvaluation.ts). Unlike B2C's respond/route.ts, there is no
// request body at all here — the only input is the case id in the URL — so there is no
// request.json() to parse.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  // Same guard/shape as B2C's cases/route.ts: a missing signing secret is an operator
  // config error (500), not something the caller can fix by resubmitting, so it is
  // checked before doing any work (createCounteroffer, reached only on the
  // "negotiating" branch inside runDealSubmitted, would otherwise throw a raw Error
  // deep in the workflow instead of failing loudly here).
  const secret = process.env.BUYER_LINK_SIGNING_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BUYER_LINK_SIGNING_SECRET is not set" }, { status: 500 });
  }

  try {
    const { client, modelId, timeoutMs } = getOpenAIClient();
    const gateway = new OpenAIModelGateway(client, modelId);
    const result = await runB2BEvaluation(db, gateway, {
      caseId: params.id,
      modelId,
      timeoutMs,
      traceId: randomUUID(),
      buyerLinkSigningSecret: secret,
    });
    return NextResponse.json({ result });
  } catch (error) {
    // runB2BEvaluation's only real throw paths (transitionCase's STALE_CASE_VERSION for
    // a case not in "intake", and the role/gateway layers' ToolErrors) are all
    // ToolError, so this mirrors the b2c/intake convention rather than
    // b2c/cases/route.ts's "any thrown error is a 400" one: PROVIDER_UNAVAILABLE (a
    // real OpenAI outage) is a 502, everything else ToolError throws (including a
    // wrong-status resubmit) is a 400, and anything not a ToolError at all (e.g. the
    // case id not existing, surfaced as a raw Prisma error from findUniqueOrThrow) is
    // an unexpected 500 rather than being misreported as a client error.
    if (error instanceof ToolError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 502 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
