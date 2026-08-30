import type { PrismaClient } from "@prisma/client";
import type { RoleId, PaymentTerms } from "@/lib/types";
import type { ToolDefinition } from "@/gateway/modelGateway";
import { getDealContext, getCustomerCredit, getInventoryPositions, getSupplierOptions, getDeliveryOptions } from "./tools/readTools";
import { holdCreditEnvelope } from "@/adapters/creditAdapter";
import { holdInventory } from "@/adapters/inventoryAdapter";
import { holdSupplierOption } from "@/adapters/supplierAdapter";
import { holdDeliverySlot } from "@/adapters/logisticsAdapter";
import { MUTATION_TOOL_BY_ROLE } from "./toolPermissions";

export interface ReadToolContext {
  caseId: string;
  customerId: string;
  sku: string;
  destinationId: string;
}

const EMPTY_PARAMS = { type: "object", properties: {}, additionalProperties: false } as const;

export function buildReadTool(db: PrismaClient, name: string, ctx: ReadToolContext): ToolDefinition {
  switch (name) {
    case "get_deal_context":
      return { name, description: "Read the current deal context and permitted commercial levers.", parametersSchema: EMPTY_PARAMS, execute: async () => getDealContext(db, ctx.caseId) };
    case "get_customer_credit":
      return { name, description: "Read the customer's credit limit, exposure, and allowed payment terms.", parametersSchema: EMPTY_PARAMS, execute: async () => getCustomerCredit(db, ctx.customerId) };
    case "get_inventory_positions":
      return { name, description: "Read current warehouse inventory for the SKU.", parametersSchema: EMPTY_PARAMS, execute: async () => getInventoryPositions(db, ctx.sku) };
    case "get_supplier_options":
      return { name, description: "Read available supplier options for the SKU.", parametersSchema: EMPTY_PARAMS, execute: async () => getSupplierOptions(db, ctx.sku) };
    case "get_delivery_options":
      return { name, description: "Read available delivery plans to the destination.", parametersSchema: EMPTY_PARAMS, execute: async () => getDeliveryOptions(db, ctx.destinationId) };
    default:
      throw new Error(`Unknown read tool "${name}"`);
  }
}

export interface MutationToolContext {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  sku: string;
  customerId: string;
  paymentTerms: PaymentTerms;
}

// NOTE: Each mutation tool below does `rawArgs as {...}` with no runtime validation.
// openaiGateway.ts's toOpenAITool does NOT set `strict: true` on the function
// definition (unlike the final response_format=json_schema call), so nothing
// guarantees the model's parsed JSON tool-call arguments actually match the shape
// cast to here before this function runs — e.g. a missing field becomes `undefined`,
// which Prisma can silently treat as "field not provided" in a `where`/`data` clause
// rather than throwing (concretely: an `undefined` quantity would drop the
// `availableQuantity: { gte: undefined }` guard in inventoryAdapter.ts's
// holdInventory, silently passing the check it's meant to enforce). Known, deferred
// gap for this P0 pass — not an oversight. Full fix would be per-tool runtime
// validation (e.g. a zod schema, mirroring fakeGateway.ts's `.safeParse` pattern)
// converting a mismatch into `ToolError("INVALID_INPUT", ...)`.
export function buildMutationTool(db: PrismaClient, role: RoleId, ctx: MutationToolContext): ToolDefinition | null {
  const name = MUTATION_TOOL_BY_ROLE[role];
  if (!name) return null;

  if (name === "hold_credit_envelope") {
    return {
      name,
      description: "Hold a credit exposure envelope for the proposed terms.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["exposureMinor", "ttlSeconds"], properties: { exposureMinor: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (rawArgs: unknown) => {
        const args = rawArgs as { exposureMinor: number; ttlSeconds: number };
        return holdCreditEnvelope(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, customerId: ctx.customerId, paymentTerms: ctx.paymentTerms, exposureMinor: args.exposureMinor, ttlSeconds: args.ttlSeconds });
      },
    };
  }
  if (name === "hold_inventory") {
    return {
      name,
      description: "Hold available inventory for the SKU at a warehouse.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["warehouseId", "quantity", "ttlSeconds"], properties: { warehouseId: { type: "string" }, quantity: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (rawArgs: unknown) => {
        const args = rawArgs as { warehouseId: string; quantity: number; ttlSeconds: number };
        return holdInventory(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, sku: ctx.sku, warehouseId: args.warehouseId, quantity: args.quantity, ttlSeconds: args.ttlSeconds });
      },
    };
  }
  if (name === "hold_supplier_option") {
    return {
      name,
      description: "Hold a supplier option covering the shortfall quantity.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["supplierId", "quantity", "maxUnitCostMinor", "maxLeadDays", "ttlSeconds"], properties: { supplierId: { type: "string" }, quantity: { type: "integer" }, maxUnitCostMinor: { type: "integer" }, maxLeadDays: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (rawArgs: unknown) => {
        const args = rawArgs as { supplierId: string; quantity: number; maxUnitCostMinor: number; maxLeadDays: number; ttlSeconds: number };
        return holdSupplierOption(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, sku: ctx.sku, ...args });
      },
    };
  }
  if (name === "hold_delivery_slot") {
    return {
      name,
      description: "Hold delivery capacity on an existing plan.",
      parametersSchema: { type: "object", additionalProperties: false, required: ["planId", "quantity", "ttlSeconds"], properties: { planId: { type: "string" }, quantity: { type: "integer" }, ttlSeconds: { type: "integer" } } },
      execute: async (rawArgs: unknown) => {
        const args = rawArgs as { planId: string; quantity: number; ttlSeconds: number };
        return holdDeliverySlot(db, { caseId: ctx.caseId, caseVersion: ctx.caseVersion, termsHash: ctx.termsHash, ...args });
      },
    };
  }
  return null;
}
