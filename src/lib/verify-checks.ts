
import { execSync } from "node:child_process";
import * as fs from "node:fs";

import {
  showInfo,
  showSection,
  showSuccess,
  showWarning,
  successGradient,
} from "./ui.js";


export function runVerifyChecks(): boolean {
  showSection("Verifying setup");

  let hasWarnings = false;

  // Check Claude Code CLI
  try {
    execSync("claude --version", { stdio: "pipe" });
    showSuccess("Claude Code CLI installed");
  } catch {
    showWarning("Claude Code CLI not installed");
    showInfo("Install from: https://claude.ai/code");
    hasWarnings = true;
  }

  // Check notification system (optional)
  try {
    execSync("which terminal-notifier", { stdio: "pipe" });
    showSuccess("Terminal notifier installed (sound alerts enabled)");
  } catch {
    showInfo("Terminal notifier not installed (optional)");
    showInfo("For sound alerts, install with: brew install terminal-notifier");
  }

  // Check backlog (optional)
  try {
    execSync("backlog --version", { stdio: "pipe" });
    showSuccess("Backlog CLI installed");
  } catch {
    showInfo("Backlog CLI not installed (optional)");
    showInfo("Install with: npm install -g backlog.md");
  }

  // Create required directories
  const requiredDirs = ["src", "tests", "docs"];
  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  if (!hasWarnings) {

    console.log("\n" + successGradient("✅ All checks passed!"));
  }

  return true;
}