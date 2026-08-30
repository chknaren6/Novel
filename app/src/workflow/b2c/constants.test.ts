import { describe, expect, it } from "vitest";
import { B2C_REQUIRED_DOMAINS } from "./constants";

describe("B2C_REQUIRED_DOMAINS", () => {
  it("is exactly ['supplier'] — B2C never extends credit and doesn't hold its own inventory", () => {
    expect(B2C_REQUIRED_DOMAINS).toEqual(["supplier"]);
  });
});
