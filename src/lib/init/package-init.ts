/**
 * Branded interactive package.json generation using @clack/prompts.
 *
 * Replaces raw `npm init -y` with an opinionated, branded prompt flow that
 * collects project name, description, author, license, and private flag.
 *
 * Auto-detects author from git config. Falls back to sensible defaults
 * in non-TTY / CI environments.
 *
 * @module package-init
 */
import * as p from "@clack/prompts";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Git command timeout in milliseconds */
const GIT_TIMEOUT = 5_000;

/** JSON indentation spaces (consistent with scaffold.ts) */
const JSON_INDENT_SPACES = 2;

/** Maximum allowed npm package name length */
const MAX_PACKAGE_NAME_LENGTH = 214;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthorInfo {
  email?: string;
  name?: string;
}

/** Supported SPDX license identifiers */
type LicenseId = "Apache-2.0" | "GPL-3.0-only" | "ISC" | "MIT" | "UNLICENSED";

export interface PackageJson {
  author?: string;
  description?: string;
  engines?: Record<string, string>;
  license?: string;
  main?: string;
  name: string;
  private?: boolean;
  scripts?: Record<string, string>;
  type?: string;
  version: string;
}

export interface GenerateOptions {
  /** Skip interactive prompts and use all defaults */
  nonInteractive?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** License options for the select prompt */
const LICENSE_OPTIONS: { hint?: string; label: string; value: LicenseId }[] = [
  { hint: "Permissive, most popular", label: "MIT", value: "MIT" },
  { hint: "Permissive with patent grant", label: "Apache 2.0", value: "Apache-2.0" },
  { hint: "Copyleft, requires source sharing", label: "GPL 3.0", value: "GPL-3.0-only" },
  { hint: "Simplified MIT/BSD", label: "ISC", value: "ISC" },
  { hint: "Proprietary, no license granted", label: "UNLICENSED", value: "UNLICENSED" },
];

/** Default package.json values applied to all generated configs */
const PACKAGE_DEFAULTS = {
  version: "0.1.0",
  type: "module" as const,
  engines: { node: ">=18" },
} as const;

// ---------------------------------------------------------------------------
// validatePackageName
// ---------------------------------------------------------------------------

/**
 * Validate an npm package name according to npm naming rules.
 *
 * @param name - The package name to validate
 * @returns `undefined` if valid, or a descriptive error message string if invalid
 */
export function validatePackageName(name: string): string | undefined {
  if (name.length === 0) {
    return "Package name cannot be empty";
  }

  if (name.length > MAX_PACKAGE_NAME_LENGTH) {
    return `Package name must be ${String(MAX_PACKAGE_NAME_LENGTH)} characters or fewer`;
  }

  if (name.startsWith(".") || name.startsWith("_")) {
    return "Package name cannot start with a period or underscore";
  }

  if (name !== name.toLowerCase()) {
    return "Package name must be lowercase";
  }

  if (name.includes(" ")) {
    return "Package name cannot contain spaces";
  }

  // Scoped package: @scope/name
  const scopedPattern = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/;
  // Unscoped package
  const unscopedPattern = /^[a-z0-9-~][a-z0-9-._~]*$/;

  if (!scopedPattern.test(name) && !unscopedPattern.test(name)) {
    return "Package name contains invalid characters. Use lowercase letters, numbers, hyphens, dots, underscores, or tildes";
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// detectAuthor
// ---------------------------------------------------------------------------

/**
 * Auto-detect author name and email from git config.
 *
 * Reads `user.name` and `user.email` via `git config --get`.
 * Returns partial {@link AuthorInfo} - fields are `undefined` if not configured.
 * Fails gracefully (returns empty object) when git is unavailable.
 */
export async function detectAuthor(): Promise<AuthorInfo> {
  const result: AuthorInfo = {};

  try {
    const { stdout: nameOut } = await execFileAsync(
      "git",
      ["config", "--get", "user.name"],
      { timeout: GIT_TIMEOUT },
    );
    const trimmedName = nameOut.trim();
    if (trimmedName.length > 0) {
      result.name = trimmedName;
    }
  } catch {
    // git not available or user.name not set - continue
  }

  try {
    const { stdout: emailOut } = await execFileAsync(
      "git",
      ["config", "--get", "user.email"],
      { timeout: GIT_TIMEOUT },
    );
    const trimmedEmail = emailOut.trim();
    if (trimmedEmail.length > 0) {
      result.email = trimmedEmail;
    }
  } catch {
    // git not available or user.email not set - continue
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format an author string from name and email.
 * Returns `"Name <email>"` if both present, just name or email if only one,
 * or `undefined` if neither is available.
 */
function formatAuthor(author: AuthorInfo): string | undefined {
  if (author.name !== undefined && author.email !== undefined) {
    return `${author.name} <${author.email}>`;
  }
  return author.name ?? author.email;
}

/**
 * Derive a default package name from the current working directory.
 * Converts to lowercase and replaces invalid chars with hyphens.
 */
function derivePackageName(cwd: string): string {
  return path.basename(cwd)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-._~]/g, "-")
    .replace(/^[._]/, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// generatePackageJson
// ---------------------------------------------------------------------------

/**
 * Generate a package.json through interactive clack prompts.
 *
 * In non-TTY environments (CI, piped input) or when `options.nonInteractive`
 * is `true`, uses sensible defaults without prompting:
 *   - name: derived from directory name
 *   - description: empty
 *   - author: from git config
 *   - license: MIT
 *   - private: true
 *
 * @param cwd - The directory where the package.json will live
 * @param options - Optional generation configuration
 * @returns A complete PackageJson object ready to be written to disk
 */
export async function generatePackageJson(
  cwd: string,
  options: GenerateOptions = {},
): Promise<PackageJson> {
  const author = await detectAuthor();
  const defaultName = derivePackageName(cwd);
  const defaultAuthor = formatAuthor(author);

  // Non-interactive mode: use all defaults
  if (options.nonInteractive === true || !process.stdin.isTTY) {
    return {
      name: defaultName || "my-project",
      ...PACKAGE_DEFAULTS,
      description: "",
      ...(defaultAuthor !== undefined && { author: defaultAuthor }),
      license: "MIT",
      private: true,
      scripts: {
        test: "echo \"Error: no test specified\" && exit 1",
      },
    };
  }

  p.note("Let's set up your package.json", "Project Setup");

  const result = await p.group(
    {
      name: () =>
        p.text({
          message: "Package name",
          defaultValue: defaultName,
          placeholder: defaultName,
          validate: validatePackageName,
        }),
      description: () =>
        p.text({
          message: "Description",
          placeholder: "A brief description of your project",
        }),
      authorInput: () =>
        p.text({
          message: "Author",
          ...(defaultAuthor !== undefined
            ? { defaultValue: defaultAuthor, placeholder: defaultAuthor }
            : { placeholder: "Your Name <you@example.com>" }),
        }),
      license: () =>
        p.select({
          message: "License",
          options: LICENSE_OPTIONS,
          initialValue: "MIT" as LicenseId,
        }),
      isPrivate: () =>
        p.confirm({
          message: "Private package?",
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Operation cancelled");
        process.exit(0);
      },
    },
  );

  const pkg: PackageJson = {
    name: result.name,
    ...PACKAGE_DEFAULTS,
    ...(result.description !== undefined &&
      String(result.description).length > 0 && { description: String(result.description) }),
    ...(result.authorInput !== undefined &&
      String(result.authorInput).length > 0 && { author: String(result.authorInput) }),
    license: result.license as string,
    private: result.isPrivate,
    scripts: {
      test: "echo \"Error: no test specified\" && exit 1",
    },
  };

  return pkg;
}

// ---------------------------------------------------------------------------
// writePackageJson
// ---------------------------------------------------------------------------

/**
 * Write a PackageJson object to disk as formatted JSON.
 *
 * Uses 2-space indentation with a trailing newline, matching the
 * convention used in scaffold.ts and update.ts.
 *
 * @param cwd - The directory to write `package.json` into
 * @param pkg - The package configuration object
 */
export function writePackageJson(cwd: string, pkg: PackageJson): void {
  const packageJsonPath = path.join(cwd, "package.json");
  writeFileSync(
    packageJsonPath,
    JSON.stringify(pkg, undefined, JSON_INDENT_SPACES) + "\n",
  );
}
