import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Entry points: Start tracing from your main TS files
  entry: [
    "**/*.ts",
    "!**/*.test.ts",
    "!**/*.d.ts",
  ],

  // Project files: ONLY TS files
  project: [
    "**/*.ts",
    "**/*.d.ts",
  ],

  // Ignore non-code files
  ignore: [
    ".claude/**",
    "backlog/**",
    "docs/**",
    "coverage/**",
    "dist/**",
    "tests/**",
    "**/*.js",
  ],

  // Ignore files that aren't code
  ignoreFiles: [
    "**/*.md",
    "tsconfig*.json",
    "eslint.config.*",
    "**/*.config.ts",
    "**/*.template.*",
    "node_modules/**",
  ],

  // CLI tools and config-only dependencies from claude-workflow scaffold
  // These are never imported in code but are required for tooling
  ignoreDependencies: [
    // Task management CLI
    "backlog.md",

    // TypeScript execution/compilation (CLI tools)
    "tsx",
    "ts-node",
    "typescript",
    "esbuild",
    "jiti",

    // Testing framework (CLI, config-based)
    "vitest",
    "@vitest/coverage-v8",
    "@vitest/ui",

    // Linting (CLI, config-based)
    "eslint",
    "@eslint/compat",
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
    "typescript-eslint",
    "eslint-import-resolver-typescript",
    "eslint-plugin-import",
    "eslint-plugin-perfectionist",
    "eslint-plugin-react",
    "eslint-plugin-react-hooks",
    "eslint-plugin-unicorn",
    "eslint-plugin-unused-imports",
    "eslint-plugin-vitest",
    "globals",

    // Unused code detection (CLI)
    "knip",

    // CSS tooling (config-based)
    "autoprefixer",

    // .claude/lib/ dependencies (validation, LSP)
    // Used by claude-workflow hooks/scripts but in ignored directory
    "ajv",
    "ajv-formats",
    "typescript-language-server",
  ],

  // Ignore exports that are used within the same file (interface composition)
  ignoreExportsUsedInFile: true,

  // Aggressive: ALL rules enabled at "error" level
  rules: {
    files: "error",
    exports: "error",
    types: "error",
    duplicates: "error",
    binaries: "error",
    dependencies: "error",
    devDependencies: "error",
    unlisted: "error",
  },

  // Use TypeScript plugin with tsconfig
  typescript: {
    config: ["tsconfig.json"],
  },
};

export default config;
