import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createB2CCase } from "@/workflow/b2c/createCase";
import { ParsedRequirementSchema } from "@/workflow/b2c/intake";
import { ToolError } from "@/lib/types";

// parsedRequirement reuses intake.ts's own ParsedRequirementSchema rather than a second,
// duplicated nested schema here: createB2CCase does no independent validation of these
// fields itself (it trusts the shape coming in), so this is the one place a malformed
// nested payload (e.g. a non-numeric quantity, a delivery deadline that isn't a parseable
// date) gets caught with a clear 400 instead of failing confusingly deep inside the
// workflow (e.g. `new Date(...)` producing an Invalid Date, or the margin calculation
// multiplying by NaN).
const CreateB2CCaseRequestSchema = z.object({
  buyerName: z.string(),
  buyerPhone: z.string(),
  buyerEmail: z.string().optional(),
  sku: z.string(),
  parsedRequirement: ParsedRequirementSchema,
  chosenSupplierId: z.string(),
  listedUnitCostMinor: z.number(),
  listedLeadDays: z.number(),
  negotiatedBuyPriceMinor: z.number(),
  operationalCostMinor: z.number(),
  riskBufferBps: z.number(),
});

// The orchestrator a human negotiator calls once they've confirmed a buy price with a
// chosen supplier (commitos-b2c-product-spec.md §4 Steps 2-4) — see createCase.ts.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const secret = process.env.BUYER_LINK_SIGNING_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BUYER_LINK_SIGNING_SECRET is not set" }, { status: 500 });
  }

  const parsedBody = CreateB2CCaseRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.message }, { status: 400 });
  }

  try {
    const result = await createB2CCase(db, {
      ...parsedBody.data,
      buyerLinkSigningSecret: secret,
      traceId: randomUUID(),
    });
    const baseUrl = process.env.APP_BASE_URL ?? "";
    const buyerLink = `${baseUrl}/market/${result.caseId}/accept?token=${encodeURIComponent(result.buyerToken)}`;
    return NextResponse.json({ caseId: result.caseId, sellPriceMinor: result.sellPriceMinor, buyerLink });
  } catch (error) {
    // createB2CCase's documented failure path (the supplier hold no longer clearing the
    // ceiling — an expected race, commented in createCase.ts) throws a ToolError, but we
    // return 400 for ANY thrown error here rather than branching on ToolError specifically:
    // this workflow makes no external/LLM calls (unlike negotiation-brief's
    // PROVIDER_UNAVAILABLE -> 502 branch), so every failure surfaced here is a request
    // that can no longer be satisfied as given (stale price, stale case state, etc.),
    // which is a 400 regardless of whether it arrives as a ToolError or a plain Error.
    if (error instanceof ToolError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
