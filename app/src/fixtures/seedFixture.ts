import type { PrismaClient } from "@prisma/client";
import { canonicalTermsHash } from "@/lib/hash";
import { toJsonColumn } from "@/lib/json-column";
import type { FixtureDefinition } from "./definitions";

async function deleteCaseAndRelations(db: PrismaClient, caseId: string) {
  await db.outboxMessage.deleteMany({ where: { caseId } });
  await db.stripeCheckoutMock.deleteMany({ where: { caseId } });
  await db.crmStageEvent.deleteMany({ where: { caseId } });
  await db.sandboxOrder.deleteMany({ where: { caseId } });
  await db.caseEvent.deleteMany({ where: { caseId } });
  await db.actionReceipt.deleteMany({ where: { caseId } });
  await db.reservation.deleteMany({ where: { caseId } });
  await db.commitCertificate.deleteMany({ where: { caseId } });
  await db.counteroffer.deleteMany({ where: { caseId } });
  await db.domainDecision.deleteMany({ where: { caseId } });
  await db.termsVersion.deleteMany({ where: { caseId } });
  await db.dealCase.delete({ where: { id: caseId } });
}

// Inserts one isolated company/case per fixture, or resets that fixture's own
// namespace transactionally if it already exists. It never touches a case that is not
// tagged with this fixture id.
export async function seedFixture(db: PrismaClient, fixture: FixtureDefinition) {
  const existing = await db.dealCase.findFirst({ where: { fixtureId: fixture.fixtureId } });
  if (existing) await deleteCaseAndRelations(db, existing.id);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const company = await db.company.create({ data: { name: fixture.companyName } });
  const customer = await db.customer.create({
    data: {
      companyId: company.id,
      ...fixture.customer,
      // allowedPaymentTerms is a String column (SQLite has no native Json type; see
      // prisma/schema.prisma and lib/json-column.ts) — must be serialized, not written
      // as a bare string[].
      allowedPaymentTerms: toJsonColumn(fixture.customer.allowedPaymentTerms),
    },
  });

  // Inventory/supplier/delivery-plan rows are shared world-state, not scoped by
  // caseId (no such column exists on these models), and CASE-STALE-SUPPLIER-HOLD
  // deliberately reuses the exact same sku/supplierId/planId as
  // CASE-FEASIBLE-AFTER-ADVANCE (its staleness is injected by the test, not by
  // different seed data). DeliveryPlanOption.planId is also globally @unique. So a
  // blind create() here would throw a unique-constraint error both on re-seeding the
  // same fixture and when seeding the full fixture list in one run — reset each row
  // by its natural key first, upsert-style.
  for (const position of fixture.inventory) {
    await db.inventoryPosition.deleteMany({ where: { sku: position.sku, warehouseId: position.warehouseId } });
    await db.inventoryPosition.create({ data: position });
  }
  for (const option of fixture.supplierOptions) {
    await db.supplierOption.deleteMany({ where: { supplierId: option.supplierId, sku: option.sku } });
    await db.supplierOption.create({ data: option });
  }
  for (const plan of fixture.deliveryPlans) {
    const { deliveryDateOffsetDays, ...rest } = plan;
    const deliveryDate = new Date(now + deliveryDateOffsetDays * dayMs);
    await db.deliveryPlanOption.upsert({
      where: { planId: plan.planId },
      create: { ...rest, deliveryDate },
      update: { ...rest, deliveryDate },
    });
  }

  const deliveryDeadline = new Date(now + fixture.initialTerms.deliveryDeadlineOffsetDays * dayMs);
  const termsHash = canonicalTermsHash({
    sku: fixture.initialTerms.sku,
    quantity: fixture.initialTerms.quantity,
    totalValueMinor: fixture.initialTerms.totalValueMinor,
    discountBps: fixture.initialTerms.discountBps,
    paymentTerms: fixture.initialTerms.paymentTerms,
    deliveryDeadline: deliveryDeadline.toISOString(),
  });

  const dealCase = await db.dealCase.create({
    data: {
      companyId: company.id,
      customerId: customer.id,
      fixtureId: fixture.fixtureId,
      activeTermsVersion: 1,
      status: "intake",
      createdBy: "seed",
    },
  });
  await db.termsVersion.create({
    data: {
      caseId: dealCase.id,
      version: 1,
      source: "buyer_request",
      termsHash,
      sku: fixture.initialTerms.sku,
      quantity: fixture.initialTerms.quantity,
      totalValueMinor: fixture.initialTerms.totalValueMinor,
      discountBps: fixture.initialTerms.discountBps,
      paymentTerms: fixture.initialTerms.paymentTerms,
      deliveryDeadline,
    },
  });

  return { dealCase, customer, termsHash };
}
