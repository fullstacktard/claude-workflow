/**
 * CPU Monitor
 * Tracks CPU usage and warns on sustained high usage during idle
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface CPUSample {
  system: number;
  timestamp: number;
  user: number;
}

interface PerformanceLogData {
  averagePercent?: number;
  currentPercent?: number;
  message?: string;
  metric: string;
  threshold?: number;
  windowSize?: number;
}

/**
 * Monitors CPU usage to detect excessive resource consumption
 * Tracks rolling average and warns if sustained >5% during idle
 *
 * CPU percentages are normalized for multi-core systems:
 * - 0-100% range represents per-core usage
 * - 100% = full usage of one CPU core
 * - On a 4-core system, using all cores at 100% = 25% per core
 * - Example: 50% on 8-core system = process using 4 full cores
 */
export class CPUMonitor {
  private static readonly IDLE_THRESHOLD_PERCENT = 5;
  private static readonly MICROSECONDS_PER_MILLISECOND = 1000;
  private static readonly MILLISECONDS_PER_SECOND = 1000;
  private static readonly PERCENTAGE_MULTIPLIER = 100;
  private static readonly SAMPLE_INTERVAL_MS = 5000; // 5 seconds
  private static readonly WINDOW_SIZE = 12; // 60 seconds / 5 seconds = 12 samples

  private lastSample: CPUSample;
  private readonly LOG_PATH: string;
  private monitorTimer: NodeJS.Timeout | undefined;
  private samples: number[] = []; // Recent CPU percentages

  constructor() {
    const cpuUsage = process.cpuUsage();
    this.lastSample = {
      system: cpuUsage.system,
      timestamp: Date.now(),
      user: cpuUsage.user,
    };

    const homeDir = process.env.HOME;
    this.LOG_PATH = path.join(
      homeDir !== undefined && homeDir !== "" ? homeDir : process.cwd(),
      ".claude/logs/performance.log"
    );
  }

  /**
   * Get current CPU statistics
   */
  getStats(): {
    averagePercent: number;
    currentPercent: number;
    } {
    const lastIndex = this.samples.length - 1;
    const current = lastIndex >= 0 ? (this.samples[lastIndex] ?? 0) : 0;
    const sum = this.samples.reduce((acc, val) => acc + val, 0);
    const average = this.samples.length > 0 ? sum / this.samples.length : 0;

    return {
      averagePercent: average,
      currentPercent: current,
    };
  }

  /**
   * Start monitoring CPU usage
   */
  start(): void {

    console.log("[CPUMonitor] Started - monitoring idle CPU usage");

    this.monitorTimer = setInterval(() => {
      void this.checkCPU();
    }, CPUMonitor.SAMPLE_INTERVAL_MS);
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
   * Check current CPU usage and log warnings
   */
  private async checkCPU(): Promise<void> {
    const cpuUsage = process.cpuUsage();
    const now = Date.now();
    const elapsedMs = now - this.lastSample.timestamp;

    // Calculate CPU usage percentage
    // cpuUsage values are in microseconds
    const userDelta = cpuUsage.user - this.lastSample.user;
    const systemDelta = cpuUsage.system - this.lastSample.system;
    const totalDelta = userDelta + systemDelta;

    // Convert to percentage normalized for multi-core systems
    // Formula: (microseconds used / (microseconds available * number of cores)) * 100
    // This ensures the percentage is 0-100% where 100% = full usage of one core
    // On a 4-core system, using all cores would show ~25% per core
    const numCores = os.cpus().length;
    const cpuPercent =
      (totalDelta /
        (elapsedMs *
          CPUMonitor.MICROSECONDS_PER_MILLISECOND *
          numCores)) *
      CPUMonitor.PERCENTAGE_MULTIPLIER;

    // Add to rolling window
    this.samples.push(cpuPercent);
    if (this.samples.length > CPUMonitor.WINDOW_SIZE) {
      this.samples.shift();
    }

    // Calculate rolling average
    const avgCPU =
      this.samples.reduce((sum, val) => sum + val, 0) / this.samples.length;

    // Log current state
    await this.logPerformance({
      averagePercent: avgCPU,
      currentPercent: cpuPercent,
      metric: "cpu_usage",
      windowSize: this.samples.length,
    });

    // Warn if average exceeds threshold for sustained period
    if (
      this.samples.length === CPUMonitor.WINDOW_SIZE &&
      avgCPU > CPUMonitor.IDLE_THRESHOLD_PERCENT
    ) {
      const durationSeconds =
        (CPUMonitor.WINDOW_SIZE * CPUMonitor.SAMPLE_INTERVAL_MS) /
        CPUMonitor.MILLISECONDS_PER_SECOND;
      const message = `[CPUMonitor] WARNING: Sustained high CPU usage - ${avgCPU.toFixed(1)}% average over ${String(durationSeconds)}s`;

      console.warn(message);
      await this.logPerformance({
        averagePercent: avgCPU,
        message,
        metric: "cpu_warning",
        threshold: CPUMonitor.IDLE_THRESHOLD_PERCENT,
      });
    }

    this.lastSample = {
      system: cpuUsage.system,
      timestamp: now,
      user: cpuUsage.user,
    };
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
      // Silently fail
    }
  }
}
