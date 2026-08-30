import { config } from "dotenv";

// This repo keeps local env vars in .env.local (Next.js convention), not the plain
// .env that dotenv/config loads by default — load it explicitly, then fall back to a
// plain .env for portability (config() never overrides an already-set var).
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { seedFixture } from "@/fixtures/seedFixture";
import { ALL_FIXTURES } from "@/fixtures/definitions";

async function main() {
  for (const fixture of ALL_FIXTURES) {
    const { dealCase } = await seedFixture(db, fixture);
    console.log(`Seeded ${fixture.fixtureId} -> case ${dealCase.id}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
