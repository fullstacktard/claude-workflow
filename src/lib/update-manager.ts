
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { PACKAGE_ROOT } from "./file-operations.js";



interface PackageJson {
  [key: string]: boolean | number | string;
  name: string;
  version: string;
}

interface UpdateCheckResult {
  latestVersion?: string;
  needsUpdate: boolean;
}

export function checkForUpdates(): UpdateCheckResult {
  try {
    const packagePath = path.join(PACKAGE_ROOT, "package.json");
    const currentPackage = JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageJson;
    const currentVersion: string = currentPackage.version;

    const latestVersionOutput = execSync(
      "npm view claude-workflow version",
      {
        encoding: "utf8",
        stdio: "pipe",
      }
    ).trim();

    if (latestVersionOutput && latestVersionOutput !== currentVersion) {
      return { latestVersion: latestVersionOutput, needsUpdate: true };
    }
    return { needsUpdate: false };
  } catch {
    // Silently ignore version check errors
    return { needsUpdate: false };
  }
}

export function performUpdate(): boolean {
  try {
    execSync("npm update -g claude-workflow", {
      stdio: "pipe",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}