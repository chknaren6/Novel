import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { generateNegotiationBrief } from "@/workflow/b2c/negotiationBrief";
import { ToolError } from "@/lib/types";
import type { SupplierCandidate } from "@/workflow/b2c/check";

const REQUIRED_FIELDS = ["sku", "itemDescription", "quantity", "deliveryDeadline", "chosenSupplierId", "chosenListedUnitCostMinor", "otherCandidates"] as const;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  for (const field of REQUIRED_FIELDS) {
    if (body?.[field] === undefined) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  try {
    const { client, modelId, timeoutMs } = getOpenAIClient();
    const brief = await generateNegotiationBrief(db, client, modelId, timeoutMs, {
      sku: body.sku as string,
      itemDescription: body.itemDescription as string,
      quantity: body.quantity as number,
      deliveryDeadline: body.deliveryDeadline as string,
      chosenSupplierId: body.chosenSupplierId as string,
      chosenListedUnitCostMinor: body.chosenListedUnitCostMinor as number,
      otherCandidates: body.otherCandidates as SupplierCandidate[],
    });
    return NextResponse.json({ brief });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 502 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
