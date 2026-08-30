import type { PrismaClient } from "@prisma/client";
import type { DealTerms, Evidence, PaymentTerms } from "@/lib/types";
import { ToolError } from "@/lib/types";
import { newId } from "@/lib/ids";
import { fromJsonColumn } from "@/lib/json-column";

function evidenceEnvelope<T>(source: string, data: T): Evidence<T> {
  return { evidenceId: newId("EVID"), observedAt: new Date().toISOString(), source, data };
}

// NOTE: None of the values read out below go through runtime schema validation
// before being returned as tool results, even though 05-TOOL-CONTRACTS.md describes
// tool results as "typed and schema-validated". The cast-based narrowing seen here
// (e.g. `paymentTerms as PaymentTerms`, `currency as "INR"`, the untyped `status`
// field) trusts DB values as-is for this P0 build's fixed-fixture scope. Full runtime
// validation is a deferred follow-up, not fixed in this pass.

export async function getDealContext(db: PrismaClient, caseId: string) {
  const dealCase = await db.dealCase.findUnique({ where: { id: caseId } });
  if (!dealCase) {
    throw new ToolError("RESOURCE_UNAVAILABLE", `Case ${caseId} not found`, false);
  }
  const terms = await db.termsVersion.findUnique({
    where: { caseId_version: { caseId, version: dealCase.activeTermsVersion } },
  });
  if (!terms) {
    throw new ToolError(
      "RESOURCE_UNAVAILABLE",
      `No terms version ${dealCase.activeTermsVersion} found for case ${caseId}`,
      false,
    );
  }
  return evidenceEnvelope("deal_case", {
    customerId: dealCase.customerId,
    strategicTier: "standard" as const,
    currentTerms: {
      sku: terms.sku,
      quantity: terms.quantity,
      currency: terms.currency as "INR",
      totalValueMinor: terms.totalValueMinor,
      discountBps: terms.discountBps,
      paymentTerms: terms.paymentTerms as PaymentTerms,
      deliveryDeadline: terms.deliveryDeadline.toISOString(),
    } satisfies DealTerms,
    permittedCommercialLevers: ["ADVANCE_30"],
  });
}

export async function getCustomerCredit(db: PrismaClient, customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new ToolError("RESOURCE_UNAVAILABLE", `Customer ${customerId} not found`, false);
  }
  return evidenceEnvelope("customer", {
    creditLimitMinor: customer.creditLimitMinor,
    currentExposureMinor: customer.currentExposureMinor,
    overdueReceivablesMinor: customer.overdueReceivablesMinor,
    // allowedPaymentTerms is stored as a JSON string in this SQLite column (see
    // prisma/schema.prisma and lib/json-column.ts), not a native Json/array type.
    allowedPaymentTerms: fromJsonColumn<string[]>(customer.allowedPaymentTerms),
    policyVersion: customer.policyVersion,
  });
}

export async function getInventoryPositions(db: PrismaClient, sku: string) {
  const positions = await db.inventoryPosition.findMany({ where: { sku } });
  return evidenceEnvelope("inventory_position", {
    positions: positions.map((p) => ({ warehouseId: p.warehouseId, availableQuantity: p.availableQuantity, earliestHoldExpiry: p.earliestHoldExpiry?.toISOString() ?? null })),
  });
}

// NOTE: This returns every supplier option for the SKU, without narrowing by the
// additional `requiredQuantity` parameter that 05-TOOL-CONTRACTS.md describes for
// this tool. Deferred until a caller (role runtime / tool registry, a later task)
// actually needs and can supply it — not a silent oversight.
export async function getSupplierOptions(db: PrismaClient, sku: string) {
  const options = await db.supplierOption.findMany({ where: { sku } });
  return evidenceEnvelope("supplier_option", {
    options: options.map((o) => ({ supplierId: o.supplierId, availableQuantity: o.availableQuantity, unitCostMinor: o.unitCostMinor, leadDays: o.leadDays, optionTtlSeconds: o.optionTtlSeconds, status: o.status })),
  });
}

// NOTE: This returns every delivery plan for the destination, without narrowing by
// the additional `backedOrigins`/`deadline` parameters that 05-TOOL-CONTRACTS.md
// describes for this tool. Deferred until a caller (role runtime / tool registry, a
// later task) actually needs and can supply them — not a silent oversight.
export async function getDeliveryOptions(db: PrismaClient, destinationId: string) {
  const plans = await db.deliveryPlanOption.findMany({ where: { destinationId } });
  return evidenceEnvelope("delivery_plan_option", {
    plans: plans.map((p) => ({ planId: p.planId, deliveredQuantity: p.deliveredQuantity, deliveryDate: p.deliveryDate.toISOString(), costMinor: p.costMinor, splitShipment: p.splitShipment, capacityRemaining: p.capacityRemaining })),
  });
}
