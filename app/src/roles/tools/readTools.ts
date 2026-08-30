import type { PrismaClient } from "@prisma/client";
import type { DealTerms, Evidence, PaymentTerms } from "@/lib/types";
import { newId } from "@/lib/ids";
import { fromJsonColumn } from "@/lib/json-column";

function evidenceEnvelope<T>(source: string, data: T): Evidence<T> {
  return { evidenceId: newId("EVID"), observedAt: new Date().toISOString(), source, data };
}

export async function getDealContext(db: PrismaClient, caseId: string) {
  const dealCase = await db.dealCase.findUniqueOrThrow({ where: { id: caseId } });
  const terms = await db.termsVersion.findFirstOrThrow({ where: { caseId, version: dealCase.activeTermsVersion } });
  return evidenceEnvelope("deal_case", {
    customerId: dealCase.customerId,
    strategicTier: "standard" as const,
    currentTerms: {
      sku: terms.sku,
      quantity: terms.quantity,
      currency: "INR" as const,
      totalValueMinor: terms.totalValueMinor,
      discountBps: terms.discountBps,
      paymentTerms: terms.paymentTerms as PaymentTerms,
      deliveryDeadline: terms.deliveryDeadline.toISOString(),
    } satisfies DealTerms,
    permittedCommercialLevers: ["ADVANCE_30"],
  });
}

export async function getCustomerCredit(db: PrismaClient, customerId: string) {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
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

export async function getSupplierOptions(db: PrismaClient, sku: string) {
  const options = await db.supplierOption.findMany({ where: { sku } });
  return evidenceEnvelope("supplier_option", {
    options: options.map((o) => ({ supplierId: o.supplierId, availableQuantity: o.availableQuantity, unitCostMinor: o.unitCostMinor, leadDays: o.leadDays, optionTtlSeconds: o.optionTtlSeconds, status: o.status })),
  });
}

export async function getDeliveryOptions(db: PrismaClient, destinationId: string) {
  const plans = await db.deliveryPlanOption.findMany({ where: { destinationId } });
  return evidenceEnvelope("delivery_plan_option", {
    plans: plans.map((p) => ({ planId: p.planId, deliveredQuantity: p.deliveredQuantity, deliveryDate: p.deliveryDate.toISOString(), costMinor: p.costMinor, splitShipment: p.splitShipment, capacityRemaining: p.capacityRemaining })),
  });
}
