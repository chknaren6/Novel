// All money is integer minor units (paise). Never use floating point for currency.
export function rupeesToMinor(rupees: number): number {
  return Math.round(rupees * 100);
}

export function bpsOf(amountMinor: number, bps: number): number {
  return Math.floor((amountMinor * bps) / 10_000);
}

export function applyDiscountBps(amountMinor: number, discountBps: number): number {
  return amountMinor - bpsOf(amountMinor, discountBps);
}
