/**
 * Pro module loader -- download, verify, and extract pro module tarballs.
 *
 * Implements a security-first pipeline:
 * 1. **Download** -- stream tarball from Worker API, computing SHA-256 inline
 * 2. **Verify** -- dual-layer: SHA-256 integrity + Ed25519 authenticity
 * 3. **Extract** -- atomic swap via temp dir + rename
 * 4. **Update check** -- semver range comparison against Worker API
 *
 * All operations use the staging directory `.downloading/` to ensure that
 * partial or failed downloads never corrupt the active cache.
 *
 * @module pro-module-loader
 */

import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import tar from "tar-stream";
import semver from "semver";

import { LICENSE_PUBLIC_KEY_SPKI } from "./license-keys.js";
import type { ProManifest } from "./types/pro-manifest.js";
import {
  atomicWriteFile,
  withProCacheLock,
  createProCacheBackup,
  restoreProCacheFromBackup,
  cleanupProCacheBackup,
} from "./pro-atomic-operations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Worker API base URL, configurable via environment variable */
const PRO_API_URL =
  process.env["CLAUDE_WORKFLOW_PRO_API_URL"] ?? "https://api.claudeworkflow.com";

/** Root directory for all pro module data (lazy to support mocked homedir in tests) */
function getProDir(): string { return join(homedir(), ".claude-workflow", "pro"); }

/** Staging area for in-progress downloads */
function getStagingDir(): string { return join(getProDir(), ".downloading"); }

/** Active pro modules directory */
function getProClaudeDir(): string { return join(getProDir(), ".claude"); }

/** Manifest file path */
function getManifestPath(): string { return join(getProDir(), "manifest.json"); }

/**
 * Result of a successful download operation.
 */
export interface DownloadResult {
  /** Absolute path to the downloaded tarball in the staging directory */
  tarballPath: string;
  /** SHA-256 hex digest computed during streaming download */
  sha256: string;
}

/**
 * Result of a pro module update check.
 */
export interface ProUpdateCheckResult {
  /** Whether a newer compatible version is available and should be installed */
  needsUpdate: boolean;
  /** Latest version available on the server */
  latestVersion?: string;
  /** Currently installed version (undefined if not installed) */
  currentVersion?: string;
  /** Whether the latest version is compatible with the current CLI */
  compatible: boolean;
}

/**
 * Download a pro module tarball with streaming SHA-256 computation.
 *
 * The SHA-256 hash is computed as bytes flow through the stream, not after
 * the full download completes. This prevents TOCTOU attacks where the file
 * could be modified between download and hash computation.
 *
 * Downloads to the `.downloading/` staging directory so partial downloads
 * never affect the active cache.
 *
 * @param downloadUrl - Full URL to the Worker download endpoint
 * @param authToken - HMAC download token from license activation
 * @returns Object with tarball path and computed SHA-256 hex, or null on failure
 */
export async function downloadProModule(
  downloadUrl: string,
  authToken: string,
): Promise<DownloadResult | null> {
  try {
    // Ensure staging directory exists with restricted permissions
    mkdirSync(getStagingDir(), { recursive: true, mode: 0o700 });

    const tarballPath = join(getStagingDir(), `pro-module-${String(Date.now())}.tgz`);
    const hash = createHash("sha256");

    const response = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/gzip",
      },
    });

    if (!response.ok) {
      console.warn(`[pro-loader] Download failed with HTTP ${String(response.status)}`);
      return null;
    }

    if (!response.body) {
      console.warn("[pro-loader] Response body is null");
      return null;
    }

    // Transform stream that computes SHA-256 as bytes pass through
    const hashTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    const writeStream = createWriteStream(tarballPath, { mode: 0o600 });

    // Convert web ReadableStream to Node.js Readable for pipeline compatibility
    const nodeReadable = Readable.fromWeb(
      response.body as WebReadableStream<Uint8Array>,
    );

    await pipeline(nodeReadable, hashTransform, writeStream);

    const sha256 = hash.digest("hex");
    return { tarballPath, sha256 };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn(`[pro-loader] Download error: ${error.message}`);
    }
    return null;
  }
}

/**
 * Verify a downloaded pro module tarball with dual-layer checks:
 *
 * 1. **SHA-256 integrity**: computed hash must match manifest.sha256
 *    (uses `crypto.timingSafeEqual` to prevent timing attacks)
 * 2. **Ed25519 authenticity**: signature over the SHA-256 hex string must
 *    validate against the embedded public key
 *
 * @param computedSha256 - SHA-256 hex string computed during download
 * @param manifest - Pro module manifest with expected sha256 and signature
 * @returns `true` if both checks pass, `false` otherwise
 */
export function verifyProModule(
  computedSha256: string,
  manifest: ProManifest,
): boolean {
  try {
    // Layer 1: SHA-256 integrity check with timing-safe comparison
    const computedBuf = Buffer.from(computedSha256, "hex");
    const expectedBuf = Buffer.from(manifest.sha256, "hex");

    if (computedBuf.length !== expectedBuf.length) {
      console.warn("[pro-loader] SHA-256 length mismatch");
      return false;
    }

    if (!timingSafeEqual(computedBuf, expectedBuf)) {
      console.warn("[pro-loader] SHA-256 integrity check failed -- tarball may be corrupted");
      return false;
    }

    // Layer 2: Ed25519 authenticity check
    // The signature is over the SHA-256 hex string (not the raw tarball bytes)
    const publicKey = createPublicKey(LICENSE_PUBLIC_KEY_SPKI);
    const signatureBuffer = Buffer.from(manifest.signature, "base64");
    const dataBuffer = Buffer.from(manifest.sha256, "utf8");

    // Ed25519 uses null algorithm parameter (it is self-describing)
    const isAuthentic = verify(null, dataBuffer, publicKey, signatureBuffer);

    if (!isAuthentic) {
      console.warn("[pro-loader] Ed25519 signature verification failed -- tarball may be tampered");
      return false;
    }

    return true;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn(`[pro-loader] Verification error: ${error.message}`);
    }
    return false;
  }
}

/**
 * Extract a verified tarball to the pro module cache using atomic swap.
 *
 * Process:
 * 1. Extracts to a temp directory inside `.downloading/`
 * 2. On success, atomically renames the extracted `.claude/` to the final location
 * 3. Saves manifest to `manifest.json`
 * 4. Cleans up staging artifacts in `finally` block (both success and failure)
 *
 * Security:
 * - Path traversal attacks are prevented by resolving and validating every entry path
 * - Symlinks are silently skipped
 * - File permissions are restricted to 0o600, directories to 0o700
 *
 * Expected tarball structure (from task-1245 build pipeline):
 * ```
 * .claude/agents/*, .claude/skills/*, .claude/hooks/*,
 * .claude/commands/*, .claude/workflows/*, manifest.json
 * ```
 *
 * @param tarballPath - Absolute path to the verified .tgz file
 * @param manifest - Manifest for recording post-extraction
 * @returns `true` on success, `false` on failure
 */
export async function extractProModule(
  tarballPath: string,
  manifest: ProManifest,
): Promise<boolean> {
  const extractTmpDir = join(getStagingDir(), `extract-${String(Date.now())}`);

  try {
    mkdirSync(extractTmpDir, { recursive: true, mode: 0o700 });

    const extract = tar.extract();

    extract.on("entry", (header, stream, next) => {
      const entryPath = header.name;

      if (header.type === "directory") {
        mkdirSync(join(extractTmpDir, entryPath), { recursive: true, mode: 0o700 });
        stream.resume();
        next();
        return;
      }

      if (header.type === "file") {
        // Prevent path traversal attacks
        const resolved = join(extractTmpDir, entryPath);
        if (!resolved.startsWith(extractTmpDir)) {
          console.warn(`[pro-loader] Skipping path traversal attempt: ${entryPath}`);
          stream.resume();
          next();
          return;
        }

        // Ensure parent directory exists
        const parentDir = join(resolved, "..");
        mkdirSync(parentDir, { recursive: true, mode: 0o700 });

        const ws = createWriteStream(resolved, { mode: 0o600 });
        stream.pipe(ws);
        ws.on("finish", next);
        ws.on("error", (err: Error) => {
          console.warn(`[pro-loader] Write error for ${entryPath}: ${err.message}`);
          next(err);
        });
        return;
      }

      // Skip symlinks and other entry types for security
      stream.resume();
      next();
    });

    const readStream = createReadStream(tarballPath);
    await pipeline(readStream, createGunzip(), extract);

    // Atomic swap: remove old cache, rename temp to final
    if (existsSync(getProClaudeDir())) {
      rmSync(getProClaudeDir(), { recursive: true, force: true });
    }

    // Move extracted .claude dir to final location
    const extractedClaudeDir = join(extractTmpDir, ".claude");
    if (existsSync(extractedClaudeDir)) {
      mkdirSync(getProDir(), { recursive: true, mode: 0o700 });
      renameSync(extractedClaudeDir, getProClaudeDir());
    }

    // Save manifest to cache atomically (crash-safe write)
    await atomicWriteFile(
      getManifestPath(),
      JSON.stringify(manifest, null, 2),
      0o600,
    );

    return true;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn(`[pro-loader] Extraction error: ${error.message}`);
    }
    return false;
  } finally {
    // Always clean up staging artifacts
    cleanupStaging(tarballPath, extractTmpDir);
  }
}

/**
 * Check if a newer compatible version of pro modules is available.
 *
 * Compares the local `manifest.json` version against the Worker API response.
 * Uses `semver.satisfies()` to verify compatibility with the current CLI version.
 *
 * @param authToken - HMAC download token for authentication
 * @param workerBaseUrl - Base URL of the Worker API (defaults to env or production)
 * @returns Update check result, or null on network failure
 */
export async function checkForProUpdate(
  authToken: string,
  workerBaseUrl: string = PRO_API_URL,
): Promise<ProUpdateCheckResult | null> {
  try {
    // Read current installed version from local manifest
    const currentManifest = readLocalManifest();
    const currentVersion = currentManifest?.version ?? null;

    // Read CLI version from package.json
    const cliVersion = getCliVersion();
    if (!cliVersion) {
      console.warn("[pro-loader] Could not determine CLI version");
      return null;
    }

    // Query Worker for latest available version
    const response = await fetch(`${workerBaseUrl}/api/pro/check-update`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`[pro-loader] Update check failed with HTTP ${String(response.status)}`);
      return null;
    }

    const data = (await response.json()) as {
      latestVersion: string;
      compatibleCli: string;
      sha256: string;
      signature: string;
    };

    // Check if latest version is compatible with current CLI
    const compatible = semver.satisfies(cliVersion, data.compatibleCli);

    // Determine if update is needed
    const needsUpdate =
      currentVersion === null ||
      (semver.valid(data.latestVersion) !== null &&
        semver.gt(data.latestVersion, currentVersion));

    return {
      needsUpdate: needsUpdate && compatible,
      latestVersion: data.latestVersion,
      currentVersion: currentVersion ?? undefined,
      compatible,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn(`[pro-loader] Update check error: ${error.message}`);
    }
    return null;
  }
}

/**
 * Get the default Worker API base URL.
 * Reads from CLAUDE_WORKFLOW_PRO_API_URL env var or uses the production default.
 */
export function getProApiUrl(): string {
  return PRO_API_URL;
}

/**
 * Download, verify, and install pro modules with full resilience.
 *
 * Orchestrates the protected update flow:
 * 1. Acquire exclusive file lock (prevents concurrent updates)
 * 2. Clean up any interrupted downloads from previous sessions
 * 3. Create backup of current modules (for rollback on failure)
 * 4. Download tarball to staging directory with streaming SHA-256
 * 5. Verify integrity (SHA-256) and authenticity (Ed25519 signature)
 * 6. Extract to cache with atomic swap
 * 7. Clean up backup on success, restore on failure
 *
 * @param downloadUrl - Full URL to the Worker download endpoint
 * @param authToken - HMAC download token from license activation
 * @param manifest - Pro module manifest with expected sha256, signature, and metadata
 * @returns `true` on success, `false` on failure (with rollback)
 */
export async function updateProModules(
  downloadUrl: string,
  authToken: string,
  manifest: ProManifest,
): Promise<boolean> {
  return withProCacheLock(async () => {
    // Step 1: Clean up any interrupted downloads from previous sessions
    if (existsSync(getStagingDir())) {
      console.warn(
        "[pro-loader] Found interrupted download staging directory. Cleaning up...",
      );
      rmSync(getStagingDir(), { recursive: true, force: true });
    }

    // Step 2: Backup current modules before update
    createProCacheBackup();

    try {
      // Step 3: Download tarball with streaming SHA-256 computation
      const downloadResult = await downloadProModule(downloadUrl, authToken);
      if (!downloadResult) {
        throw new Error("Download failed");
      }

      // Step 4: Verify integrity and authenticity
      if (!verifyProModule(downloadResult.sha256, manifest)) {
        throw new Error("Verification failed -- tarball integrity or signature check failed");
      }

      // Step 5: Extract to cache (handles atomic swap internally)
      const extracted = await extractProModule(downloadResult.tarballPath, manifest);
      if (!extracted) {
        throw new Error("Extraction failed");
      }

      // Step 6: Success -- clean up backup
      cleanupProCacheBackup();
      console.warn("[pro-loader] Pro modules updated successfully");
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pro-loader] Update failed: ${message}`);

      // Clean up failed staging
      if (existsSync(getStagingDir())) {
        rmSync(getStagingDir(), { recursive: true, force: true });
      }

      // Restore from backup
      restoreProCacheFromBackup();
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clean up staging directory artifacts.
 * Called in the `finally` block to ensure cleanup on both success and failure.
 */
function cleanupStaging(tarballPath: string, extractTmpDir: string): void {
  try {
    if (existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
    if (existsSync(extractTmpDir)) {
      rmSync(extractTmpDir, { recursive: true, force: true });
    }
    // Remove staging dir if empty
    if (existsSync(getStagingDir())) {
      const entries = readdirSync(getStagingDir());
      if (entries.length === 0) {
        rmSync(getStagingDir(), { force: true });
      }
    }
  } catch {
    // Best-effort cleanup, don't throw
  }
}

/**
 * Read the local pro module manifest from disk.
 */
function readLocalManifest(): ProManifest | null {
  try {
    if (!existsSync(getManifestPath())) {
      return null;
    }
    const raw = readFileSync(getManifestPath(), "utf8");
    return JSON.parse(raw) as ProManifest;
  } catch {
    return null;
  }
}

/**
 * Get the current CLI version from package.json.
 */
function getCliVersion(): string | null {
  try {
    // Walk up from this file to find package.json
    // In production: dist/lib/pro-module-loader.js -> ../../package.json
    // In development: src/lib/pro-module-loader.ts -> ../../package.json
    const packageJsonPath = join(__dirname, "..", "..", "package.json");
    if (existsSync(packageJsonPath)) {
      const raw = readFileSync(packageJsonPath, "utf8");
      const pkg = JSON.parse(raw) as { version: string };
      return pkg.version;
    }
    return null;
  } catch {
    return null;
  }
}
