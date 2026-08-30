import { describe, expect, it } from "vitest";
import { calculateB2CQuote } from "./b2cMargin";

describe("calculateB2CQuote", () => {
  it("applies the under-Rs25k margin band and 100% advance for a small order", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 1000_00, quantity: 10, operationalCostMinor: 1500_00, riskBufferBps: 500 });
    expect(result.marginBps).toBe(1250);
    expect(result.sellPriceMinor).toBe(1_325_000);
    expect(result.advanceBps).toBe(10_000);
  });

  it("applies the mid-band margin and 70% advance for a mid-size order", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 100_000_00, quantity: 1, operationalCostMinor: 1500_00, riskBufferBps: 500 });
    expect(result.marginBps).toBe(850);
    expect(result.advanceBps).toBe(7_000);
  });

  it("applies the top-band margin and 50% advance for a large order", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 800_000_00, quantity: 1, operationalCostMinor: 1500_00, riskBufferBps: 500 });
    expect(result.marginBps).toBe(600);
    expect(result.sellPriceMinor).toBe(88_950_000);
    expect(result.advanceBps).toBe(5_000);
  });
});
