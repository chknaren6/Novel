import type { PrismaClient } from "@prisma/client";

export interface SupplierCandidate {
  supplierId: string;
  unitCostMinor: number;
  leadDays: number;
  availableQuantity: number;
  freshnessTier: string | null;
  isStale: boolean;
}

// commitos-b2c-product-spec.md §6: "human confirmation required if data > 20 hours old"
// for a Tier 3 (daily-snapshot) supplier.
const STALE_THRESHOLD_MS = 20 * 60 * 60 * 1000;

// Deterministic supplier-graph query, not a reasoning agent — "here are 3 ranked
// candidates" doesn't fit the RoleModelOutput decision vocabulary (approve/counter/
// veto/unavailable), so this is a plain typed function, not a ModelGateway role.
export async function findSupplierCandidates(
  db: PrismaClient,
  input: { sku: string; quantity: number },
): Promise<SupplierCandidate[]> {
  const options = await db.supplierOption.findMany({
    where: { sku: input.sku, status: "available", availableQuantity: { gte: input.quantity } },
  });
  const now = Date.now();
  return options
    .map((option) => ({
      supplierId: option.supplierId,
      unitCostMinor: option.unitCostMinor,
      leadDays: option.leadDays,
      availableQuantity: option.availableQuantity,
      freshnessTier: option.freshnessTier,
      isStale:
        option.freshnessTier === "tier3" &&
        (!option.lastVerifiedAt || now - option.lastVerifiedAt.getTime() > STALE_THRESHOLD_MS),
    }))
    .sort((a, b) => a.unitCostMinor - b.unitCostMinor || a.leadDays - b.leadDays);
}
