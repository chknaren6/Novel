import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentTerms } from "./types";

export interface CanonicalTermsInput {
  sku: string;
  quantity: number;
  totalValueMinor: number;
  discountBps: number;
  paymentTerms: PaymentTerms;
  deliveryDeadline: string;
}

// Canonical hash of every field that affects a promise. A certificate and every
// reservation it covers must reference the same hash (04-DATA-AND-STATE-SPEC.md).
export function canonicalTermsHash(terms: CanonicalTermsInput): string {
  const canonical = JSON.stringify({
    sku: terms.sku,
    quantity: terms.quantity,
    totalValueMinor: terms.totalValueMinor,
    discountBps: terms.discountBps,
    paymentTerms: terms.paymentTerms,
    deliveryDeadline: terms.deliveryDeadline,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function certificateHash(input: { caseId: string; termsHash: string; reservationIds: string[] }): string {
  const canonical = JSON.stringify({
    caseId: input.caseId,
    termsHash: input.termsHash,
    reservationIds: [...input.reservationIds].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// Buyer tokens are random and signed; only the hash is ever persisted (spec: "Buyer
// tokens are stored as hashes"). The signature lets us reject a tampered token before
// even hitting the database.
export function signBuyerToken(offerId: string, secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${offerId}.${nonce}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyBuyerToken(token: string, secret: string): { offerId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const offerId = parts[0];
  const nonce = parts[1];
  const signature = parts[2];
  if (offerId === undefined || nonce === undefined || signature === undefined) return null;
  const expected = createHmac("sha256", secret).update(`${offerId}.${nonce}`).digest("hex");
  if (expected.length !== signature.length) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { offerId };
}

export function hashBuyerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
