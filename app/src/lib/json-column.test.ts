import { describe, it, expect } from "vitest";
import { toJsonColumn, fromJsonColumn } from "./json-column";

describe("toJsonColumn / fromJsonColumn", () => {
  it("round-trips an object", () => {
    const value = { a: 1, b: ["x", "y"] };
    expect(fromJsonColumn<typeof value>(toJsonColumn(value))).toEqual(value);
  });

  it("round-trips an array", () => {
    const value = ["EVID-1", "EVID-2"];
    expect(fromJsonColumn<string[]>(toJsonColumn(value))).toEqual(value);
  });

  it("throws a clear error when the column doesn't hold valid JSON", () => {
    expect(() => fromJsonColumn("not json")).toThrow(/json-column/i);
  });
});
