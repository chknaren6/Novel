import { PrismaClient } from "@prisma/client";

// A second Prisma client pointed at test.db, independent of the dev singleton in db.ts,
// so the test suite never touches dev.db.
//
// NOTE: this is provider-coupled to whatever prisma/schema.prisma's datasource currently
// is. While the datasource is sqlite (local MVP validation), this hardcoded file path is
// fine. If/when the datasource moves to Postgres (Supabase) again, this must go back to
// a required, separately-named TEST_DATABASE_URL env var — never DATABASE_URL — because
// resetTestDb() below does a full deleteMany() sweep that would silently wipe real data
// if it ever ran against a shared Postgres database.
export const testDb = new PrismaClient({
  datasources: { db: { url: "file:./test.db" } },
});

export async function resetTestDb() {
  await testDb.$transaction([
    testDb.outboxMessage.deleteMany(),
    testDb.stripeCheckoutMock.deleteMany(),
    testDb.crmStageEvent.deleteMany(),
    testDb.sandboxOrder.deleteMany(),
    testDb.caseEvent.deleteMany(),
    testDb.actionReceipt.deleteMany(),
    testDb.reservation.deleteMany(),
    testDb.commitCertificate.deleteMany(),
    testDb.counteroffer.deleteMany(),
    testDb.domainDecision.deleteMany(),
    testDb.termsVersion.deleteMany(),
    testDb.dealCase.deleteMany(),
    testDb.deliveryPlanOption.deleteMany(),
    testDb.supplierOption.deleteMany(),
    testDb.inventoryPosition.deleteMany(),
    testDb.customer.deleteMany(),
    testDb.marketplaceBuyer.deleteMany(),
    testDb.company.deleteMany(),
    testDb.operator.deleteMany(),
  ]);
}
