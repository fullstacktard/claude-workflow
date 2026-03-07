#!/usr/bin/env node
import { globSync } from "glob";
import { execSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

// File permission constants
const EXECUTABLE_PERMISSION = 0o755; // rwxr-xr-x

console.log("Building claude-workflow...");

// 1. Clean dist/
console.log("Cleaning dist/...");
rmSync("dist", { force: true, recursive: true });

// 2. Compile all TypeScript (src/ → dist/)
console.log("Compiling TypeScript...");
execSync("tsc -p tsconfig.build.json", { stdio: "inherit" });

// 3. If TypeScript created nested output (dist/src/, dist/claude-workflow/src/), move contents to dist/
// Check for different possible output structures due to monorepo configurations
const possibleSrcPaths = ["dist/src", "dist/claude-workflow/src"];
for (const srcDistPath of possibleSrcPaths) {
  if (existsSync(srcDistPath)) {
    console.log(`Moving compiled files from ${srcDistPath}/ to dist/...`);
    const moveDir = (src: string, dest: string): void => {
      const items = readdirSync(src);
      for (const item of items) {
        const srcPath = join(src, item);
        const destPath = join(dest, item);
        if (existsSync(destPath) && statSync(destPath).isDirectory()) {
          moveDir(srcPath, destPath);
          // Source dir is now empty after recursive move — remove it
          rmSync(srcPath, { recursive: true, force: true });
        } else {
          if (existsSync(destPath)) rmSync(destPath);
          renameSync(srcPath, destPath);
        }
      }
    };
    moveDir(srcDistPath, "dist/");
    rmSync(srcDistPath, { recursive: true });

    // Also clean up the empty parent if it exists (e.g., dist/claude-workflow/)
    const parentDir = srcDistPath.slice(0, srcDistPath.lastIndexOf("/"));
    if (parentDir !== "dist" && existsSync(parentDir)) {
      try {
        const remaining = readdirSync(parentDir);
        if (remaining.length === 0) {
          rmSync(parentDir, { recursive: true });
        }
      } catch {
        // Ignore errors
      }
    }
    break; // Only process one path
  }
}

// Also handle claude-proxy output if it exists (from path mapping)
const fstProxyPath = "dist/claude-proxy";
if (existsSync(fstProxyPath)) {
  console.log("Cleaning up claude-proxy output (handled by dependency)...");
  rmSync(fstProxyPath, { recursive: true });
}

// 3. Compile template scripts (these are standalone scripts for user projects)
// They're excluded from tsconfig.build.json because they run in user projects, not as part of this package
// CRITICAL: Compile BEFORE bundling hooks because hooks import these .js files
console.log("Compiling template scripts...");
const templateScripts = globSync("src/templates/**/scripts/*.ts", { dot: true, nodir: true });
for (const src of templateScripts) {
  const dest = src.replace("src/", "dist/").replace(/\.ts$/, ".js");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  // Use esbuild to compile each script to standalone JS (ESM format for import.meta support)
  execSync(`npx esbuild ${src} --bundle --platform=node --target=node18 --format=esm --outfile=${dest}`, { stdio: "inherit" });
}

// 4. Bundle hooks with esbuild (self-contained, no lib/ copying needed)
// Each hook is bundled into a single JS file with all internal dependencies inlined
// Node built-ins and npm packages (ajv) remain external
// CRITICAL: Must happen AFTER template scripts are compiled, because hooks import those .js files
console.log("Bundling hooks with esbuild...");
try {
  const { bundleHooks } = await import("./bundle-hooks.js");
  await bundleHooks();
} catch (error) {
  console.warn("Warning: Hook bundling failed, hooks will not be included");
  console.warn(error instanceof Error ? error.message : String(error));
}

// 5. Copy non-TS files from src/ (templates, and other assets)
console.log("Copying non-TS files...");
const nonTsFiles = globSync("src/**/*", { dot: true, nodir: true })
  .filter(f => ![".js", ".ts", ".tsx"].includes(extname(f)))
  .filter(f => !f.startsWith("src/tests/"))
  .filter(f => !f.includes("/node_modules/"));

// 4a. Copy frontend dist files (pre-built React bundles, including .js files)
console.log("Copying frontend dist files...");
const frontendDistFiles = globSync("src/lib/dashboard/frontend/dist/**/*", { dot: true, nodir: true })
  .filter(f => !f.includes("/node_modules/"));
for (const src of frontendDistFiles) {
  const dest = src.replace("src/", "dist/");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  cpSync(src, dest);
}

// 4a2. Copy admin frontend dist files (separate build, not included in npm package)
console.log("Copying admin frontend dist files...");
const adminDistFiles = globSync("src/lib/dashboard/frontend/admin-dist/**/*", { dot: true, nodir: true })
  .filter(f => !f.includes("/node_modules/"));
for (const src of adminDistFiles) {
  const dest = src.replace("src/", "dist/");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  cpSync(src, dest);
}

for (const src of nonTsFiles) {
  const dest = src.replace("src/", "dist/");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  cpSync(src, dest);
}

// 4b. Copy template .ts and .js files (these are templates, not compiled code)
console.log("Copying template files...");
const templateFiles = globSync("src/templates/**/*.template.{ts,js}", { dot: true, nodir: true });
for (const src of templateFiles) {
  const dest = src.replace("src/", "dist/");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  cpSync(src, dest);
}

// 4b2. Copy lib/ utility templates (e.g., cn() utility for Tailwind)
// These are TypeScript files meant to be copied to user projects as-is
console.log("Copying lib utility templates...");
const libTemplateFiles = globSync("src/templates/lib/**/*.{ts,js}", { dot: true, nodir: true });
for (const src of libTemplateFiles) {
  const dest = src.replace("src/", "dist/");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  cpSync(src, dest);
}

// 4c. Copy docker directory (Dockerfiles and related files)
console.log("Copying docker files...");
const dockerFiles = globSync("docker/**/*", { dot: true, nodir: true });
for (const src of dockerFiles) {
  const dest = src.replace("docker/", "dist/docker/");
  const destDir = dest.slice(0, Math.max(0, dest.lastIndexOf("/")));
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  cpSync(src, dest);
}

// 6. Ensure CLI has proper shebang and is executable
console.log("Setting up CLI executable...");
const cliPath = "dist/lib/cli.js";
if (existsSync(cliPath)) {
  let cliContent = readFileSync(cliPath, "utf8");
  if (!cliContent.startsWith("#!/usr/bin/env node")) {
    cliContent = "#!/usr/bin/env node\n" + cliContent;
    writeFileSync(cliPath, cliContent);
  }
  chmodSync(cliPath, EXECUTABLE_PERMISSION);
}

console.log("Build complete!");
console.log("Output: dist/lib/ and dist/templates/");
