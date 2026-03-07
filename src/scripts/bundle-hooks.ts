#!/usr/bin/env node
import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Bundle all hooks with esbuild
 * Each hook becomes a self-contained JS file with dependencies inlined
 */
export async function bundleHooks(): Promise<void> {
  const hooksDir = "src/templates/.claude/hooks";
  const outDir = "dist/templates/.claude/hooks";

  if (!existsSync(hooksDir)) {
    console.log("No hooks directory found, skipping bundling");
    return;
  }

  // Find all hook TypeScript files
  const hookFiles = findHookFiles(hooksDir);

  if (hookFiles.length === 0) {
    console.log("No hook files found to bundle");
    return;
  }

  console.log(`Bundling ${String(hookFiles.length)} hook files...`);

  // Bundle each hook as separate entry point
  for (const hookFile of hookFiles) {
    // Calculate relative path to preserve directory structure
    const relativePath = hookFile.replace("src/templates/.claude/hooks/", "");
    const outFile = join(outDir, relativePath.replace(".ts", ".js"));

    // Ensure output directory exists
    const outDirPath = dirname(outFile);
    if (!existsSync(outDirPath)) {
      mkdirSync(outDirPath, { recursive: true });
    }

    try {
      await build({
        banner: {
          js: "#!/usr/bin/env node"
        },
        bundle: true,
        entryPoints: [hookFile],
        external: [
          // Node built-ins
          "fs",
          "fs/promises",
          "path",
          "url",
          "child_process",
          "crypto",
          "os",
          "node:fs",
          "node:fs/promises",
          "node:path",
          "node:url",
          "node:child_process",
          "node:crypto",
          "node:os",
          // npm packages that users have installed via package.template.json
          "ajv",
          "ajv-formats",
        ],
        format: "esm",
        logLevel: "warning",
        minify: false, // Keep readable for debugging
        outfile: outFile,
        platform: "node",
        sourcemap: false,
        target: "node18",
      });

      console.log(`  Bundled: ${relativePath}`);
    } catch (error) {
      console.error(`  Failed to bundle ${relativePath}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  console.log("Hook bundling complete");
}

/**
 * Recursively find all .ts files in a directory
 */
function findHookFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      // Skip lib directory - these are bundled into hooks
      if (entry === "lib") continue;
      files.push(...findHookFiles(fullPath));
    } else if (entry.endsWith(".ts") && entry !== "types.ts") {
      files.push(fullPath);
    }
  }

  return files;
}

// Allow running directly
if (process.argv[1]?.endsWith("bundle-hooks.ts") === true) {
   
  await bundleHooks().catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Bundle hooks failed:", errorMessage);

    process.exit(1);
  });
}
