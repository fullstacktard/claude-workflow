/**
 * Pro module distribution manifest schema.
 *
 * Embedded inside every pro tarball at `package/manifest.json`.
 * Used by the CLI to verify integrity and compatibility before installation.
 *
 * @version 1
 */
export interface ProManifest {
  /** Schema version for forward compatibility. Current: 1 */
  manifestVersion: number;

  /** Semver version of this pro module bundle (e.g., "1.0.14") */
  version: string;

  /**
   * Semver range of compatible CLI versions.
   * The CLI checks `semver.satisfies(cliVersion, compatibleCli)` before installing.
   * Example: ">=1.0.14"
   */
  compatibleCli: string;

  /**
   * SHA-256 hex digest of the tarball (computed before manifest is embedded).
   * Used for integrity verification during download.
   */
  sha256: string;

  /**
   * Subresource Integrity hash in the format "sha256-<base64>".
   * Usable by HTTP clients that support SRI verification.
   */
  integrity: string;

  /**
   * Base64-encoded Ed25519 signature of the SHA-256 hex string.
   * Computed as: crypto.sign(null, Buffer.from(sha256Hex, 'utf8'), privateKey).toString('base64')
   * Verified with the public key from license-keys.ts (LICENSE_PUBLIC_KEY_SPKI).
   */
  signature: string;

  /**
   * Identifier for the signing key used.
   * Allows key rotation: the CLI looks up the correct public key by keyId.
   * Current: "ed25519-v1"
   */
  keyId: string;

  /**
   * Sorted list of relative file paths inside the tarball's package/ directory.
   * Excludes manifest.json itself.
   * Example: [".claude/agents/pro-agent.md", ".claude/hooks/core/pro-hook.js"]
   */
  files: string[];

  /** ISO 8601 timestamp of when this version was published */
  publishedAt: string;

  /** Full git commit SHA from which this build was produced */
  gitSha: string;

  /** Runtime engine requirements */
  engines: {
    node: string;
  };
}

/**
 * A single version entry in the versions index.
 */
export interface ProVersionEntry {
  /** Semver version string */
  version: string;

  /** Filename of the tarball (e.g., "claude-workflow-pro-1.0.14.tgz") */
  tarball: string;

  /** SHA-256 hex digest of the final tarball (including embedded manifest) */
  sha256: string;

  /** ISO 8601 timestamp of when this version was published */
  publishedAt: string;
}

/**
 * Index of all available pro module versions.
 * Stored as `versions.json` alongside tarballs in the R2 bucket.
 * Sorted by version descending (newest first).
 */
export interface ProVersionsIndex {
  /** All published versions, sorted newest-first */
  versions: ProVersionEntry[];
}
