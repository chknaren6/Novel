import type { PaymentTerms } from "@/lib/types";

export interface DealEconomicsInput {
  totalValueMinor: number;
  discountBps: number;
  quantity: number;
  unitCostMinor: number;
  paymentTerms: PaymentTerms;
  depositBps: number;
}

export interface DealEconomics {
  revenueMinor: number;
  listPriceMinor: number;
  discountCostMinor: number;
  costMinor: number;
  contributionMinor: number;
  contributionMarginBps: number;
  depositMinor: number;
  creditExposureMinor: number;
}

// The sole source of truth for money. Neither role agents nor the UI recompute these
// figures; every consumer reads this output (05-TOOL-CONTRACTS.md: "The model supplies
// no calculated totals").
export function calculateDealEconomics(input: DealEconomicsInput): DealEconomics {
  const revenueMinor = input.totalValueMinor;
  const listPriceMinor = Math.round(revenueMinor / (1 - input.discountBps / 10_000));
  const discountCostMinor = listPriceMinor - revenueMinor;
  const costMinor = input.unitCostMinor * input.quantity;
  const contributionMinor = revenueMinor - costMinor;
  const contributionMarginBps =
    revenueMinor === 0 ? 0 : Math.round((contributionMinor * 10_000) / revenueMinor);
  const depositMinor = Math.round((revenueMinor * input.depositBps) / 10_000);
  const creditExposureMinor =
    input.paymentTerms === "NET_60" ? revenueMinor : revenueMinor - depositMinor;

  return {
    revenueMinor,
    listPriceMinor,
    discountCostMinor,
    costMinor,
    contributionMinor,
    contributionMarginBps,
    depositMinor,
    creditExposureMinor,
  };
}

// Per-SKU unit cost is a policy/fixture constant, not user input — it lives here next
// to the engine that consumes it rather than threaded through every API call.
// Task 23 documents how 293_312 (MBEW.STPRS) was chosen for MAT-10001.
export const SKU_UNIT_COST_MINOR: Record<string, number> = {
  "MAT-10001": 293_312,
};
