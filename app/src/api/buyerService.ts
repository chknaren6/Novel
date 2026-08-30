import type { PrismaClient } from "@prisma/client";
import { hashBuyerToken, verifyBuyerToken } from "@/lib/hash";

interface TermsView {
  sku: string;
  quantity: number;
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: string;
  deliveryDeadline: string;
}

export interface BuyerOfferView {
  counterofferId: string;
  status: string;
  expiresAt: string;
  sourceTerms: TermsView;
  proposedTerms: TermsView;
}

function toView(terms: { sku: string; quantity: number; totalValueMinor: number; discountBps: number; paymentTerms: string; deliveryDeadline: Date }): TermsView {
  return { sku: terms.sku, quantity: terms.quantity, totalValueMinor: terms.totalValueMinor, discountBps: terms.discountBps, paymentTerms: terms.paymentTerms, deliveryDeadline: terms.deliveryDeadline.toISOString() };
}

// The signature check happens before any database lookup — a tampered token is
// rejected without even revealing whether a matching offer exists. verifyBuyerToken
// itself never throws (it only splits/compares strings), but the whole lookup is
// wrapped defensively anyway since this is the codebase's first buyer-facing (anonymous,
// unauthenticated) HTTP boundary: any invalid/tampered/unknown/mismatched-secret/
// malformed input must resolve to `null`, never an exception.
//
// KNOWN, ACCEPTED P0 GAP: there is no rate limiting anywhere in this stack, so this
// token lookup has no built-in defense against brute-force token guessing. Out of
// scope for this pass; flagged here rather than left silent.
export async function getBuyerOffer(db: PrismaClient, buyerToken: string, secret: string): Promise<BuyerOfferView | null> {
  try {
    if (!verifyBuyerToken(buyerToken, secret)) return null;
    const counteroffer = await db.counteroffer.findUnique({ where: { tokenHash: hashBuyerToken(buyerToken) } });
    if (!counteroffer) return null;
    const [sourceTerms, proposedTerms] = await Promise.all([
      db.termsVersion.findFirst({ where: { caseId: counteroffer.caseId, version: counteroffer.sourceTermsVersion } }),
      db.termsVersion.findFirst({ where: { caseId: counteroffer.caseId, version: counteroffer.proposedTermsVersion } }),
    ]);
    if (!sourceTerms || !proposedTerms) return null;
    return {
      counterofferId: counteroffer.id,
      status: counteroffer.status,
      expiresAt: counteroffer.expiresAt.toISOString(),
      sourceTerms: toView(sourceTerms),
      proposedTerms: toView(proposedTerms),
    };
  } catch {
    return null;
  }
}
