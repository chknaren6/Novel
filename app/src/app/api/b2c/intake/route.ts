import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openaiClient";
import { parseB2CRequirement } from "@/workflow/b2c/intake";
import { findSupplierCandidates } from "@/workflow/b2c/check";
import { ToolError } from "@/lib/types";

// sku is a required, separately-supplied field, not derived from rawText — there is no
// free-text-to-SKU matching step anywhere in this codebase (see the plan's Task 4 notes
// for why). The operator supplies it directly, the same way they later supply the
// negotiated price: a human fills the gap the backend doesn't automate.
export async function POST(request: Request) {
  let body: { rawText?: unknown; sku?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  const rawText = typeof body?.rawText === "string" ? body.rawText : null;
  const sku = typeof body?.sku === "string" ? body.sku : null;
  if (!rawText) return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 });

  try {
    const { client, modelId, timeoutMs } = getOpenAIClient();
    const parsedRequirement = await parseB2CRequirement(client, modelId, rawText, timeoutMs);
    const candidates = await findSupplierCandidates(db, { sku, quantity: parsedRequirement.quantity });
    return NextResponse.json({ parsedRequirement, candidates });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 502 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
