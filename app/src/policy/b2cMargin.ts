export interface B2CMarginInput {
  buyPriceMinor: number; // per unit, from supplier negotiation
  quantity: number;
  operationalCostMinor: number; // fixed per-order, category-set — caller decides the value
  riskBufferBps: number; // % of buy value
}

export interface B2CMarginResult {
  sellPriceMinor: number;
  marginBps: number;
  advanceBps: number; // 10000 (100%), 7000 (70%), or 5000 (50%) by sell-value band
}

// Margin % bands are the midpoint of commitos-b2c-product-spec.md §4's documented
// ranges (<Rs25k: 10-15%, Rs25k-2L: 7-10%, >2L: 5-7%) — same "pick the range's
// midpoint" convention this codebase already used for MOTION_DURATION_MS in the
// Novel website plan, applied to a business-policy range instead of a UI-timing one.
// All three bands are comfortably above the spec's 5% minimum-acceptable-margin floor
// by construction (12.5/8.5/6% vs a 5% floor), so no runtime floor check exists here —
// if a future category-specific dynamic margin calculation replaces these fixed bands,
// reintroduce one.
function pickMarginBps(buyValueMinor: number): number {
  if (buyValueMinor < 25_000_00) return 1250;
  if (buyValueMinor <= 200_000_00) return 850;
  return 600;
}

// Advance % bands per commitos-b2c-product-spec.md §5.
function pickAdvanceBps(sellValueMinor: number): number {
  if (sellValueMinor < 50_000_00) return 10_000;
  if (sellValueMinor <= 500_000_00) return 7_000;
  return 5_000;
}

// Sell price formula per commitos-b2c-product-spec.md §4: confirmed buy price +
// operational cost + risk buffer (% of buy value) + margin (% of buy value).
export function calculateB2CQuote(input: B2CMarginInput): B2CMarginResult {
  const buyValueMinor = input.buyPriceMinor * input.quantity;
  const riskBufferMinor = Math.round((buyValueMinor * input.riskBufferBps) / 10_000);
  const marginBps = pickMarginBps(buyValueMinor);
  const marginMinor = Math.round((buyValueMinor * marginBps) / 10_000);
  const sellPriceMinor = buyValueMinor + input.operationalCostMinor + riskBufferMinor + marginMinor;
  const advanceBps = pickAdvanceBps(sellPriceMinor);
  return { sellPriceMinor, marginBps, advanceBps };
}
