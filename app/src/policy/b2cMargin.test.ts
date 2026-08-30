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

  it("uses the mid margin band exactly at the Rs25k lower boundary (inclusive of the next band)", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 25_000_00, quantity: 1, operationalCostMinor: 0, riskBufferBps: 0 });
    expect(result.marginBps).toBe(850);
    expect(result.advanceBps).toBe(10_000);
  });

  it("uses the mid margin band exactly at the Rs2L upper boundary (inclusive)", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 200_000_00, quantity: 1, operationalCostMinor: 0, riskBufferBps: 0 });
    expect(result.marginBps).toBe(850);
    expect(result.advanceBps).toBe(7_000);
  });

  it("uses the top margin band one paisa above the Rs2L upper boundary", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 200_000_01, quantity: 1, operationalCostMinor: 0, riskBufferBps: 0 });
    expect(result.marginBps).toBe(600);
  });

  it("uses the 70% advance band exactly at the Rs50k sell-value boundary (inclusive)", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 1_000_000, quantity: 1, operationalCostMinor: 3_875_000, riskBufferBps: 0 });
    expect(result.sellPriceMinor).toBe(50_000_00);
    expect(result.marginBps).toBe(1250);
    expect(result.advanceBps).toBe(7_000);
  });

  it("uses the 70% advance band exactly at the Rs5L sell-value boundary (inclusive)", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 21_000_000, quantity: 1, operationalCostMinor: 27_740_000, riskBufferBps: 0 });
    expect(result.marginBps).toBe(600);
    expect(result.sellPriceMinor).toBe(500_000_00);
    expect(result.advanceBps).toBe(7_000);
  });

  it("uses the 50% advance band one paisa above the Rs5L sell-value boundary", () => {
    const result = calculateB2CQuote({ buyPriceMinor: 21_000_000, quantity: 1, operationalCostMinor: 27_740_001, riskBufferBps: 0 });
    expect(result.sellPriceMinor).toBe(500_000_01);
    expect(result.advanceBps).toBe(5_000);
  });
});
