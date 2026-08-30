import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runBuyerResponse } from "@/workflow/buyerResponse";
import { createModelGateway, requireEnv } from "@/gateway/createGateway";

// HTTP status mapping for BuyerResponseResult's full variant set:
//   - "invalid_or_expired": the token/offer is not usable at all -> 404.
//   - "in_progress": the accept was durably recorded but evaluation/commit is still
//     mid-flight on the winning caller's own request, or this is a concurrent retry that
//     lost a race and must not be told the deal is dead -> 202 Accepted, the conventional
//     code for "request accepted, processing not complete" — a bare 200 would wrongly
//     imply this is the final outcome.
//   - "cannot_commit" / "prepared" / "negotiating" / "committed": all definitive,
//     successfully-processed outcomes -> 200.
//   - "escalated": an internal-failure-adjacent outcome, but it is still a legitimate,
//     durably-recorded terminal result of processing the buyer's request (matching how
//     src/app/api/cases/[caseId]/commit/route.ts treats the same status from runCommit)
//     rather than a failure to handle the HTTP request itself, so it stays -> 200 too.
function statusCodeFor(result: Awaited<ReturnType<typeof runBuyerResponse>>): number {
  if (result.status === "invalid_or_expired") return 404;
  if (result.status === "in_progress") return 202;
  return 200;
}

// This is the codebase's first buyer-facing HTTP boundary: an anonymous external client
// reaches this route with no other authentication. runBuyerResponse is known to throw in
// genuine edge cases (e.g. ToolError("STALE_CASE_VERSION", ...) on a lost optimistic-
// concurrency race, or a rare compound failure inside its own catch-block recovery path),
// and createModelGateway() throws synchronously if OPENAI_API_KEY is missing. Neither
// error message nor stack trace may reach this client — unlike the operator-only routes
// under src/app/api/cases/, which echo error.message because their callers are trusted
// internal operators.
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const body = await request.json().catch(() => ({}));
  const response = body.response === "reject" ? "reject" : "accept";
  try {
    const gateway = createModelGateway();
    const result = await runBuyerResponse(db, gateway, {
      buyerToken: params.token,
      response,
      modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
      timeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 20000),
      traceId: randomUUID(),
      buyerLinkSigningSecret: requireEnv("BUYER_LINK_SIGNING_SECRET"),
    });
    return NextResponse.json(result, { status: statusCodeFor(result) });
  } catch {
    // Deliberately generic: never echo error.message/String(error) to this
    // buyer-facing client (see comment above).
    return NextResponse.json({ error: "unable_to_process_response" }, { status: 500 });
  }
}
