import type { RoleId } from "@/lib/types";

// From 05-TOOL-CONTRACTS.md "Read tools" — which roles may call which read tool.
export const READ_TOOL_PERMISSIONS: Record<string, RoleId[]> = {
  get_deal_context: ["sales", "risk"],
  get_customer_credit: ["finance", "risk"],
  get_inventory_positions: ["inventory", "logistics", "risk"],
  get_supplier_options: ["procurement", "risk"],
  get_delivery_options: ["logistics", "risk"],
};

export function isReadToolAllowed(role: RoleId, toolName: string): boolean {
  return READ_TOOL_PERMISSIONS[toolName]?.includes(role) ?? false;
}

// From 05-TOOL-CONTRACTS.md "Reservation tools" — at most one scoped mutation tool per
// role. Sales and Risk intentionally have none (03-AGENT-ARCHITECTURE.md: "Risk has no
// mutation tools"; Sales "cannot hold resources").
export const MUTATION_TOOL_BY_ROLE: Partial<Record<RoleId, string>> = {
  finance: "hold_credit_envelope",
  inventory: "hold_inventory",
  procurement: "hold_supplier_option",
  logistics: "hold_delivery_slot",
};
