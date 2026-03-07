/**
 * Smart Bun Installer
 * Automatically detects CPU capabilities and installs the correct Bun build.
 * Includes retry logic and clear user messaging.
 */

import { execSync } from "node:child_process";
import { getBunPackageName, printCPUInfo } from "./cpu-detection.js";

/**
 * Installs Bun with retry logic.
 * @param packageName - npm package name to install
 * @param maxRetries - Maximum retry attempts (default: 3)
 */
function installBunWithRetry(packageName: string, maxRetries = 3): void {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`\nInstalling ${packageName} (attempt ${attempt}/${maxRetries})...`);
      execSync(`npm install -g ${packageName}`, { stdio: "inherit" });
      console.log("\n✅ Bun installed successfully!");
      return;
    } catch {
      if (attempt === maxRetries) {
        console.error(`\n❌ Installation failed after ${maxRetries} attempts`);
        console.error("Please try again later or install manually:");
        console.error(`  npm install -g ${packageName}`);
        process.exit(1);
      }

      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.warn(`⚠️  Attempt ${attempt} failed, retrying in ${delay / 1000}s...`);
      execSync(`sleep ${delay / 1000}`, { stdio: "ignore" });
    }
  }
}

/**
 * Main installation function.
 */
export function installBun(): void {
  printCPUInfo();

  try {
    const packageName = getBunPackageName();
    installBunWithRetry(packageName);

    // Verify installation
    console.log("\nVerifying installation...");
    const version = execSync("bun --version", { encoding: "utf8" }).trim();
    console.log(`Bun version: ${version}`);
    console.log("\n✅ Setup complete! Run: bun --help");
  } catch (error) {
    console.error("\n❌ Installation failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run installation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  installBun();
}
