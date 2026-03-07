/**
 * Performance Monitoring and Metrics for Log Parsing
 *
 * Tracks memory usage, processing times, and provides performance insights.
 */

// Mock process for compatibility
declare const process: {
  hrtime: (time?: [number, number]) => [number, number];
  memoryUsage(): {
    arrayBuffers: number;
    external: number;
    heapTotal: number;
    heapUsed: number;
    rss: number;
  };
};

export interface FileMetrics {
  duration: number | undefined;
  endMemory: ReturnType<typeof process.memoryUsage> | undefined;
  endTime: [number, number] | undefined;
  entriesProcessed: number;
  errorsEncountered: number;
  filePath: string;
  fileSize: number;
  memory: ReturnType<typeof process.memoryUsage> | undefined;
  memoryDelta: number;
  memoryPeak: number;
  startMemory: ReturnType<typeof process.memoryUsage> | undefined;
  startTime: [number, number];
}

export interface MemorySample {
  external: number;
  heapTotal: number;
  heapTotalMB?: string;
  heapUsed: number;
  heapUsedMB?: string;
  rss: number;
  rssMB?: string;
  timestamp: number;
}

export interface SessionData {
  duration: number | undefined;
  endMemory: ReturnType<typeof process.memoryUsage> | undefined;
  endTime: [number, number] | undefined;
  files: FileMetrics[];
  id: string;
  info: Record<string, boolean | number | string>;
  memory: ReturnType<typeof process.memoryUsage> | undefined;
  metrics: SessionMetrics;
  startMemory: ReturnType<typeof process.memoryUsage> | undefined;
  startTime: [number, number];
}

interface MetricsData {
  currentSession: SessionData | undefined;
  sessions: SessionData[];
  totals: {
    entriesProcessed: number;
    errorsEncountered: number;
    filesProcessed: number;
    memoryPeak: number;
    totalTime: number;
  };
}


interface PerformanceOptions {
  enableDetailedMetrics?: boolean;
  enableMemoryTracking?: boolean;
  enableTimingTracking?: boolean;
  maxMetricsHistory?: number;
  memorySampleInterval?: number;
}

interface SessionMetrics {
  bytesProcessed: number;
  entriesProcessed: number;
  errorsEncountered: number;
  memorySamples: MemorySample[];
}

// Constants
const DEFAULT_MAX_METRICS_HISTORY = 100;
const DEFAULT_MEMORY_SAMPLE_INTERVAL = 1000;
const MILLISECONDS_PER_SECOND = 1000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const DECIMAL_PRECISION = 2;
const PERCENTAGE_MULTIPLIER = 100;
const RECENT_SESSIONS_COUNT = 5;
const MIN_TREND_SAMPLES = 2;
const RADIX_BASE_36 = 36;
const RANDOM_ID_START_INDEX = 2;
const RANDOM_ID_END_INDEX = 11;

/**
 * Performance metrics collector
 */
export class PerformanceMonitor {
  private memoryHistory: MemorySample[] = [];
  private memorySamplingInterval: ReturnType<typeof setInterval> | undefined = undefined;
  private metrics: MetricsData;
  private options: PerformanceOptions;

  constructor(options: PerformanceOptions = {}) {
    this.options = {
      enableDetailedMetrics: options.enableDetailedMetrics ?? false,
      enableMemoryTracking: options.enableMemoryTracking ?? true,
      enableTimingTracking: options.enableTimingTracking ?? true,
      maxMetricsHistory: options.maxMetricsHistory ?? DEFAULT_MAX_METRICS_HISTORY,
      memorySampleInterval: options.memorySampleInterval ?? DEFAULT_MEMORY_SAMPLE_INTERVAL,
      ...options
    };

    this.metrics = {
      currentSession: undefined,
      sessions: [],
      totals: {
        entriesProcessed: 0,
        errorsEncountered: 0,
        filesProcessed: 0,
        memoryPeak: 0,
        totalTime: 0
      }
    };
  }

  /**
   * Compare performance before and after optimization
   */
  compareSessions(beforeSessionId: string, afterSessionId: string): Record<string, Record<string, number | string> | string> | undefined {
    const before = this.getSessionReport(beforeSessionId);
    const after = this.getSessionReport(afterSessionId);

    if (before === undefined || after === undefined) {
      return undefined;
    }

    const beforeDuration = Number(before.duration);
    const afterDuration = Number(after.duration);

    const beforeMemory = before.memory as Record<string, number | string> | undefined;
    const afterMemory = after.memory as Record<string, number | string> | undefined;
    const beforePeakMB = beforeMemory?.peakMemoryMB;
    const afterPeakMB = afterMemory?.peakMemoryMB;

    const comparison: Record<string, Record<string, number | string> | string> = {
      duration: {
        after: afterDuration,
        before: beforeDuration,
        improvement: beforeDuration > 0 ? ((beforeDuration - afterDuration) / beforeDuration * PERCENTAGE_MULTIPLIER).toFixed(DECIMAL_PRECISION) : "N/A"
      },
      memory: {
        afterMB: afterPeakMB ?? "N/A",
        beforeMB: beforePeakMB ?? "N/A",
        improvement: typeof beforePeakMB === "number" && typeof afterPeakMB === "number" && beforePeakMB > 0
          ? ((beforePeakMB - afterPeakMB) / beforePeakMB * PERCENTAGE_MULTIPLIER).toFixed(DECIMAL_PRECISION)
          : "N/A"
      },
      processing: {
        afterRate: after.processingRate as number | string,
        beforeRate: before.processingRate as number | string,
        improvement: Number(before.processingRate) > 0
          ? ((Number(after.processingRate) - Number(before.processingRate)) / Number(before.processingRate) * PERCENTAGE_MULTIPLIER).toFixed(DECIMAL_PRECISION)
          : "N/A"
      },
      sessions: { after: afterSessionId, before: beforeSessionId }
    };

    return comparison;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.memorySamplingInterval !== undefined) {

      clearInterval(this.memorySamplingInterval);
      this.memorySamplingInterval = undefined;
    }
    this.reset();
  }

  /**
   * End processing a file
   */
  endFile(filePath: string, entriesProcessed = 0, errorsEncountered = 0): FileMetrics | undefined {
    if (this.metrics.currentSession === undefined) {
      return undefined;
    }

    const file = this.metrics.currentSession.files.find((f) => f.filePath === filePath);
    if (file === undefined) {
      return undefined;
    }

    file.endTime = process.hrtime();

    file.endMemory = this.options.enableMemoryTracking === true ? process.memoryUsage() : undefined;
    const endTimeDiff = process.hrtime(file.startTime);
    file.duration = (endTimeDiff[0] * MILLISECONDS_PER_SECOND + endTimeDiff[1] / NANOSECONDS_PER_MILLISECOND);
    file.entriesProcessed = entriesProcessed;
    file.errorsEncountered = errorsEncountered;

    // Calculate memory metrics
    if (this.options.enableMemoryTracking === true && file.startMemory !== undefined && file.endMemory !== undefined) {
      file.memoryDelta = file.endMemory.heapUsed - file.startMemory.heapUsed;
      file.memoryPeak = Math.max(file.startMemory.heapUsed, file.endMemory.heapUsed);
    }

    // Update session metrics
    this.metrics.currentSession.metrics.entriesProcessed += entriesProcessed;
    this.metrics.currentSession.metrics.errorsEncountered += errorsEncountered;
    this.metrics.currentSession.metrics.bytesProcessed += file.fileSize;

    // Update totals
    this.metrics.totals.filesProcessed++;
    this.metrics.totals.entriesProcessed += entriesProcessed;
    this.metrics.totals.errorsEncountered += errorsEncountered;
    this.metrics.totals.totalTime += file.duration;
    this.metrics.totals.memoryPeak = Math.max(this.metrics.totals.memoryPeak, file.memoryPeak);

    return file;
  }

  /**
   * End current monitoring session
   */
  endSession(): SessionData | undefined {
    if (this.metrics.currentSession === undefined) {
      return undefined;
    }

    const session = this.metrics.currentSession;

    session.endTime = process.hrtime();

    session.endMemory = this.options.enableMemoryTracking === true ? process.memoryUsage() : undefined;
    const endTimeDiff = process.hrtime(session.startTime);
    session.duration = (endTimeDiff[0] * MILLISECONDS_PER_SECOND + endTimeDiff[1] / NANOSECONDS_PER_MILLISECOND);

    // Stop memory sampling
    if (this.memorySamplingInterval !== undefined) {
      clearInterval(this.memorySamplingInterval);
      this.memorySamplingInterval = undefined;
    }

    this.metrics.currentSession = undefined;
    return session;
  }

  /**
   * Export metrics data
   */
  exportData(): Record<string, MemorySample[] | MetricsData | PerformanceOptions | string> {
    return {
      configuration: this.options,
      exportTime: new Date().toISOString(),
      memoryHistory: this.memoryHistory,
      metrics: this.metrics
    };
  }

  /**
   * Get current memory usage snapshot
   */
  getMemorySnapshot(): MemorySample | undefined {
    if (this.options.enableMemoryTracking !== true) {
      return undefined;
    }

    const usage = process.memoryUsage();
    return {
      external: usage.external,
      heapTotal: usage.heapTotal,
      heapTotalMB: (usage.heapTotal / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION),
      heapUsed: usage.heapUsed,
      heapUsedMB: (usage.heapUsed / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION),
      rss: usage.rss,
      rssMB: (usage.rss / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION),
      timestamp: Date.now()
    };
  }

  /**
   * Get comprehensive performance report
   */
  getReport(): Record<string, MemorySample | number | Record<string, number | Record<string, number | string> | string>[] | Record<string, number | string> | SessionData | string | undefined> {
    const report: Record<string, MemorySample | number | Record<string, number | Record<string, number | string> | string>[] | Record<string, number | string> | SessionData | string | undefined> = {
      currentMemory: this.getMemorySnapshot(),
      currentSession: this.metrics.currentSession ?? undefined,
      recentSessions: this.metrics.sessions.slice(-RECENT_SESSIONS_COUNT).map((s) => this.getSessionReport(s.id)).filter((r): r is Record<string, number | string> => r !== undefined),
      summary: {
        averageProcessingTime: this.metrics.totals.filesProcessed > 0
          ? this.metrics.totals.totalTime / this.metrics.totals.filesProcessed
          : 0,
        memoryPeakMB: this.options.enableMemoryTracking === true
          ? (this.metrics.totals.memoryPeak / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION)
          : "N/A",
        totalEntries: this.metrics.totals.entriesProcessed,
        totalErrors: this.metrics.totals.errorsEncountered,
        totalFiles: this.metrics.totals.filesProcessed,
        totalSessions: this.metrics.sessions.length,
        totalTime: this.metrics.totals.totalTime
      }
    };

    return report;
  }

  /**
   * Get report for a specific session
   */
  getSessionReport(sessionId: string): Record<string, number | Record<string, number | string> | string> | undefined {
    const session = this.metrics.sessions.find((s) => s.id === sessionId);
    if (session === undefined) {
      return undefined;
    }

    const duration = session.duration ?? (Date.now() - (session.startTime[0] * MILLISECONDS_PER_SECOND + session.startTime[1] / NANOSECONDS_PER_MILLISECOND));

    const report: Record<string, number | Record<string, number | string> | string> = {
      averageEntriesPerFile: session.files.length > 0
        ? session.metrics.entriesProcessed / session.files.length
        : 0,
      duration,
      files: session.files.length,
      id: session.id,
      processingRate: duration > 0
        ? (session.metrics.entriesProcessed / duration * MILLISECONDS_PER_SECOND).toFixed(DECIMAL_PRECISION)
        : 0,
      totalBytes: session.metrics.bytesProcessed,
      totalEntries: session.metrics.entriesProcessed,
      totalErrors: session.metrics.errorsEncountered
    };

    // Add memory metrics if available
    if (this.options.enableMemoryTracking === true) {
      const peakMemory = session.files.reduce((max: number, file: FileMetrics) => Math.max(max, file.memoryPeak), 0) / BYTES_PER_KB / KB_PER_MB;
      report.memory = {
        endMemoryMB: session.endMemory === undefined
          ? "N/A"
          : (session.endMemory.heapUsed / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION),
        memoryDeltaMB: session.files.reduce((sum: number, file: FileMetrics) => sum + file.memoryDelta, 0) / BYTES_PER_KB / KB_PER_MB,
        peakMemoryMB: peakMemory === 0 ? "N/A" : peakMemory.toFixed(DECIMAL_PRECISION),
        startMemoryMB: session.startMemory === undefined
          ? "N/A"
          : (session.startMemory.heapUsed / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION)
      };

      // Add memory trend analysis
      if (session.metrics.memorySamples.length > MIN_TREND_SAMPLES) {
        const firstSample = session.metrics.memorySamples[0];
        const lastSample = session.metrics.memorySamples[session.metrics.memorySamples.length - 1];

        if (firstSample !== undefined && lastSample !== undefined) {
          report.memoryTrend = {
            averageHeapUsedMB: (session.metrics.memorySamples.reduce((sum, s) => sum + s.heapUsed, 0) / session.metrics.memorySamples.length / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION),
            changePercent: ((lastSample.heapUsed - firstSample.heapUsed) / firstSample.heapUsed * PERCENTAGE_MULTIPLIER).toFixed(DECIMAL_PRECISION),
            endHeapUsedMB: (lastSample.heapUsed / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION),
            samples: session.metrics.memorySamples.length,
            startHeapUsedMB: (firstSample.heapUsed / BYTES_PER_KB / KB_PER_MB).toFixed(DECIMAL_PRECISION)
          };
        }
      }
    }

    return report;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    if (this.memorySamplingInterval !== undefined) {

      clearInterval(this.memorySamplingInterval);
      this.memorySamplingInterval = undefined;
    }

    this.metrics = {
      currentSession: undefined,
      sessions: [],
      totals: {
        entriesProcessed: 0,
        errorsEncountered: 0,
        filesProcessed: 0,
        memoryPeak: 0,
        totalTime: 0
      }
    };

    this.memoryHistory = [];
  }

  /**
   * Start processing a file
   */
  startFile(filePath: string, fileSize = 0): FileMetrics {
    if (this.metrics.currentSession === undefined) {
      this.startSession();
    }

    const file: FileMetrics = {
      duration: undefined,
      endMemory: undefined,
      endTime: undefined,
      entriesProcessed: 0,
      errorsEncountered: 0,
      filePath,
      fileSize,
      memory: this.options.enableMemoryTracking === true ? process.memoryUsage() : undefined,
      memoryDelta: 0,
      memoryPeak: 0,
      startMemory: this.options.enableMemoryTracking === true ? process.memoryUsage() : undefined,
      startTime: process.hrtime()
    };

    this.metrics.currentSession?.files.push(file);
    return file;
  }

  /**
   * Start monitoring a parsing session
   */
  startSession(sessionInfo: Record<string, boolean | number | string> = {}): string {
    const session: SessionData = {
      duration: undefined,
      endMemory: undefined,
      endTime: undefined,
      files: [],
      id: `session_${String(Date.now())}_${Math.random().toString(RADIX_BASE_36).slice(RANDOM_ID_START_INDEX, RANDOM_ID_END_INDEX)}`,
      info: sessionInfo,
      memory: this.options.enableMemoryTracking === true ? process.memoryUsage() : undefined,
      metrics: {
        bytesProcessed: 0,
        entriesProcessed: 0,
        errorsEncountered: 0,
        memorySamples: []
      },
      startMemory: this.options.enableMemoryTracking === true ? process.memoryUsage() : undefined,
      startTime: process.hrtime()
    };

    this.metrics.currentSession = session;
    this.metrics.sessions.push(session);

    // Start memory sampling if enabled
    if (this.options.enableMemoryTracking === true) {
      this._startMemorySampling();
    }

    return session.id;
  }

  /**
   * Start memory sampling
   */
  private _startMemorySampling(): void {
    if (this.memorySamplingInterval !== undefined) {
      clearInterval(this.memorySamplingInterval);
    }

    this.memorySamplingInterval = setInterval(() => {
      if (this.metrics.currentSession !== undefined && this.options.enableMemoryTracking === true) {
        const memoryUsage = process.memoryUsage();
        const sample: MemorySample = {
          external: memoryUsage.external,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          rss: memoryUsage.rss,
          timestamp: Date.now()
        };

        this.metrics.currentSession.metrics.memorySamples.push(sample);

        // Limit sample history
        const maxHistory = this.options.maxMetricsHistory ?? DEFAULT_MAX_METRICS_HISTORY;
        if (this.metrics.currentSession.metrics.memorySamples.length > maxHistory) {
          this.metrics.currentSession.metrics.memorySamples.shift();
        }

        this.memoryHistory.push(sample);
        const maxHistoryGlobal = this.options.maxMetricsHistory ?? DEFAULT_MAX_METRICS_HISTORY;
        if (this.memoryHistory.length > maxHistoryGlobal) {
          this.memoryHistory.shift();
        }
      }
    }, this.options.memorySampleInterval ?? DEFAULT_MEMORY_SAMPLE_INTERVAL);
  }
}