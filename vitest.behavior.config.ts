import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Vitest configuration for behavioral E2E tests.
 *
 * These tests spawn real Claude CLI sessions and require:
 * - Claude CLI installed and authenticated
 * - Network access for API calls
 *
 * Run with: npm run test:behavior
 *
 * WARNING: Integration tests make real API calls and cost money!
 * Unit tests in these files run without Claude CLI.
 */
export default defineConfig({
  resolve: {
    alias: [
      // Test-to-test imports (tests importing from tests/lib/)
      // e.g., ../lib/behavioral-testing/session.js -> tests/lib/behavioral-testing/session.ts
      {
        find: /^\.\.\/lib\/(session-logging|behavioral-testing|harness-helpers)\/(.+)\.js$/,
        replacement: resolve(__dirname, "./tests/lib/$1/$2.ts"),
      },
      // Handle direct test helper imports
      {
        find: /^\.\.\/lib\/(harness-helpers)\.js$/,
        replacement: resolve(__dirname, "./tests/lib/$1.ts"),
      },
      // For deeper nesting (../../lib/)
      {
        find: /^\.\.\/\.\.\/lib\/(session-logging|behavioral-testing|harness-helpers)\/(.+)\.js$/,
        replacement: resolve(__dirname, "./tests/lib/$1/$2.ts"),
      },
      // Map relative ../lib/*.js imports from tests/ to ./src/lib/*.ts
      {
        find: /^(\.\.\/)+lib\/(.+)\.js$/,
        replacement: resolve(__dirname, "./src/lib/$2.ts"),
      },
      // For package imports
      {
        find: "claude-workflow/dist/lib",
        replacement: resolve(__dirname, "./src/lib"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // @ts-expect-error - hookTimeout is valid but not in TestConfig type
    hookTimeout: 300000, // 5 minute timeout for hooks (workflow tests are slow)
    testTimeout: 300000, // 5 minute timeout per test (integration tests are slow)

    // Register custom matchers before tests run
    setupFiles: ["./tests/setup.ts"],

    // Make output verbose and show failures immediately
    reporters: ["default"],

    // Show test output in real-time
    silent: false,

    // Use forks instead of threads for proper isolation
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },

    // Only include behavioral tests
    include: ["tests/behavior/**/*.test.ts"],

    // No excludes for behavioral config
    exclude: [],

    // Coverage not needed for behavioral tests
    coverage: {
      enabled: false,
    },
  },
});
