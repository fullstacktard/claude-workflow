import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";
import unicorn from "eslint-plugin-unicorn";
import { fixupPluginRules } from "@eslint/compat";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "unused-imports": unusedImports,
      react: fixupPluginRules(react),
      "react-hooks": fixupPluginRules(reactHooks),
    },
    settings: {
      react: { version: "detect" },
    },
  },

  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/build/",
      "**/coverage/",
      "**/.next/",
      "**/.turbo/",
      "**/.vercel/",
      "**/.claude/",
      "*.min.js",
      "*.bundle.js",
      "**/*.config.js",
      "**/*.config.ts",
      "**/*.template.*",
      "main.js",
      "research/",
      "scripts/",
      "tests/",
      "**/*.test.ts",
      "**/*.test.js",
      "**/*.test.tsx",
      "**/*.test.jsx",
      "**/__tests__/**",
      "**/*.js",
      "**/*.jsx",
    ],
  },

  { files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"] },

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  unicorn.configs["recommended"],

  {
    rules: {
      indent: ["error", 2],
      "linebreak-style": ["error", "unix"],
      semi: ["error", "always"],
      "no-console": "off",
      "no-magic-numbers": "off",
      "sort-imports": "off",

      "@typescript-eslint/no-magic-numbers": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/no-unused-vars": "off",

      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        { vars: "all", args: "after-used" },
      ],

      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/prefer-at": "off",
      "unicorn/no-useless-undefined": "off",
      "unicorn/expiring-todo-comments": "off",
      "unicorn/import-style": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-null": "off",
      "unicorn/prefer-module": "off",

      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  }
);
