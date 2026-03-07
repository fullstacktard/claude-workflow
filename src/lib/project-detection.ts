
import * as fs from "node:fs";

interface ESLintDetection {
  configFile: string | undefined;
  hasESLint: boolean;
  inDependencies: boolean;
}


interface MonorepoDetection {
  isMonorepo: boolean;
  tool: string | undefined;
}

interface NpmScriptsResult {
  lint: string | undefined;
  lintFix: string | undefined;
  typecheck: string | undefined;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface ProjectCharacteristics {
  eslint: ESLintDetection;
  monorepo: MonorepoDetection;
  packageManager: string;
  scripts: NpmScriptsResult;
  typescript: TypeScriptDetection;
}

interface TypeScriptDetection {
  hasTsConfig: boolean;
  hasTypeScript: boolean;
  inDependencies: boolean;
}

/**
 * Detect if project uses ESLint
 * @returns {ESLintDetection} ESLint detection result
 */
export function detectESLint(): ESLintDetection {
  // Check for config files
  const configFiles = [
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    ".eslintrc",
    "eslint.config.js",
    "eslint.config.ts",
    "eslint.config.mjs"
  ];

  const configFile = configFiles.find(f => fs.existsSync(f)) ?? undefined;

  let inDependencies = false;
  try {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as PackageJson;
    inDependencies = Boolean(pkg.dependencies?.eslint ?? pkg.devDependencies?.eslint);
  } catch {
    // package.json not readable
  }

  return {
    configFile,
    hasESLint: Boolean(configFile) || inDependencies,
    inDependencies
  };
}


/**
 * Detect monorepo setup
 * @returns {MonorepoDetection} Monorepo detection result
 */
export function detectMonorepo(): MonorepoDetection {
  const indicators = {
    "lerna.json": "lerna",
    "nx.json": "nx",
    "pnpm-workspace.yaml": "pnpm",
    "turbo.json": "turbo"
  };

  for (const [file, tool] of Object.entries(indicators)) {
    if (fs.existsSync(file)) {
      return { isMonorepo: true, tool };
    }
  }

  return { isMonorepo: false, tool: undefined };
}

/**
 * Detect npm scripts related to linting and type checking
 * @returns {Object} { lint: string|null, lintFix: string|null, typecheck: string|null }
 */
export function detectNpmScripts(): NpmScriptsResult {
  try {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as PackageJson;
    const scripts = pkg.scripts ?? {};

    return {
      lint: scripts.lint ?? undefined,
      lintFix: scripts["lint:fix"] ?? undefined,
      typecheck: scripts.typecheck ?? scripts["type-check"] ?? undefined
    };
  } catch {
    return { lint: undefined, lintFix: undefined, typecheck: undefined };
  }
}

/**
 * Detect package manager
 * @returns Package manager name (npm, pnpm, yarn, bun)
 */
export function detectPackageManager(): string {
  if (fs.existsSync("pnpm-lock.yaml")) return "pnpm";
  if (fs.existsSync("yarn.lock")) return "yarn";
  if (fs.existsSync("bun.lockb")) return "bun";
  return "npm";
}

/**
 * Run all detection logic and return comprehensive project info
 * @returns {Object} Complete project detection results
 */
export function detectProjectCharacteristics(): ProjectCharacteristics {
  return {
    eslint: detectESLint(),
    monorepo: detectMonorepo(),
    packageManager: detectPackageManager(),
    scripts: detectNpmScripts(),
    typescript: detectTypeScript()
  };
}


/**
 * Detect if project uses TypeScript
 * @returns {TypeScriptDetection} TypeScript detection result
 */
export function detectTypeScript(): TypeScriptDetection {
  const hasTsConfig = fs.existsSync("tsconfig.json");
  let inDependencies = false;

  try {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as PackageJson;
    inDependencies = Boolean(pkg.dependencies?.typescript ?? pkg.devDependencies?.typescript);
  } catch {
    // package.json not readable
  }

  return {
    hasTsConfig,
    hasTypeScript: hasTsConfig || inDependencies,
    inDependencies
  };
}
