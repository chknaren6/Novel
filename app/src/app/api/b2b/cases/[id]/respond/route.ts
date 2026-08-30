import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { OpenAIModelGateway } from "@/gateway/openaiGateway";
import { runB2BCounterofferResponse } from "@/workflow/runB2BCounterofferResponse";

// Buyer's response to a B2B counteroffer link. Mirrors the B2C convention exactly
// (src/app/api/b2c/cases/[id]/respond/route.ts): buyerToken/response in the body, the
// URL's [id] kept only for a readable/RESTful path.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: { buyerToken?: unknown; response?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const secret = process.env.BUYER_LINK_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "BUYER_LINK_SIGNING_SECRET is not set" }, { status: 500 });
  if (body.response !== "accept" && body.response !== "reject") {
    return NextResponse.json({ error: "response must be 'accept' or 'reject'" }, { status: 400 });
  }
  if (typeof body.buyerToken !== "string" || body.buyerToken.length === 0) {
    return NextResponse.json({ error: "buyerToken is required" }, { status: 400 });
  }

  // caseId is resolved from the buyerToken (via its tokenHash on Counteroffer), not from
  // this URL segment — confirmed in src/workflow/runB2BCounterofferResponse.ts. params.id
  // is kept only so the URL is readable/RESTful; it is not consulted below.
  void params;

  const { client, modelId, timeoutMs } = getOpenAIClient();
  const gateway = new OpenAIModelGateway(client, modelId);

  const result = await runB2BCounterofferResponse(db, gateway, {
    buyerToken: body.buyerToken,
    response: body.response,
    buyerLinkSigningSecret: secret,
    modelId,
    timeoutMs,
    traceId: randomUUID(),
  });
  return NextResponse.json({ result });
}
