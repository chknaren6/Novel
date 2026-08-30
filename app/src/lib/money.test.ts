import { describe, it, expect } from "vitest";
import { rupeesToMinor, bpsOf, applyDiscountBps } from "./money";

describe("money helpers", () => {
  it("converts whole rupees to minor units", () => {
    expect(rupeesToMinor(1_470_000)).toBe(147_000_000);
  });

  it("computes basis points of a minor-unit amount, rounding down", () => {
    expect(bpsOf(147_000_000, 1000)).toBe(14_700_000); // 10% of ₹14.7L
  });

  it("applies a discount in basis points", () => {
    expect(applyDiscountBps(147_000_000, 1000)).toBe(147_000_000 - 14_700_000);
  });
});
