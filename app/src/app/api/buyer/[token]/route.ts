import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBuyerOffer } from "@/api/buyerService";
import { requireEnv } from "@/gateway/createGateway";

// getBuyerOffer resolves every invalid/tampered/unknown/malformed token to `null` (see
// buyerService.ts / buyerService.test.ts), but rethrows a genuine DB/infrastructure
// failure instead of masking it as the same outcome. Catch that here and turn it into a
// distinguishable 500 — never leak error details to this anonymous buyer-facing client
// (same policy as respond/route.ts).
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  try {
    const offer = await getBuyerOffer(db, params.token, requireEnv("BUYER_LINK_SIGNING_SECRET"));
    if (!offer) return NextResponse.json({ error: "invalid_or_expired" }, { status: 404 });
    return NextResponse.json(offer);
  } catch {
    return NextResponse.json({ error: "unable_to_process_request" }, { status: 500 });
  }
}
