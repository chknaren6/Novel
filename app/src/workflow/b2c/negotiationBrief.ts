import type { PrismaClient } from "@prisma/client";
import type OpenAI from "openai";
import { z } from "zod";
import { ToolError } from "@/lib/types";
import type { SupplierCandidate } from "./check";
import { NEGOTIATION_BRIEF_LLM_JSON_SCHEMA } from "./negotiationBriefJsonSchema";

// Below this fraction of the chosen candidate's listed price, the order is declined —
// a flat policy percentage standing in for "walk-away price, fixed by category" (the
// product's own framing, commitos-b2c-product-spec.md §Step 3) until categories are
// actually modeled.
const WALKAWAY_DISCOUNT_BPS = 800; // 8%

export interface NegotiationBriefInput {
  sku: string;
  itemDescription: string;
  quantity: number;
  deliveryDeadline: string;
  chosenSupplierId: string;
  chosenListedUnitCostMinor: number;
  otherCandidates: SupplierCandidate[];
}

const NegotiationBriefLlmSchema = z.object({
  marketPriceRangeNote: z.string(),
  suggestedOpeningUnitCostMinor: z.number().int().positive(),
  negotiationLevers: z.array(z.string()),
});

export interface NegotiationBrief {
  batna: { supplierId: string; unitCostMinor: number; leadDays: number }[];
  buyerDeadline: string;
  walkAwayUnitCostMinor: number;
  historicalPricing: { unitCostMinor: number; confirmedAt: string }[] | null;
  marketPriceRangeNote: string;
  suggestedOpeningUnitCostMinor: number;
  negotiationLevers: string[];
}

const NEGOTIATION_BRIEF_SYSTEM_PROMPT =
  "You are the negotiation assistant for a B2C industrial-goods marketplace. A human " +
  "negotiator is about to contact a supplier to get the best buy price for an item. " +
  "Given the item, quantity, the supplier's listed price, other suppliers who could " +
  "also fulfill this order, and any historical pricing, provide: a plausible market " +
  "price range for this item as a short note (not a guarantee), a suggested opening " +
  "price to start the negotiation at (same minor-unit currency as the listed price, " +
  "always below it), and 2-4 short negotiation levers (e.g. volume commitment, repeat " +
  "order potential, a competing quote).";

// Finds prior confirmed buy prices for this exact supplier+sku, via the reservation
// resourceRef convention "SUPPLIER:<supplierId>:<sku>" (src/adapters/supplierAdapter.ts)
// — TermsVersion has no direct supplierId column, since B2C discovers the supplier live
// per order rather than from a catalog (see TermsVersion.confirmedBuyPriceMinor's own
// schema comment).
async function findHistoricalPricing(
  db: PrismaClient,
  input: { supplierId: string; sku: string },
): Promise<{ unitCostMinor: number; confirmedAt: string }[] | null> {
  const priorReservations = await db.reservation.findMany({
    where: { domain: "supplier", resourceRef: `SUPPLIER:${input.supplierId}:${input.sku}` },
    select: { caseId: true, caseVersion: true },
  });
  if (priorReservations.length === 0) return null;

  // Single query instead of one findFirst per reservation: TermsVersion's
  // @@unique([caseId, version]) means each {caseId, caseVersion} pair from the
  // reservations above identifies at most one row, so an OR of those pairs (plus the
  // confirmed-price filter) covers exactly the same rows the per-reservation loop did.
  const priorTerms = await db.termsVersion.findMany({
    where: {
      confirmedBuyPriceMinor: { not: null },
      OR: priorReservations.map((r) => ({ caseId: r.caseId, version: r.caseVersion })),
    },
  });
  if (priorTerms.length === 0) return null;
  return priorTerms.map((t) => ({ unitCostMinor: t.confirmedBuyPriceMinor!, confirmedAt: t.createdAt.toISOString() }));
}

// Prepares the brief a human negotiator reviews before contacting a supplier
// (commitos-b2c-product-spec.md §Step 3). Read-only and advisory: it persists nothing
// and does not negotiate on its own behalf — "The AI does not negotiate autonomously in
// Phase 1." The negotiator still records whatever price they actually got via
// createB2CCase's negotiatedBuyPriceMinor input, independent of this brief.
export async function generateNegotiationBrief(
  db: PrismaClient,
  client: OpenAI,
  modelId: string,
  timeoutMs: number,
  input: NegotiationBriefInput,
): Promise<NegotiationBrief> {
  const batna = input.otherCandidates.map((c) => ({ supplierId: c.supplierId, unitCostMinor: c.unitCostMinor, leadDays: c.leadDays }));
  const walkAwayUnitCostMinor = Math.round((input.chosenListedUnitCostMinor * (10_000 - WALKAWAY_DISCOUNT_BPS)) / 10_000);
  const historicalPricing = await findHistoricalPricing(db, { supplierId: input.chosenSupplierId, sku: input.sku });

  const userMessage = JSON.stringify({
    itemDescription: input.itemDescription,
    quantity: input.quantity,
    deliveryDeadline: input.deliveryDeadline,
    chosenSupplierListedUnitCostMinor: input.chosenListedUnitCostMinor,
    otherSuppliers: batna,
    historicalPricing,
  });

  let response;
  try {
    response = await client.chat.completions.create(
      {
        model: modelId,
        messages: [
          { role: "system", content: NEGOTIATION_BRIEF_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_schema", json_schema: { name: "negotiation_brief", strict: true, schema: NEGOTIATION_BRIEF_LLM_JSON_SCHEMA } },
      },
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new ToolError("PROVIDER_UNAVAILABLE", `Negotiation brief call failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  const raw = response.choices[0]!.message.content ?? "{}";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new ToolError("INVALID_INPUT", `Negotiation brief response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, false);
  }
  const parsed = NegotiationBriefLlmSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ToolError("INVALID_INPUT", `Negotiation brief response failed validation: ${parsed.error.message}`, false);
  }

  return {
    batna,
    buyerDeadline: input.deliveryDeadline,
    walkAwayUnitCostMinor,
    historicalPricing,
    marketPriceRangeNote: parsed.data.marketPriceRangeNote,
    suggestedOpeningUnitCostMinor: parsed.data.suggestedOpeningUnitCostMinor,
    negotiationLevers: parsed.data.negotiationLevers,
  };
}
