import { PrismaClient } from "@prisma/client";

// A second Prisma client pointed at test.db, independent of the dev singleton in db.ts,
// so the test suite never touches dev.db.
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
