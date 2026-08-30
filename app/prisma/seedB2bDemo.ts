import { config } from "dotenv";
config();

import { db } from "@/lib/db";
import { seedFixture } from "@/fixtures/seedFixture";
import { ALL_DESK_DEMO_FIXTURES } from "@/fixtures/deskDemoDefinitions";

// One-off convenience seed for manually driving the three Commitment Desk demo cases
// through /desk with a real LLM — NOT part of the automated test suite (which seeds
// its own fixtures per-test via testDb). seedFixture() is itself idempotent/reset-safe
// per its own doc comment (deletes-and-recreates by fixtureId if it already exists),
// so this script can be re-run any number of times without extra dedup logic here.
async function main() {
  for (const fixture of ALL_DESK_DEMO_FIXTURES) {
    const { dealCase, customer } = await seedFixture(db, fixture);
    console.log(`Seeded ${fixture.fixtureId}: case ${dealCase.id} for ${fixture.companyName} / customer "${customer.name}" (expected terminal state: ${fixture.expectedTerminalState})`);
  }

  console.log(`\nSeeded ${ALL_DESK_DEMO_FIXTURES.length} desk demo cases. Try them at /desk.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
