import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBuyerOffer } from "@/api/buyerService";
import { requireEnv } from "@/gateway/createGateway";

// getBuyerOffer never throws (verified in buyerService.ts / buyerService.test.ts) — it
// resolves every invalid/tampered/unknown/malformed input to `null` — so no try/catch
// is needed here beyond that already inside the service.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const offer = await getBuyerOffer(db, params.token, requireEnv("BUYER_LINK_SIGNING_SECRET"));
  if (!offer) return NextResponse.json({ error: "invalid_or_expired" }, { status: 404 });
  return NextResponse.json(offer);
}
