import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    hookTimeout: 20000,
    testTimeout: 20000,
    // Every DB-touching test file shares one physical test.db (src/lib/testDb.ts) via
    // resetTestDb(). Running test files in parallel (Vitest's default) races those
    // resets/creates against each other across worker threads, producing intermittent
    // foreign-key-constraint failures unrelated to whatever's actually being tested.
    // Sequential file execution is the correct fix for a shared-file SQLite suite this
    // size, not a workaround — this isn't a real parallelism opportunity to preserve.
    fileParallelism: false,
  },
});
