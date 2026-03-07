import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Vitest configuration for workflow E2E tests.
 *
 * These tests spawn real Claude CLI sessions and require:
 * - Claude CLI installed and authenticated
 * - Network access for API calls
 *
 * Run with: npm run test:workflow
 */
export default defineConfig({
  resolve: {
    alias: {
      "claude-workflow/dist/lib": resolve(__dirname, "./src/lib"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // @ts-expect-error - hookTimeout is valid but not in TestConfig type
    hookTimeout: 300000, // 5 minute timeout for hooks (workflow tests are slow)
    testTimeout: 180000, // 3 minute timeout per test

    // Register custom matchers before tests run
    setupFiles: ["./tests/setup.ts"],

    // Make output verbose and show failures immediately
    reporters: ["default"],
    outputFile: undefined,

    // Show test output in real-time
    logHeapUsage: false,
    silent: false, // Show output for workflow tests

    // Use forks instead of threads to support process.chdir()
    // Each test file runs in its own fork for proper isolation
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },

    // Only include workflow tests
    include: ["tests/workflow/**/*.test.ts"],

    // No excludes for workflow config
    exclude: [],

    // Coverage not needed for workflow tests
    coverage: {
      enabled: false,
    },
  },
});
