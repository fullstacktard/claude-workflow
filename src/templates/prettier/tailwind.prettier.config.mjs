/**
 * Prettier Configuration with Tailwind CSS Class Sorting
 *
 * This configuration automatically sorts Tailwind classes according to
 * Tailwind's recommended order. It improves code readability and
 * reduces merge conflicts from class reordering.
 *
 * IMPORTANT: prettier-plugin-tailwindcss MUST be loaded LAST!
 * If you have other Prettier plugins, add them before tailwindcss.
 *
 * @example Plugin ordering with multiple plugins:
 * plugins: [
 *   "prettier-plugin-svelte",
 *   "prettier-plugin-organize-imports",
 *   "prettier-plugin-tailwindcss",  // MUST be last!
 * ]
 *
 * @see https://github.com/tailwindlabs/prettier-plugin-tailwindcss
 */

/** @type {import("prettier").Config} */
export default {
  /**
   * Plugins array - Tailwind plugin MUST be last
   *
   * The tailwindcss plugin wraps the parsers of other plugins,
   * so it needs to be loaded after them to work correctly.
   */
  plugins: ["prettier-plugin-tailwindcss"],

  /**
   * Tailwind v4: Path to your CSS file containing @theme
   *
   * For Tailwind v4 (CSS-first config), point to the CSS file
   * where your @theme directive and design tokens are defined.
   *
   * Path is relative to the Prettier config file location.
   *
   * @example "./src/styles/theme.css"
   * @example "./app/globals.css"
   */
  tailwindStylesheet: "./src/styles/theme.css",

  /**
   * Tailwind v3: Path to your Tailwind config file
   *
   * For Tailwind v3 (JS config), point to your tailwind.config.js/ts.
   * Uncomment this and remove tailwindStylesheet for v3 projects.
   *
   * @example "./tailwind.config.ts"
   */
  // tailwindConfig: "./tailwind.config.ts",

  /**
   * Functions that accept Tailwind class strings
   *
   * The plugin will sort classes inside these function calls.
   * Add any utility functions your project uses for class composition.
   *
   * Common libraries:
   * - clsx: https://github.com/lukeed/clsx
   * - cn: shadcn/ui's utility (usually wraps clsx + twMerge)
   * - cva: Class Variance Authority
   * - twMerge: Tailwind Merge for deduplication
   * - classnames: Classic classnames library
   */
  tailwindFunctions: ["clsx", "cn", "cva", "twMerge", "classnames"],

  /**
   * HTML attributes to sort Tailwind classes in
   *
   * By default, 'class' and 'className' are sorted.
   * Add framework-specific attributes as needed.
   *
   * Common additions:
   * - ':class' (Vue dynamic classes)
   * - 'ngClass' (Angular)
   * - 'class:list' (Astro)
   */
  tailwindAttributes: ["class", "className", ":class", "ngClass"],

  // ============================================
  // Standard Prettier Options
  // ============================================

  /**
   * Use semicolons at the end of statements
   */
  semi: true,

  /**
   * Use single quotes instead of double quotes
   */
  singleQuote: true,

  /**
   * Number of spaces per indentation level
   */
  tabWidth: 2,

  /**
   * Trailing commas in multi-line arrays and objects
   * "es5" - trailing commas where valid in ES5
   */
  trailingComma: "es5",

  /**
   * Maximum line length before wrapping
   */
  printWidth: 100,

  /**
   * Use spaces instead of tabs
   */
  useTabs: false,

  /**
   * JSX quotes - use double quotes in JSX
   */
  jsxSingleQuote: false,

  /**
   * Put the > of a multi-line JSX element on a new line
   */
  bracketSameLine: false,

  /**
   * Enforce parentheses around a sole arrow function parameter
   */
  arrowParens: "always",

  /**
   * Line endings (auto = use existing line endings)
   */
  endOfLine: "auto",
};
