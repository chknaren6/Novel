import { describe, it, expect } from "vitest";
import { pickDeskDemoScript, scriptForCommitted, scriptForNegotiating, scriptForCannotCommit } from "./deskDemoScripts";
import { FIXTURE_DESK_COMMITTED, FIXTURE_DESK_NEGOTIATING, FIXTURE_DESK_CANNOT_COMMIT } from "@/fixtures/deskDemoDefinitions";

describe("pickDeskDemoScript", () => {
  it("maps each seeded demo fixture's sku to its own honest script", () => {
    expect(pickDeskDemoScript(FIXTURE_DESK_COMMITTED.initialTerms.sku)).toBe(scriptForCommitted);
    expect(pickDeskDemoScript(FIXTURE_DESK_NEGOTIATING.initialTerms.sku)).toBe(scriptForNegotiating);
    expect(pickDeskDemoScript(FIXTURE_DESK_CANNOT_COMMIT.initialTerms.sku)).toBe(scriptForCannotCommit);
  });

  it("returns null for a sku outside the three seeded demo fixtures", () => {
    expect(pickDeskDemoScript("SKU-UNKNOWN")).toBeNull();
  });
});
