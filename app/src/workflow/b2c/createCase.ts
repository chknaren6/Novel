import type { PrismaClient } from "@prisma/client";
import { canonicalTermsHash, signBuyerToken, hashBuyerToken } from "@/lib/hash";
import { transitionCase } from "@/state/transitions";
import { emitCaseEvent } from "../events";
import { holdSupplierOption } from "@/adapters/supplierAdapter";
import { abortCommitment } from "@/reservations/coordinator";
import { calculateB2CQuote } from "@/policy/b2cMargin";
import type { ParsedRequirement } from "./intake";

// commitos-b2c-product-spec.md §4: "Quote validity window (typically 4-12 hours
// depending on supplier capacity volatility)" — used both as the buyer-quote expiry
// and the held supplier reservation's TTL, since the hold must survive the whole
// window a human negotiation plus buyer decision can span. Unlike B2B's 900s (15min)
// TTL, which assumes a synchronous few-second six-role evaluation.
const QUOTE_VALIDITY_SECONDS = 12 * 60 * 60;

export interface CreateB2CCaseInput {
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  sku: string;
  parsedRequirement: ParsedRequirement;
  chosenSupplierId: string;
  // The listed price/lead time seen during the check step — passed separately from
  // negotiatedBuyPriceMinor because holdSupplierOption re-validates against a ceiling,
  // and a human negotiator may have gotten a price BELOW the listed one. Using the
  // negotiated (lower) price as the ceiling would wrongly reject a hold whenever the
  // listed price is anything above it.
  listedUnitCostMinor: number;
  listedLeadDays: number;
  negotiatedBuyPriceMinor: number;
  operationalCostMinor: number;
  riskBufferBps: number;
  buyerLinkSigningSecret: string;
  traceId: string;
}

export interface CreateB2CCaseResult {
  caseId: string;
  buyerToken: string;
  sellPriceMinor: number;
}

async function findOrCreateBuyer(db: PrismaClient, input: { name: string; phone: string; email?: string }) {
  // Non-atomic find-or-create: acceptable here because MarketplaceBuyer identity has no
  // uniqueness invariant to protect against concurrent duplicate inserts the way a
  // reservation or certificate does — worst case is a rare duplicate buyer row, not a
  // double-decremented resource pool or a double-charged payment.
  const existing = await db.marketplaceBuyer.findFirst({ where: { phone: input.phone } });
  if (existing) return existing;
  return db.marketplaceBuyer.create({ data: { name: input.name, phone: input.phone, email: input.email } });
}

async function findOrCreateCommitOSCompany(db: PrismaClient) {
  const existing = await db.company.findFirst({ where: { name: "CommitOS" } });
  if (existing) return existing;
  return db.company.create({ data: { name: "CommitOS" } });
}

// The orchestrator a human negotiator's tool calls once they've confirmed a buy price
// with a chosen supplier (commitos-b2c-product-spec.md §4 Steps 2-4). Unlike B2B, there
// is no unpriced TermsVersion before this point — see the design doc's "A simplification
// the B2B pattern doesn't need" section for why.
export async function createB2CCase(db: PrismaClient, input: CreateB2CCaseInput): Promise<CreateB2CCaseResult> {
  const quote = calculateB2CQuote({
    buyPriceMinor: input.negotiatedBuyPriceMinor,
    quantity: input.parsedRequirement.quantity,
    operationalCostMinor: input.operationalCostMinor,
    riskBufferBps: input.riskBufferBps,
  });

  const buyer = await findOrCreateBuyer(db, { name: input.buyerName, phone: input.buyerPhone, email: input.buyerEmail });
  const company = await findOrCreateCommitOSCompany(db);
  const deliveryDeadline = new Date(input.parsedRequirement.deliveryDeadline);

  const termsHash = canonicalTermsHash({
    sku: input.sku,
    quantity: input.parsedRequirement.quantity,
    totalValueMinor: quote.sellPriceMinor,
    discountBps: 0,
    paymentTerms: "ADVANCE_VARIABLE",
    deliveryDeadline: deliveryDeadline.toISOString(),
  });

  const dealCase = await db.dealCase.create({
    data: { companyId: company.id, customerId: buyer.id, channel: "b2c", activeTermsVersion: 1, status: "intake", createdBy: "b2c-intake" },
  });
  await db.termsVersion.create({
    data: {
      caseId: dealCase.id,
      version: 1,
      source: "buyer_request",
      termsHash,
      sku: input.sku,
      quantity: input.parsedRequirement.quantity,
      totalValueMinor: quote.sellPriceMinor,
      discountBps: 0,
      paymentTerms: "ADVANCE_VARIABLE",
      deliveryDeadline,
      advanceBps: quote.advanceBps,
      confirmedBuyPriceMinor: input.negotiatedBuyPriceMinor,
    },
  });

  await transitionCase(db, { caseId: dealCase.id, expectedStatus: "intake", expectedVersion: 1, nextStatus: "evaluating" });
  await emitCaseEvent(db, {
    caseId: dealCase.id,
    eventType: "b2c.requirement_parsed",
    caseVersion: 1,
    actorType: "operator",
    actorRef: "b2c-intake",
    payload: { rawRequirement: input.parsedRequirement, chosenSupplierId: input.chosenSupplierId },
    traceId: input.traceId,
  });

  // If the supplier hold fails (e.g. the supplier's price/lead-time no longer clears the
  // ceiling — a documented, expected race), the DealCase and TermsVersion already exist
  // but no Counteroffer ever gets created. Since runB2CBuyerResponse can only reach a
  // case through a Counteroffer.tokenHash, leaving the case in "evaluating" here would
  // orphan it permanently with no code path able to resolve it — so route it to the same
  // terminal, discoverable "cannot_commit" status dealSubmitted.ts uses for this class of
  // failure instead.
  try {
    await holdSupplierOption(db, {
      caseId: dealCase.id,
      caseVersion: 1,
      termsHash,
      supplierId: input.chosenSupplierId,
      sku: input.sku,
      quantity: input.parsedRequirement.quantity,
      maxUnitCostMinor: input.listedUnitCostMinor,
      maxLeadDays: input.listedLeadDays,
      ttlSeconds: QUOTE_VALIDITY_SECONDS,
    });

    const buyerToken = signBuyerToken(`${dealCase.id}:1`, input.buyerLinkSigningSecret);
    await db.counteroffer.create({
      data: {
        caseId: dealCase.id,
        sourceTermsVersion: 1,
        proposedTermsVersion: 1,
        tokenHash: hashBuyerToken(buyerToken),
        status: "sent",
        expiresAt: new Date(Date.now() + QUOTE_VALIDITY_SECONDS * 1000),
      },
    });

    return { caseId: dealCase.id, buyerToken, sellPriceMinor: quote.sellPriceMinor };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await abortCommitment(db, { caseId: dealCase.id, caseVersion: 1 });
    await transitionCase(db, { caseId: dealCase.id, expectedStatus: "evaluating", expectedVersion: 1, nextStatus: "cannot_commit" });
    await emitCaseEvent(db, {
      caseId: dealCase.id,
      eventType: "case.cannot_commit",
      caseVersion: 1,
      actorType: "coordinator",
      actorRef: "workflow",
      payload: { reason },
      traceId: input.traceId,
    });
    throw error;
  }
}
