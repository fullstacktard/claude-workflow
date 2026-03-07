/**
 * Intelligent LRU Cache for Log Parsing
 *
 * Provides efficient caching of parsed log data with file modification tracking
 * and automatic cache invalidation.
 */

import { Stats } from "node:fs";
import * as fs from "node:fs/promises";

// Type definitions for LogCache

// Generic type for cached log data (non-recursive base types)
export type ParsedLogData = Record<string, LogPrimitive | LogPrimitive[] | Record<string, LogPrimitive>>;

interface CacheEntry<T = ParsedLogData> {
  data: T;
  size: number;
  timestamp: number;
}

interface CacheOptions {
  checkModificationTime?: boolean;
  cleanupInterval?: number;
  enableFileTracking?: boolean;
  maxMemoryUsage?: number;
  maxSize?: number;
  statsTracking?: boolean;
}

interface CacheStats {
  evictions: number;
  hits: number;
  invalidations: number;
  misses: number;
  startTime: number;
  totalRequests: number;
}

interface FileStats {
  cacheKey: string;
  mtime: Date;
  size: number;
}

// Primitive log data types
type LogPrimitive = boolean | Date | number | string;

/**
 * Simple LRU Cache implementation
 */
const DEFAULT_LRU_CACHE_SIZE = 100;

class LRUCache<K = string, V = CacheEntry> {
  cache: Map<K, V>;
  maxSize: number;

  constructor(maxSize = DEFAULT_LRU_CACHE_SIZE) {
    this.maxSize = maxSize;
    this.cache = new Map<K, V>();
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  entries(): [K, V][] {
    return [...this.cache.entries()];
  }

  get(key: K): undefined | V {
    if (this.cache.has(key)) {
      // Move to end (most recently used)
      const value = this.cache.get(key);
      if (value === undefined) {
        return undefined;
      }
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }

  /**
   * Get cache statistics
   */
  getStats(): { maxSize: number; size: number; utilization: number } {
    const PERCENTAGE_MULTIPLIER = 100;

    return {
      maxSize: this.maxSize,
      size: this.cache.size,
      utilization: (this.cache.size / this.maxSize) * PERCENTAGE_MULTIPLIER
    };
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  keys(): K[] {
    return [...this.cache.keys()];
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  size(): number {
    return this.cache.size;
  }

  values(): V[] {
    return [...this.cache.values()];
  }
}

/**
 * Cache configuration options
 */
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MINUTES_TO_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const CLEANUP_INTERVAL_MINUTES = 5;
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const MAX_MEMORY_MB = 100;
const DEFAULT_MAX_CACHE_ENTRIES = 50;

const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  checkModificationTime: true,
  cleanupInterval: CLEANUP_INTERVAL_MINUTES * MINUTES_TO_MS, // 5 minutes
  enableFileTracking: true,
  maxMemoryUsage: MAX_MEMORY_MB * KB_PER_MB * BYTES_PER_KB, // 100MB max memory usage
  maxSize: DEFAULT_MAX_CACHE_ENTRIES, // Maximum number of files to cache
  statsTracking: true
};

/**
 * Log file cache with file modification tracking
 */
export class LogCache {
  private _cleanupTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private cache: LRUCache;
  private fileStats: Map<string, FileStats>;
  private memoryUsage: number;
  private options: CacheOptions;
  private stats: CacheStats;

  constructor(options: CacheOptions = {}) {
    this.options = { ...DEFAULT_CACHE_OPTIONS, ...options };
    const maxSize = this.options.maxSize ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.cache = new LRUCache<string, CacheEntry>(maxSize);
    this.fileStats = new Map<string, FileStats>(); // filePath -> { mtime, size, cacheKey }
    this.memoryUsage = 0;
    this.stats = {
      evictions: 0,
      hits: 0,
      invalidations: 0,
      misses: 0,
      startTime: Date.now(),
      totalRequests: 0
    };

    // Start cleanup interval if enabled
    const cleanupInterval = this.options.cleanupInterval ?? 0;
    if (cleanupInterval > 0) {
      this._startCleanupTimer();
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.fileStats.clear();
    this.memoryUsage = 0;
    this.stats.evictions += this.cache.size();
  }

  /**
   * Cleanup and destroy cache
   */
  destroy(): void {
    if (this._cleanupTimer) {
      
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = undefined;
    }
    this.clear();
  }

  /**
   * Get cached data for file
   * @param filePath - Path to the file to retrieve from cache
   * @returns Cached data or undefined if not found
   *
   * NOTE: Returns `undefined` (not `null`) when cache miss occurs.
   * This follows TypeScript convention: undefined = absent value, null = explicit null value.
   */
  async get(filePath: string): Promise<ParsedLogData | undefined> {
    this.stats.totalRequests++;

    try {
      // Check if file has been modified
      const isModified = await this._isFileModified(filePath);

      if (isModified && this.fileStats.has(filePath)) {
        // Invalidate stale cache entry
        const oldFileStats = this.fileStats.get(filePath);
        if (oldFileStats) {
          this.cache.delete(oldFileStats.cacheKey);
          this.fileStats.delete(filePath);
          this.stats.invalidations++;
        }
      }

      // Get current file stats
      const fileStats = await fs.stat(filePath);
      const cacheKey = this._generateCacheKey(filePath, fileStats);

      // Check cache
      const cached = this.cache.get(cacheKey);

      if (cached) {
        this.stats.hits++;
        return cached.data;
      }

      this.stats.misses++;
      return undefined;
    } catch {
      this.stats.misses++;
      return undefined;
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  getStats(): CacheStats & {
    cacheSize: number;
    hitRate: number;
    memoryUsage: number;
    memoryUtilization: number;
    trackedFiles: number;
    uptime: number;
    } {
    const PERCENTAGE_MULTIPLIER = 100;
    const hitRate = this.stats.totalRequests > 0
      ? (this.stats.hits / this.stats.totalRequests) * PERCENTAGE_MULTIPLIER
      : 0;

    const maxMemoryUsage = this.options.maxMemoryUsage ?? 0;
    const memoryUtilization = maxMemoryUsage > 0
      ? (this.memoryUsage / maxMemoryUsage) * PERCENTAGE_MULTIPLIER
      : 0;

    return {
      ...this.stats,
      cacheSize: this.cache.size(),
      hitRate,
      memoryUsage: this.memoryUsage,
      memoryUtilization,
      trackedFiles: this.fileStats.size,
      uptime: Date.now() - this.stats.startTime
    };
  }

  /**
   * Get detailed cache status
   */
  getStatus(): {
    cache: {
      entries: number;
      evictions: number;
      invalidations: number;
      maxEntries: number;
      utilization: string;
    };
    configuration: CacheOptions;
    files: {
      cleanupInterval: string;
      tracked: number;
    };
    memory: {
      limit: string;
      used: string;
      utilization: string;
    };
    performance: {
      hitRate: string;
      hits: number;
      misses: number;
      totalRequests: number;
    };
    status: string;
    } {
    const DECIMAL_PLACES = 2;
    const MS_TO_SECONDS = 1000;

    const cacheStats = this.cache.getStats();
    const stats = this.getStats();

    const cleanupInterval = this.options.cleanupInterval ?? 0;
    const maxMemoryUsage = this.options.maxMemoryUsage ?? 0;

    return {
      cache: {
        entries: cacheStats.size,
        evictions: stats.evictions,
        invalidations: stats.invalidations,
        maxEntries: cacheStats.maxSize,
        utilization: `${cacheStats.utilization.toFixed(DECIMAL_PLACES)}%`
      },
      configuration: this.options,
      files: {
        cleanupInterval: `${(cleanupInterval / MS_TO_SECONDS).toFixed(0)}s`,
        tracked: stats.trackedFiles
      },
      memory: {
        limit: `${(maxMemoryUsage / KB_PER_MB / BYTES_PER_KB).toFixed(DECIMAL_PLACES)}MB`,
        used: `${(stats.memoryUsage / KB_PER_MB / BYTES_PER_KB).toFixed(DECIMAL_PLACES)}MB`,
        utilization: `${stats.memoryUtilization.toFixed(DECIMAL_PLACES)}%`
      },
      performance: {
        hitRate: `${stats.hitRate.toFixed(DECIMAL_PLACES)}%`,
        hits: stats.hits,
        misses: stats.misses,
        totalRequests: stats.totalRequests
      },
      status: "active"
    };
  }

  /**
   * Store data in cache
   */
  async set(filePath: string, data: ParsedLogData): Promise<void> {
    try {
      const fileStats = await fs.stat(filePath);
      const cacheKey = this._generateCacheKey(filePath, fileStats);

      // Calculate memory usage for new entry
      const dataSize = this._estimateDataSize(data);

      // Check if adding this entry would exceed memory limits
      const maxMemoryUsage = this.options.maxMemoryUsage ?? 0;
      if (maxMemoryUsage > 0 && this.memoryUsage + dataSize > maxMemoryUsage) {
        this._evictToMakeRoom(dataSize);
      }

      // Remove old entry if exists
      if (this.fileStats.has(filePath)) {
        const oldFileStats = this.fileStats.get(filePath);
        if (oldFileStats !== undefined) {
          const oldCacheKey = oldFileStats.cacheKey;
          const oldData = this.cache.get(oldCacheKey);
          if (oldData !== undefined) {
            this.memoryUsage -= this._estimateDataSize(oldData.data);
            this.cache.delete(oldCacheKey);
          }
        }
      }

      // Add new entry
      const cacheEntry: CacheEntry = {
        data,
        size: dataSize,
        timestamp: Date.now()
      };
      this.cache.set(cacheKey, cacheEntry);

      // Update file tracking
      this.fileStats.set(filePath, {
        cacheKey,
        mtime: fileStats.mtime,
        size: fileStats.size
      });

      this.memoryUsage += dataSize;
    } catch (caughtError) {
      // Failed to cache - log error but don't throw
      const errorMessage = caughtError instanceof Error ? caughtError.message : "cache write failed";
      console.warn(`Failed to cache file ${filePath}:`, errorMessage);
    }
  }

  /**
   * Cleanup expired or invalid entries
   */
  private async _cleanup(): Promise<void> {
    const entries = [...this.fileStats.entries()];

    for (const [filePath, fileStats] of entries) {
      try {
        // Check if file still exists
        await fs.access(filePath);
      } catch {
        // File doesn't exist - remove from cache
        this.cache.delete(fileStats.cacheKey);
        this.fileStats.delete(filePath);
        this.stats.invalidations++;
      }
    }
  }

  /**
   * Estimate memory usage of data
   */
  private _estimateDataSize(data: ParsedLogData): number {
    const BYTES_PER_ARRAY_ENTRY = 100;
    const BYTES_PER_CHAR = 2;

    if (Array.isArray(data)) {
      return data.length * BYTES_PER_ARRAY_ENTRY; // Rough estimate per entry
    }

    return JSON.stringify(data).length * BYTES_PER_CHAR; // Rough estimate
  }

  /**
   * Evict entries to make room for new data
   */
  private _evictToMakeRoom(requiredSize: number): void {
    const entries = this.cache.entries();
    let freedSpace = 0;

    // Create a reverse lookup map from cacheKey to filePath
    const cacheKeyToFilePath = new Map<string, string>();
    for (const [filePath, fileStats] of this.fileStats.entries()) {
      cacheKeyToFilePath.set(fileStats.cacheKey, filePath);
    }

    const maxMemoryUsage = this.options.maxMemoryUsage ?? 0;

    for (const [cacheKey, cachedData] of entries) {
      if (maxMemoryUsage > 0 && this.memoryUsage - freedSpace + requiredSize <= maxMemoryUsage) {
        break;
      }

      this.cache.delete(cacheKey);
      const filePath = cacheKeyToFilePath.get(cacheKey);
      if (filePath !== undefined && filePath.length > 0) {
        this.fileStats.delete(filePath);
      }
      freedSpace += cachedData.size;
      this.stats.evictions++;
    }

    this.memoryUsage -= freedSpace;
  }

  /**
   * Generate cache key for file
   */
  private _generateCacheKey(filePath: string, fileStats: Stats): string {
    const checkModTime = this.options.checkModificationTime ?? false;

    // If file tracking is disabled, use just the file path
    if (!checkModTime) {
      return filePath;
    }

    const mtimeMs = String(fileStats.mtime.getTime());
    const fileSizeBytes = String(fileStats.size);

    return `${filePath}:${mtimeMs}:${fileSizeBytes}`;
  }

  /**
   * Check if file has been modified since caching
   */
  private async _isFileModified(filePath: string): Promise<boolean> {
    const checkModTime = this.options.checkModificationTime ?? false;

    if (!checkModTime) {
      return false;
    }

    try {
      const currentStats = await fs.stat(filePath);
      const cachedStats = this.fileStats.get(filePath);

      if (cachedStats === undefined) {
        return true;
      }

      return currentStats.mtime.getTime() !== cachedStats.mtime.getTime() ||
             currentStats.size !== cachedStats.size;
    } catch {
      // File doesn't exist or can't access - consider it modified
      return true;
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private _startCleanupTimer(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    this._cleanupTimer = setInterval(() => {
      void this._cleanup(); // explicitly ignore promise
    }, this.options.cleanupInterval);
  }
}