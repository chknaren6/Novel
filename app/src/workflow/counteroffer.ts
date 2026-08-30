import type { PrismaClient } from "@prisma/client";
import { canonicalTermsHash, signBuyerToken, hashBuyerToken } from "@/lib/hash";
import type { PaymentTerms } from "@/lib/types";

export interface CreateCounterofferInput {
  caseId: string;
  sourceTermsVersion: number;
  sku: string;
  quantity: number;
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: PaymentTerms;
  deliveryDeadline: Date;
  expiresInSeconds: number;
  buyerLinkSigningSecret: string;
}

// Creates a new terms version and a signed buyer link. The offer is explicitly
// non-binding until accepted and certified. The returned `buyerToken` is the only time
// the raw token exists — only its hash is persisted.
export async function createCounteroffer(db: PrismaClient, input: CreateCounterofferInput) {
  const termsHash = canonicalTermsHash({
    sku: input.sku,
    quantity: input.quantity,
    totalValueMinor: input.totalValueMinor,
    discountBps: input.discountBps,
    paymentTerms: input.paymentTerms,
    deliveryDeadline: input.deliveryDeadline.toISOString(),
  });
  const proposedVersion = input.sourceTermsVersion + 1;

  await db.termsVersion.create({
    data: {
      caseId: input.caseId,
      version: proposedVersion,
      parentVersion: input.sourceTermsVersion,
      source: "counteroffer",
      termsHash,
      sku: input.sku,
      quantity: input.quantity,
      totalValueMinor: input.totalValueMinor,
      discountBps: input.discountBps,
      paymentTerms: input.paymentTerms,
      deliveryDeadline: input.deliveryDeadline,
    },
  });

  const buyerToken = signBuyerToken(`${input.caseId}:${proposedVersion}`, input.buyerLinkSigningSecret);
  const counteroffer = await db.counteroffer.create({
    data: {
      caseId: input.caseId,
      sourceTermsVersion: input.sourceTermsVersion,
      proposedTermsVersion: proposedVersion,
      tokenHash: hashBuyerToken(buyerToken),
      status: "sent",
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    },
  });

  return { counteroffer, buyerToken, termsHash, proposedVersion };
}
