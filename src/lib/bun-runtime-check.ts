/**
 * Runtime Bun Compatibility Check
 * Warns if Bun is running on incompatible CPU.
 * Should be imported early in the application to catch issues immediately.
 */

// Declare Bun global for runtime detection
declare const Bun: unknown;

import { execSync } from "node:child_process";
import { detectAVXSupport } from "./cpu-detection.js";

/**
 * Checks if the current Bun installation is compatible with the CPU.
 * Warns if using standard Bun on non-AVX CPU or vice versa.
 */
export function checkBunCompatibility(): void {
  // Only check if running under Bun
  if (Bun === undefined) {
    return; // Not running in Bun
  }

  const hasAVX = detectAVXSupport();

  // Get Bun version to check if it's baseline build
  let bunVersion: string;
  try {
    bunVersion = execSync("bun --version", { encoding: "utf8" }).trim();
  } catch {
    console.warn("⚠️  Could not determine Bun version");
    return;
  }

  const isBaseline = bunVersion.toLowerCase().includes("baseline");

  // Warn if AVX build on non-AVX CPU
  if (!hasAVX && !isBaseline) {
    console.warn("");
    console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.warn("⚠️  CPU COMPATIBILITY WARNING");
    console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.warn("You are running a standard Bun build on a CPU");
    console.warn("without AVX support. This may cause crashes.");
    console.warn("");
    console.warn("Recommended fix:");
    console.warn("  1. Uninstall current Bun:");
    console.warn("     npm uninstall -g @oven/bun-*");
    console.warn("");
    console.warn("  2. Reinstall with correct build:");
    console.warn("     node scripts/install-bun.js");
    console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.warn("");
  }

  // Inform if baseline build on AVX CPU (suboptimal but safe)
  if (hasAVX && isBaseline) {
    console.info("ℹ️  Running baseline Bun build on AVX-capable CPU.");
    console.info("   Performance is 15-20% slower than AVX build.");
    console.info("   Consider reinstalling: npm install -g @oven/bun-linux-x64");
  }
}

// Auto-run if loaded as main module
if (import.meta.url === `file://${process.argv[1]}`) {
  checkBunCompatibility();
}
