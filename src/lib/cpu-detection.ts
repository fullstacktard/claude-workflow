/**
 * CPU AVX Detection Module
 * Detects AVX/AVX2 support cross-platform (macOS, Linux)
 * Used for Bun baseline build selection to avoid crashes on older CPUs
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

/**
 * Detects AVX CPU instruction support.
 * @returns {boolean} True if AVX is supported, false otherwise.
 */
export function detectAVXSupport(): boolean {
  const platform = os.platform();

  try {
    if (platform === "darwin") {
      // macOS: Use sysctl
      const output = execSync("sysctl -a | grep machdep.cpu.features", {
        encoding: "utf8"
      });
      return output.toLowerCase().includes("avx");
    } else if (platform === "linux") {
      // Linux: Parse /proc/cpuinfo
      const cpuinfo = readFileSync("/proc/cpuinfo", "utf8");
      const flagsLine = cpuinfo.split("\n").find((line) => line.startsWith("flags"));
      if (flagsLine === undefined) {
        console.warn("Could not find CPU flags in /proc/cpuinfo");
        return false;
      }
      return flagsLine.toLowerCase().includes("avx");
    } else {
      console.warn(`Unsupported platform for AVX detection: ${platform}`);
      return false;
    }
  } catch (error) {
    console.error("AVX detection failed:", error instanceof Error ? error.message : String(error));
    return false; // Conservative default
  }
}

/**
 * Detects AVX2 CPU instruction support.
 * @returns {boolean} True if AVX2 is supported, false otherwise.
 */
export function detectAVX2Support(): boolean {
  const platform = os.platform();

  try {
    if (platform === "darwin") {
      const output = execSync("sysctl -a | grep machdep.cpu.leaf7_features", {
        encoding: "utf8"
      });
      return output.toLowerCase().includes("avx2");
    } else if (platform === "linux") {
      const cpuinfo = readFileSync("/proc/cpuinfo", "utf8");
      const flagsLine = cpuinfo.split("\n").find((line) => line.startsWith("flags"));
      if (flagsLine === undefined) {
        return false;
      }
      return flagsLine.toLowerCase().includes("avx2");
    }
    return false;
  } catch (error) {
    console.error("AVX2 detection failed:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Gets the appropriate Bun package name for the current platform and CPU.
 * @returns {string} npm package name (e.g., "@oven/bun-linux-x64-baseline")
 */
export function getBunPackageName(): string {
  const platform = os.platform();
  const arch = os.arch();
  const hasAVX = detectAVXSupport();

  if (platform === "linux" && arch === "x64") {
    return hasAVX ? "@oven/bun-linux-x64" : "@oven/bun-linux-x64-baseline";
  } else if (platform === "darwin" && arch === "x64") {
    return hasAVX ? "@oven/bun-darwin-x64" : "@oven/bun-darwin-x64-baseline";
  } else if (platform === "darwin" && arch === "arm64") {
    return "@oven/bun-darwin-arm64"; // ARM doesn't need AVX checks
  } else {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }
}

/**
 * Prints CPU information and recommended Bun package.
 */
export function printCPUInfo(): void {
  const hasAVX = detectAVXSupport();
  const hasAVX2 = detectAVX2Support();
  const packageName = getBunPackageName();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("CPU Feature Detection");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Platform: ${os.platform()}-${os.arch()}`);
  console.log(`AVX support: ${hasAVX ? "✅ Yes" : "❌ No"}`);
  console.log(`AVX2 support: ${hasAVX2 ? "✅ Yes" : "❌ No"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Recommended Bun package:");
  console.log(`  ${packageName}`);
  if (!hasAVX) {
    console.log("");
    console.log("⚠️  Note: Baseline build will be used (15-20% slower)");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}
