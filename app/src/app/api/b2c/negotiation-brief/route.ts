import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { generateNegotiationBrief } from "@/workflow/b2c/negotiationBrief";
import { ToolError } from "@/lib/types";

const SupplierCandidateSchema = z.object({
  supplierId: z.string(),
  unitCostMinor: z.number(),
  leadDays: z.number(),
  availableQuantity: z.number(),
  freshnessTier: z.string().nullable(),
  isStale: z.boolean(),
});

const NegotiationBriefRequestSchema = z.object({
  sku: z.string(),
  itemDescription: z.string(),
  quantity: z.number(),
  deliveryDeadline: z.string(),
  chosenSupplierId: z.string(),
  chosenListedUnitCostMinor: z.number(),
  otherCandidates: z.array(SupplierCandidateSchema),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const parsedBody = NegotiationBriefRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.message }, { status: 400 });
  }

  try {
    const { client, modelId, timeoutMs } = getOpenAIClient();
    const brief = await generateNegotiationBrief(db, client, modelId, timeoutMs, parsedBody.data);
    return NextResponse.json({ brief });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 502 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
