import { defineConfig } from "vitest/config";

export default defineConfig({
  // Exclude .claude directory from test collection
  exclude: ["**/node_modules", "**/dist", "**/.claude"],

  test: {
    globals: true,
    environment: "node",
    // @ts-expect-error - testTimeout is valid but not in types
    testTimeout: 30000, // 30 seconds for individual tests
    hookTimeout: 30000, // 30 seconds for hooks
    bail: 1, // Stop after first test failure
    passWithNoTests: false,
    watch: false, // Never run in watch mode - exits immediately after tests complete
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
