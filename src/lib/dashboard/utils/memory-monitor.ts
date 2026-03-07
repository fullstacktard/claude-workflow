/**
 * Memory Monitor
 * Tracks process memory usage and warns on excessive growth
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

interface MemorySnapshot {
  external: number;
  heapTotal: number;
  heapUsed: number;
  rss: number;
  timestamp: number;
}

interface PerformanceLogData {
  currentHeapMB?: number;
  heapGrowthMB?: number;
  heapTotal?: number;
  heapUsed?: number;
  message?: string;
  metric: string;
  rss?: number;
  totalGrowthMB?: number;
}

const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * KB_PER_MB;
const MS_PER_SECOND = 1000;

/**
 * Monitors process memory usage to detect potential memory leaks
 * Samples every 30 seconds and warns if heap grows >100MB
 */
export class MemoryMonitor {
  private baseline: MemorySnapshot;
  private readonly GROWTH_THRESHOLD_MB = 100;
  private lastSnapshot: MemorySnapshot;
  private readonly LOG_PATH: string;
  private monitorTimer: NodeJS.Timeout | undefined = undefined;
  private readonly SAMPLE_INTERVAL_MS = 30_000; // 30 seconds

  constructor() {
    const memUsage = process.memoryUsage();
    this.baseline = {
      external: memUsage.external,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      rss: memUsage.rss,
      timestamp: Date.now(),
    };
    this.lastSnapshot = { ...this.baseline };

    const homeDir = process.env.HOME ?? process.cwd();
    this.LOG_PATH = path.join(
      homeDir,
      ".claude/logs/performance.log"
    );
  }

  /**
   * Get current memory statistics
   */
  getStats(): {
    baselineHeapMB: number;
    currentHeapMB: number;
    totalGrowthMB: number;
    } {
    return {
      baselineHeapMB: this.baseline.heapUsed / BYTES_PER_MB,
      currentHeapMB: this.lastSnapshot.heapUsed / BYTES_PER_MB,
      totalGrowthMB:
        (this.lastSnapshot.heapUsed - this.baseline.heapUsed) / BYTES_PER_MB,
    };
  }

  /**
   * Start monitoring memory usage
   */
  start(): void {
     
    console.log(
      "[MemoryMonitor] Started - baseline heap:",
      this.formatBytes(this.baseline.heapUsed)
    );

    this.monitorTimer = setInterval(() => {
      void this.checkMemory();
    }, this.SAMPLE_INTERVAL_MS);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorTimer !== undefined) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }
  }

  /**
   * Check current memory usage and log warnings
   */
  private async checkMemory(): Promise<void> {
    const memUsage = process.memoryUsage();
    const currentSnapshot: MemorySnapshot = {
      external: memUsage.external,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      rss: memUsage.rss,
      timestamp: Date.now(),
    };

    // Calculate growth since last check
    const heapGrowthBytes = currentSnapshot.heapUsed - this.lastSnapshot.heapUsed;
    const heapGrowthMB = heapGrowthBytes / BYTES_PER_MB;

    // Calculate total growth since baseline
    const totalGrowthBytes = currentSnapshot.heapUsed - this.baseline.heapUsed;
    const totalGrowthMB = totalGrowthBytes / BYTES_PER_MB;

    // Log current state
    await this.logPerformance({
      heapGrowthMB: heapGrowthMB,
      heapTotal: currentSnapshot.heapTotal,
      heapUsed: currentSnapshot.heapUsed,
      metric: "memory_usage",
      rss: currentSnapshot.rss,
      totalGrowthMB: totalGrowthMB,
    });

    // Warn if growth exceeds threshold
    if (heapGrowthMB > this.GROWTH_THRESHOLD_MB) {
      const intervalSeconds = this.SAMPLE_INTERVAL_MS / MS_PER_SECOND;
      const message = `[MemoryMonitor] WARNING: Heap grew by ${heapGrowthMB.toFixed(1)}MB in last ${intervalSeconds.toString()}s`;

      console.warn(message);
      await this.logPerformance({
        currentHeapMB: currentSnapshot.heapUsed / BYTES_PER_MB,
        heapGrowthMB,
        message,
        metric: "memory_warning",
      });
    }

    this.lastSnapshot = currentSnapshot;
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    const mb = bytes / BYTES_PER_MB;
    return `${mb.toFixed(1)}MB`;
  }

  /**
   * Log performance data to performance.log
   */
  private async logPerformance(data: PerformanceLogData): Promise<void> {
    const logEntry =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ...data,
      }) + "\n";

    try {
      await fs.appendFile(this.LOG_PATH, logEntry);
    } catch {
      // Silently fail - don't block on logging errors
    }
  }
}
