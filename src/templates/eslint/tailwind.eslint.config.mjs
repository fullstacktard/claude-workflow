/**
 * ESLint Configuration for Tailwind CSS v4
 *
 * This configuration enforces design token usage and Tailwind best practices.
 * It replaces shell-based CSS validation with proper ESLint integration,
 * providing IDE support and auto-fix capabilities.
 *
 * ## Key Rules
 *
 * | Rule                         | Level | Purpose                                    |
 * |------------------------------|-------|--------------------------------------------|
 * | no-arbitrary-value           | ERROR | Forces use of @theme design tokens         |
 * | no-contradicting-classname   | ERROR | Prevents conflicting classes like p-2 p-3  |
 * | enforces-shorthand           | WARN  | Suggests m-5 over mx-5 my-5                |
 * | classnames-order             | WARN  | Consistent class ordering                  |
 *
 * ## Usage
 *
 * Import and spread in your eslint.config.mjs:
 *
 * ```javascript
 * import tailwindConfig from "./.claude/templates/eslint/tailwind.eslint.config.mjs";
 * import yourOtherConfigs from "./your-configs.mjs";
 *
 * export default [
 *   ...tailwindConfig,
 *   ...yourOtherConfigs,
 * ];
 * ```
 *
 * ## Dependencies
 *
 * Install the Tailwind ESLint plugin:
 * ```bash
 * # For Tailwind v4 support (beta)
 * npm install -D eslint-plugin-tailwindcss@beta
 *
 * # For Tailwind v3 (stable)
 * npm install -D eslint-plugin-tailwindcss
 * ```
 *
 * ## Configuration
 *
 * Customize the settings.tailwindcss object below to match your project:
 * - config: Path to your tailwind.config.ts/js file
 * - cssFiles: For Tailwind v4 CSS-first config, path to your @theme CSS file
 * - whitelist: Custom classes to allow (bypasses no-custom-classname)
 * - callees: Functions that accept class strings (e.g., cn, clsx)
 *
 * @see https://github.com/francoismassart/eslint-plugin-tailwindcss
 */

import tailwindPlugin from "eslint-plugin-tailwindcss";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Include recommended Tailwind rules as base configuration
  ...tailwindPlugin.configs["flat/recommended"],

  // Custom rule overrides for design token enforcement
  {
    plugins: {
      tailwindcss: tailwindPlugin,
    },

    settings: {
      tailwindcss: {
        /**
         * Path to Tailwind configuration file (relative to project root)
         *
         * For Tailwind v3: Point to tailwind.config.ts/js
         * For Tailwind v4: Use cssFiles setting instead if using CSS-first config
         */
        config: "tailwind.config.ts",

        /**
         * CSS files containing @theme definitions (Tailwind v4)
         *
         * Uncomment and configure for Tailwind v4 CSS-first configuration:
         * cssFiles: ["./src/styles/theme.css"],
         */

        /**
         * Custom class patterns to allow
         *
         * Add patterns for custom utility classes that should be allowed:
         * whitelist: ["custom-.*", "legacy-.*"]
         */
        whitelist: [],

        /**
         * Regex pattern for attributes containing Tailwind classes
         *
         * Default matches class and className attributes
         */
        classRegex: "^class(Name)?$",

        /**
         * Function calls that accept class strings
         *
         * Add utility functions that concatenate/merge classes
         */
        callees: ["classnames", "clsx", "cn", "cva", "twMerge", "twJoin"],

        /**
         * Object keys to skip when parsing class strings
         *
         * Useful for CVA variant definitions
         */
        ignoredKeys: ["compoundVariants", "defaultVariants"],

        /**
         * Tags containing Tailwind classes
         *
         * For custom elements or frameworks that use different conventions
         */
        tags: [],
      },
    },

    rules: {
      /**
       * ERROR: no-arbitrary-value
       *
       * Forbids arbitrary values like bg-[#ff5733] or p-[17px].
       * Forces developers to use design tokens defined in @theme.
       *
       * This is the KEY rule for design system enforcement.
       *
       * Bad:  <div class="bg-[#ff5733] p-[17px]">
       * Good: <div class="bg-primary p-4">
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/no-arbitrary-value.md
       */
      "tailwindcss/no-arbitrary-value": "error",

      /**
       * ERROR: no-contradicting-classname
       *
       * Detects conflicting classes that override each other.
       * Prevents confusion and unintended styling.
       *
       * Bad:  <div class="p-2 p-3 text-sm text-lg">
       * Good: <div class="p-3 text-lg">
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/no-contradicting-classname.md
       */
      "tailwindcss/no-contradicting-classname": "error",

      /**
       * WARN: enforces-shorthand
       *
       * Suggests using shorthand classes when possible.
       * Reduces class list length and improves readability.
       *
       * Warning: <div class="mx-4 my-4">
       * Better:  <div class="m-4">
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/enforces-shorthand.md
       */
      "tailwindcss/enforces-shorthand": "warn",

      /**
       * WARN: classnames-order
       *
       * Enforces consistent ordering of Tailwind classes.
       * Makes merge conflicts easier to resolve and improves readability.
       *
       * Note: Prettier plugin also handles this - you may prefer one or the other
       * to avoid conflicts. Disable this rule if using prettier-plugin-tailwindcss.
       *
       * Warning: <div class="text-white p-4 flex">
       * Better:  <div class="flex p-4 text-white">
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/classnames-order.md
       */
      "tailwindcss/classnames-order": "warn",

      /**
       * OFF: no-custom-classname
       *
       * When enabled, only allows Tailwind-generated classes.
       * We keep this OFF to allow semantic classes for complex components.
       *
       * Enable this if you want PURE Tailwind (no custom classes).
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/no-custom-classname.md
       */
      "tailwindcss/no-custom-classname": "off",

      /**
       * WARN: no-unnecessary-arbitrary-value
       *
       * Replaces arbitrary values with equivalent theme values when possible.
       * Auto-fixable when there's an exact match.
       *
       * Warning: <div class="m-[1rem]">
       * Better:  <div class="m-4">
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/no-unnecessary-arbitrary-value.md
       */
      "tailwindcss/no-unnecessary-arbitrary-value": "warn",

      /**
       * WARN: enforces-negative-arbitrary-values
       *
       * Ensures correct syntax for negative arbitrary values.
       *
       * Warning: <div class="-top-[5px]">
       * Better:  <div class="top-[-5px]">
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/enforces-negative-arbitrary-values.md
       */
      "tailwindcss/enforces-negative-arbitrary-values": "warn",

      /**
       * OFF: migration-from-tailwind-2
       *
       * Detects Tailwind 2 classes deprecated in Tailwind 3.
       * Only enable during v2 -> v3 migrations.
       *
       * @see https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/master/docs/rules/migration-from-tailwind-2.md
       */
      "tailwindcss/migration-from-tailwind-2": "off",
    },
  },

  // File-specific overrides
  {
    // Apply Tailwind rules only to component files
    files: ["**/*.{js,jsx,ts,tsx,vue,svelte,astro}"],
    rules: {
      // Tailwind rules apply to all matched files
    },
  },

  {
    // shadcn UI components use Radix CSS variables and calc() expressions by design
    files: ["**/components/ui/**"],
    rules: {
      "tailwindcss/no-arbitrary-value": "off",
      "tailwindcss/no-custom-classname": "off",
    },
  },

  {
    // Disable arbitrary value restriction in config files
    files: ["**/*.config.{js,ts,mjs,cjs}", "**/*.d.ts", "**/tailwind.config.*"],
    rules: {
      "tailwindcss/no-arbitrary-value": "off",
    },
  },
];
