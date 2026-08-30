import { config } from "dotenv";
config();

import { db } from "@/lib/db";

// One-off convenience seed for manually testing the /market flow locally — NOT part of
// the automated test suite (which seeds its own fixtures per-test via testDb). Creates
// a single supplier option an operator can immediately search for and quote against.
// Safe to run more than once: upserts on (supplierId, sku).
const DEMO_SKU = "SKU-COPPER-4MM";
const DEMO_SUPPLIER_ID = "VEND-DEMO-A";

async function main() {
  const existing = await db.supplierOption.findFirst({
    where: { supplierId: DEMO_SUPPLIER_ID, sku: DEMO_SKU },
  });

  if (existing) {
    console.log(`Already seeded: supplier ${DEMO_SUPPLIER_ID} / sku ${DEMO_SKU} (id ${existing.id})`);
    return;
  }

  const created = await db.supplierOption.create({
    data: {
      supplierId: DEMO_SUPPLIER_ID,
      sku: DEMO_SKU,
      availableQuantity: 1000,
      unitCostMinor: 100_00, // ₹100.00/unit
      leadDays: 10,
      optionTtlSeconds: 900,
      status: "available",
    },
  });

  console.log(`Seeded supplier option ${created.id}: ${DEMO_SUPPLIER_ID} / ${DEMO_SKU} @ ₹100.00, 10-day lead`);
  console.log(`\nTry it at /market with SKU: ${DEMO_SKU}`);
  console.log(`e.g. raw request: "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore"`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
