/**
 * KeychainCache - In-memory TTL cache for macOS Keychain credentials
 *
 * Reduces CPU overhead from spawning the `security` command repeatedly
 * by caching credentials with a configurable time-to-live (default: 60 seconds).
 *
 * Performance characteristics:
 * - Cache hit: < 1ms (O(1) Map lookup)
 * - Cache miss: ~50-100ms (spawns security process)
 * - Reduces process spawns by ~95% with 60s polling interval
 *
 * Memory footprint: ~600-2100 bytes per cached credential (negligible).
 *
 * @example
 * ```typescript
 * const cache = new KeychainCache();
 * const creds = await cache.get('Claude Code-credentials');
 * // Second call within 60s returns cached value (no process spawn)
 *
 * // Invalidate when credentials are known to have changed
 * cache.invalidate('Claude Code-credentials');
 * ```
 */

import { safeKeychainExtract } from "./keychain.js";

/** Internal cache entry storing credential data and its insertion timestamp */
interface CacheEntry {
	/** The raw credential data string */
	data: string;
	/** Timestamp (ms since epoch) when this entry was cached */
	timestamp: number;
}

/** Statistics about the current cache state (for testing/debugging) */
export interface CacheStats {
	/** Number of entries currently in the cache */
	size: number;
	/** Service names of all cached entries */
	entries: string[];
}

/**
 * Options for constructing a KeychainCache instance
 */
export interface KeychainCacheOptions {
	/**
	 * Time-to-live in milliseconds for cached entries.
	 * After this duration, the next `get()` call will re-fetch from Keychain.
	 * @default 60_000 (60 seconds)
	 */
	ttlMs?: number;
}

export class KeychainCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  /** Default TTL: 60 seconds */
  static readonly DEFAULT_TTL_MS = 60_000;

  constructor(options?: KeychainCacheOptions) {
    this.ttlMs = options?.ttlMs ?? KeychainCache.DEFAULT_TTL_MS;
  }

  /**
	 * Get credentials from cache or fetch fresh from Keychain.
	 *
	 * Returns the cached value if it was fetched less than `ttlMs` ago.
	 * Otherwise spawns the `security` command to fetch fresh credentials
	 * and caches the result.
	 *
	 * Failed extractions (null results) are NOT cached, ensuring retries
	 * on subsequent calls.
	 *
	 * @param serviceName - Keychain service name (e.g., "Claude Code-credentials")
	 * @returns Credential data string, or null if not found / extraction failed
	 */
  async get(serviceName: string): Promise<string | null> {
    const cached = this.cache.get(serviceName);
    const now = Date.now();

    // Cache hit - return cached value if still within TTL
    if (cached && now - cached.timestamp < this.ttlMs) {
      return cached.data;
    }

    // Cache miss or expired - fetch fresh from Keychain
    const result = await safeKeychainExtract(serviceName);
    if (result.success && result.data) {
      this.cache.set(serviceName, {
        data: result.data,
        timestamp: now,
      });
      return result.data;
    }

    // On failure, remove any stale entry so we don't serve expired data
    // after a transient error that follows a previously cached value
    if (cached) {
      this.cache.delete(serviceName);
    }

    return null;
  }

  /**
	 * Invalidate the cached entry for a specific service.
	 *
	 * Use this when credentials are known to have changed (e.g., after
	 * a token refresh or account switch) to force the next `get()` call
	 * to re-fetch from Keychain.
	 *
	 * @param serviceName - Service name to invalidate
	 */
  invalidate(serviceName: string): void {
    this.cache.delete(serviceName);
  }

  /**
	 * Clear all cached entries.
	 *
	 * Useful during shutdown or when all credentials need to be refreshed.
	 */
  clear(): void {
    this.cache.clear();
  }

  /**
	 * Get cache statistics for testing and debugging.
	 *
	 * @returns Current cache size and list of cached service names
	 */
  getStats(): CacheStats {
    return {
      size: this.cache.size,
      entries: [...this.cache.keys()],
    };
  }

  /**
	 * Check whether a fresh (non-expired) cache entry exists for a service.
	 *
	 * @param serviceName - Service name to check
	 * @returns true if a non-expired entry exists
	 */
  has(serviceName: string): boolean {
    const cached = this.cache.get(serviceName);
    if (!cached) return false;
    return Date.now() - cached.timestamp < this.ttlMs;
  }
}
