import { describe, it, expect } from "vitest";
import { calculateDealEconomics } from "./economics";

describe("calculateDealEconomics", () => {
  it("matches the Case 1 fixture: 350 units of MAT-10001 at real ERP pricing, 10% discount, 30% deposit", () => {
    const result = calculateDealEconomics({
      totalValueMinor: 147_000_000, // 350 x MARA.NETPR (Rs 4,200) x 100
      discountBps: 1000,
      quantity: 350,
      unitCostMinor: 293_312, // MBEW.STPRS for MAT-10001 (Rs 2,933.12)
      paymentTerms: "ADVANCE_30",
      depositBps: 3000,
    });

    expect(result.revenueMinor).toBe(147_000_000);
    expect(result.depositMinor).toBe(44_100_000); // Rs 4,41,000 = Rs 4.41L
    expect(result.costMinor).toBe(102_659_200);
    expect(result.contributionMinor).toBe(44_340_800);
    expect(result.contributionMarginBps).toBeGreaterThan(1774); // above the 17.74% MBEW.FLOOR_MARGIN floor
    expect(result.creditExposureMinor).toBe(147_000_000 - 44_100_000);
  });

  it("exposes full revenue as credit exposure under NET_60 (no deposit reduces it)", () => {
    const result = calculateDealEconomics({
      totalValueMinor: 147_000_000,
      discountBps: 1000,
      quantity: 350,
      unitCostMinor: 293_312,
      paymentTerms: "NET_60",
      depositBps: 0,
    });
    expect(result.creditExposureMinor).toBe(147_000_000);
    expect(result.depositMinor).toBe(0);
  });
});
