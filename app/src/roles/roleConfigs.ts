import type { RoleId } from "@/lib/types";

export interface RoleConfig {
  role: RoleId;
  objective: string;
  visibleContextSelectors: string[];
  allowedReadTools: string[];
  allowedMutationTools: string[];
  authority: string[];
  memoryNamespace: string;
}

// From 03-AGENT-ARCHITECTURE.md "Role definitions". Each role gets its own objective,
// visible context, tools, and authority — never the union of all six.
export const ROLE_CONFIGS: Record<RoleId, RoleConfig> = {
  sales: {
    role: "sales",
    objective: "Maximize acceptable account value while proposing only bounded terms supported by other domains.",
    visibleContextSelectors: ["dealContext"],
    allowedReadTools: ["get_deal_context"],
    allowedMutationTools: [],
    authority: ["propose_terms", "propose_counterterm"],
    memoryNamespace: "role:sales",
  },
  finance: {
    role: "finance",
    objective: "Protect contribution margin, credit exposure, and working-capital policy.",
    visibleContextSelectors: ["customerCredit", "dealEconomics"],
    allowedReadTools: ["get_customer_credit"],
    allowedMutationTools: ["hold_credit_envelope"],
    authority: ["approve_credit", "counter_credit", "veto_credit"],
    memoryNamespace: "role:finance",
  },
  inventory: {
    role: "inventory",
    objective: "Allocate currently available stock without violating existing commitments.",
    visibleContextSelectors: ["inventoryPositions"],
    allowedReadTools: ["get_inventory_positions"],
    allowedMutationTools: ["hold_inventory"],
    authority: ["approve_allocation", "veto_allocation"],
    memoryNamespace: "role:inventory",
  },
  procurement: {
    role: "procurement",
    objective: "Cover supply shortfall at permitted cost and lead time.",
    visibleContextSelectors: ["supplierOptions"],
    allowedReadTools: ["get_supplier_options"],
    allowedMutationTools: ["hold_supplier_option"],
    authority: ["approve_supply", "counter_supply", "veto_supply"],
    memoryNamespace: "role:procurement",
  },
  logistics: {
    role: "logistics",
    objective: "Produce a deliverable shipment plan using only backed quantities.",
    visibleContextSelectors: ["inventoryPositions", "deliveryOptions"],
    allowedReadTools: ["get_inventory_positions", "get_delivery_options"],
    allowedMutationTools: ["hold_delivery_slot"],
    authority: ["approve_delivery", "counter_delivery", "veto_delivery"],
    memoryNamespace: "role:logistics",
  },
  risk: {
    role: "risk",
    objective: "Falsify unsafe commitments and expose stale or unsupported evidence.",
    visibleContextSelectors: ["dealContext", "customerCredit", "inventoryPositions", "supplierOptions", "deliveryOptions"],
    allowedReadTools: ["get_deal_context", "get_customer_credit", "get_inventory_positions", "get_supplier_options", "get_delivery_options"],
    allowedMutationTools: [],
    authority: ["challenge", "veto"],
    memoryNamespace: "role:risk",
  },
};

const PROMPT_RULES =
  "Missing or stale evidence must produce decision=unavailable or decision=veto, never approve. " +
  "Never invent a receipt, identifier, balance, quantity, price, or date; use only values a tool returned. " +
  "Deterministic tool results override your own reasoning if they conflict. " +
  "You may not claim that another role approved anything. " +
  "You may call at most one tool during this run.";

// Short, role-specific, stored in versioned source code — never dynamically rewritten
// based on agent output (03-AGENT-ARCHITECTURE.md "Prompt requirements").
export function buildSystemPrompt(config: RoleConfig): string {
  return [
    `You are the ${config.role} role agent in CommitOS. Objective: ${config.objective}`,
    `Your authority is limited to: ${config.authority.join(", ")}.`,
    `Allowed tools: ${[...config.allowedReadTools, ...config.allowedMutationTools].join(", ") || "none"}.`,
    PROMPT_RULES,
    "Respond only with the required structured decision object.",
  ].join(" ");
}
