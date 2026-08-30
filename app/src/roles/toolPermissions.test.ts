import { describe, it, expect } from "vitest";
import { isReadToolAllowed, MUTATION_TOOL_BY_ROLE } from "./toolPermissions";

describe("isReadToolAllowed", () => {
  it("allows Sales and Risk to read deal context, and no one else", () => {
    expect(isReadToolAllowed("sales", "get_deal_context")).toBe(true);
    expect(isReadToolAllowed("risk", "get_deal_context")).toBe(true);
    expect(isReadToolAllowed("finance", "get_deal_context")).toBe(false);
  });

  it("allows Inventory, Logistics, and Risk to read inventory positions", () => {
    expect(isReadToolAllowed("inventory", "get_inventory_positions")).toBe(true);
    expect(isReadToolAllowed("logistics", "get_inventory_positions")).toBe(true);
    expect(isReadToolAllowed("risk", "get_inventory_positions")).toBe(true);
    expect(isReadToolAllowed("procurement", "get_inventory_positions")).toBe(false);
  });
});

describe("MUTATION_TOOL_BY_ROLE", () => {
  it("gives exactly one scoped hold tool to Finance, Inventory, Procurement, and Logistics, and none to Sales or Risk", () => {
    expect(MUTATION_TOOL_BY_ROLE.finance).toBe("hold_credit_envelope");
    expect(MUTATION_TOOL_BY_ROLE.inventory).toBe("hold_inventory");
    expect(MUTATION_TOOL_BY_ROLE.procurement).toBe("hold_supplier_option");
    expect(MUTATION_TOOL_BY_ROLE.logistics).toBe("hold_delivery_slot");
    expect(MUTATION_TOOL_BY_ROLE.sales).toBeUndefined();
    expect(MUTATION_TOOL_BY_ROLE.risk).toBeUndefined();
  });
});
