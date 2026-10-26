import { defineConfig } from "vitest/config";

// Unit tests for src/. Runner and harness tests use node --test (see package.json).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
