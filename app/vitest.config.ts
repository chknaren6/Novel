import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
