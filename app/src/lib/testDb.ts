import { PrismaClient } from "@prisma/client";

// A second Prisma client pointed at TEST_DATABASE_URL, independent of the dev/prod
// singleton in db.ts (which reads DATABASE_URL), so the test suite never touches the
// same database an operator might be live-demoing against. Since the datasource is
// Postgres (not a throwaway local SQLite file), this is a required, separately-named
// env var rather than a hardcoded path — resetTestDb() below does a full deleteMany()
// sweep, which would silently wipe real demo data if it ever ran against DATABASE_URL
// by accident. Point it at a distinct Postgres schema/database (e.g. the same Supabase
// project with `?schema=test` appended to the connection string) so it's isolated but
// needs no separate signup.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "testDb: TEST_DATABASE_URL is not set. Point it at a Postgres database/schema " +
      "distinct from DATABASE_URL — resetTestDb() deletes all rows and must never run " +
      "against a database with real data in it.",
  );
}

export const testDb = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
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
