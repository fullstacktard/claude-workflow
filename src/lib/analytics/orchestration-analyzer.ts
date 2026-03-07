/**
 * Orchestration Analytics Engine
 *
 * Analyzes agent orchestration logs to extract workflow insights.
 * Processes agent-orchestrator hook logs and agent-spawning-tracker data.
 * Features streaming processing, intelligent caching, and performance monitoring.
 */

import fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ParsedLogData } from "./log-cache.js";
import type { EntryCallback } from "./log-stream-parser.js";

import { createErrorLogger, ERROR_CATEGORIES, ERROR_CODES, type ErrorContext, OrchestrationError } from "../errors/orchestration-error.js";
import { LogCache } from "./log-cache.js";
import { LogStreamProcessor } from "./log-stream-parser.js";
import { PerformanceMonitor } from "./performance-monitor.js";

// Constants
const JSON_INDENT_SPACES = 2;

// Mock process for compatibility
declare const process: {
  cwd(): string;
  memoryUsage(): {
    arrayBuffers: number;
    external: number;
    heapTotal: number;
    heapUsed: number;
    rss: number;
  };
};

interface AgentChain {
  from: string;
  sessionId: string;
  success: boolean;
  timestamp: Date;
  to: string;
}

interface AgentData {
  decision: string;
  executionTime: number;
  id: string;
  status: string;
  timestamp: Date;
  type: string;
}

interface AgentStats {
  count: number;
  failure: number;
  outcomes: Map<string, number>;
  success: number;
  totalTime: number;
}

// Type definitions for OrchestrationAnalyzer
interface AnalyzerOptions {
  cache?: {
    enableFileTracking?: boolean;
    maxMemoryUsage?: number;
    maxSize?: number;
  };
  enableOptimizations?: boolean;
  performance?: {
    enableMetrics?: boolean;
    sampleRate?: number;
  };
  retention?: {
    days?: number;
    sessions?: number;
  };
  streaming?: {
    encoding?: string;
    highWaterMark?: number;
    maxErrors?: number;
  };
}

interface Bottleneck {
  agentType: string;
  averageTime: number;
  failureRate: number;
  occurrences: number;
}

interface ChainPattern {
  chain: string[];
  frequency: number;
  successCount: number;
  successRate: number;
  totalCount: number;
}

interface InstanceMetrics {
  cacheHits: number;
  cacheMisses: number;
  entriesProcessed: number;
  filesProcessed: number;
  totalProcessingTime: number;
}

interface OverallMetrics {
  agentPerformance: Record<string, {
    averageTime: number;
    failureRate: number;
    successRate: number;
    total: number;
  }>;
  averageChainLength: number;
  successRate: number;
  totalAgents: number;
  totalWorkflows: number;
}

interface PerformanceMetrics {
  averageExecutionTime: number;
  medianExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;
}

interface SessionData {
  agents: AgentData[];
  endTime?: Date | undefined;
  sessionId: string;
  startTime: Date;
  workflows: string[];
}


interface TimeMetrics {
  daily: TimeSeriesData[];
  hourly: number[];
}

interface TimeSeriesData {
  date: string;
  successfulAgents: number;
  successRate: number;
  totalAgents: number;
  workflows: number;
}

interface WorkflowData {
  data: Record<string, Record<string, boolean | number | string>>;
  id: string;
}

// Constants for magic numbers
const PERCENTAGE_MULTIPLIER = 100;
const MAX_METRICS_HISTORY = 100;
const DEFAULT_MEMORY_SAMPLE_INTERVAL = 1000;
const INSUFFICIENT_DATA_THRESHOLD = 5;
const HIGH_FAILURE_RATE_THRESHOLD = 30;
const TOP_PATTERNS_LIMIT = 20;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const PERCENTILE_95 = 0.95;
const PERCENTILE_99 = 0.99;
const MEDIAN_INDEX_DIVISOR = 2;
const TREND_PREVIOUS_DAYS_START = -14;
const TREND_PREVIOUS_DAYS_END = -7;
const DECIMAL_PRECISION = 2;

export class OrchestrationAnalyzer {
  private agentChains: AgentChain[];
  private agentStats: Map<string, AgentStats>;
  private cache: LogCache;
  private instanceMetrics: InstanceMetrics;
  private logError: (error: OrchestrationError) => void;
  private optimizationEnabled: boolean;
  private performanceMonitor: PerformanceMonitor;
  private sessions: Map<string, SessionData>;
  private streamProcessor: LogStreamProcessor;
  private timeSeriesData: TimeSeriesData[];
  private workflows: Map<string, WorkflowData>;

  constructor(options: AnalyzerOptions = {}) {
    this.sessions = new Map(); // sessionId -> session data
    this.workflows = new Map(); // workflowId -> workflow data
    this.agentChains = []; // agent transition sequences
    this.agentStats = new Map(); // agentType -> {count, success, failure, totalTime}
    this.timeSeriesData = []; // time-based metrics

    // Initialize streaming and caching components
    const streamingOptions = options.streaming ?? {};
    const processorOptions: {
      encoding?: BufferEncoding;
      highWaterMark?: number;
      maxErrors?: number;
    } = {};

    if (typeof streamingOptions.encoding === "string") {
      processorOptions.encoding = streamingOptions.encoding as BufferEncoding;
    }
    if (typeof streamingOptions.highWaterMark === "number") {
      processorOptions.highWaterMark = streamingOptions.highWaterMark;
    }
    if (typeof streamingOptions.maxErrors === "number") {
      processorOptions.maxErrors = streamingOptions.maxErrors;
    }

    this.streamProcessor = new LogStreamProcessor(processorOptions);
    this.cache = new LogCache(options.cache);

    // Convert performance options to match PerformanceMonitor interface
    const perfOptions = options.performance === undefined ? {} : {
      enableDetailedMetrics: false,
      enableMemoryTracking: true,
      enableTimingTracking: true,
      maxMetricsHistory: MAX_METRICS_HISTORY,
      memorySampleInterval: DEFAULT_MEMORY_SAMPLE_INTERVAL
    };

    this.performanceMonitor = new PerformanceMonitor(perfOptions);
    this.optimizationEnabled = options.enableOptimizations !== false;

    // Performance metrics for this instance
    this.instanceMetrics = {
      cacheHits: 0,
      cacheMisses: 0,
      entriesProcessed: 0,
      filesProcessed: 0,
      totalProcessingTime: 0
    };

    // Initialize error logger
    this.logError = createErrorLogger((hookName: string, eventName: string, data: ErrorContext) => {
      console.error(`[${hookName}] ${eventName}:`, data);
    });
  }

  /**
   * Build time series data for trend analysis
   */
  buildTimeSeriesData(): void {
    this.timeSeriesData = [];

    // Group by day
    const dailyData = new Map<string, TimeSeriesData>();

    for (const session of this.sessions.values()) {
      const day = session.startTime.toISOString().split("T")[0];

      if (day === undefined || day.length === 0) continue;

      if (!dailyData.has(day)) {
        dailyData.set(day, {
          date: day,
          successfulAgents: 0,
          successRate: 0,
          totalAgents: 0,
          workflows: 0
        });
      }

      const dayData = dailyData.get(day);
      if (dayData === undefined) continue;

      dayData.workflows++;
      dayData.totalAgents += session.agents.length;

      const successfulAgents = session.agents.filter((agent) =>
        agent.decision !== "blocked" &&
        agent.decision !== "error" &&
        agent.status !== "failure"
      ).length;

      dayData.successfulAgents += successfulAgents;
    }

    // Calculate success rates
    for (const dayData of dailyData.values()) {
      dayData.successRate = dayData.totalAgents > 0
        ? (dayData.successfulAgents / dayData.totalAgents) * PERCENTAGE_MULTIPLIER
        : 0;
    }

    this.timeSeriesData = [...dailyData.values()]
      .toSorted((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Calculate final metrics from parsed data
   */
  calculateMetrics(): void {
    // Additional metrics calculation happens in getter methods
    // This allows for filtering and dynamic recalculation
  }

  /**
   * Clear all caches and reset metrics
   */
  clearCache(): void {
    this.cache.clear();
    this.instanceMetrics = {
      cacheHits: 0,
      cacheMisses: 0,
      entriesProcessed: 0,
      filesProcessed: 0,
      totalProcessingTime: 0
    };
    this.performanceMonitor.reset();
  }

  /**
   * Convert analytics data to CSV format
   */
  convertToCSV(data: {
    overall: OverallMetrics;
    patterns: ChainPattern[];
    timeMetrics: TimeMetrics;
    timestamp: string;
  }): string {
    const lines: string[] = [
      "# Orchestration Analytics Summary",
      `Generated,${data.timestamp}`,
      `Total Workflows,${String(data.overall.totalWorkflows)}`,
      `Success Rate,${data.overall.successRate.toFixed(DECIMAL_PRECISION)}%`,
      `Average Chain Length,${data.overall.averageChainLength.toFixed(DECIMAL_PRECISION)}`,
      "",
      "# Agent Performance",
      "Agent Type,Total Count,Success Rate,Average Time (ms),Failure Rate"
    ];

    for (const [agentType, stats] of Object.entries(data.overall.agentPerformance)) {
      const agentStats = stats as {
        averageTime: number;
        failureRate: number;
        successRate: number;
        total: number;
      };
      lines.push(
        `${agentType},${String(agentStats.total)},${agentStats.successRate.toFixed(DECIMAL_PRECISION)}%,${agentStats.averageTime.toFixed(0)},${agentStats.failureRate.toFixed(DECIMAL_PRECISION)}%`
      );
    }
    lines.push("", "# Agent Chaining Patterns", "Chain,Frequency,Success Rate");

    for (const pattern of data.patterns.slice(0, TOP_PATTERNS_LIMIT)) {
      const chainStr = pattern.chain.join(" → ");
      lines.push(`${chainStr},${String(pattern.frequency)},${pattern.successRate.toFixed(DECIMAL_PRECISION)}%`);
    }
    lines.push("");

    // Daily metrics
    if (data.timeMetrics.daily.length > 0) {
      lines.push("# Daily Performance", "Date,Workflows,Success Rate,Total Agents");

      for (const day of data.timeMetrics.daily) {
        lines.push(`${day.date},${String(day.workflows)},${day.successRate.toFixed(DECIMAL_PRECISION)}%,${String(day.totalAgents)}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.cache.destroy();
    this.performanceMonitor.destroy();
  }

  /**
   * Export data to specified format (JSON or CSV)
   */
  exportData(format: string, options: Record<string, boolean | number | string> = {}): string {
    const filterValue = options.filter;
    const daysValue = options.days;

    const filter = typeof filterValue === "string" ? filterValue : undefined;
    const days = typeof daysValue === "number" ? daysValue : undefined;

    const overall = this.getOverallMetrics(filter, days);
    const patterns = this.getChainingPatterns(filter, days);
    const timeMetrics = this.getTimeBasedMetrics(days);
    const performance = this.getExecutionPerformanceMetrics();
    const bottlenecks = this.getBottlenecks(filter);

    const data = {
      agentStats: Object.fromEntries(
        
        [...this.agentStats.entries()].map(([agent, stats]) => [
          agent,
          {
            ...stats,
            outcomes: Object.fromEntries(stats.outcomes)
          }
        ])
      ),
      bottlenecks,
      filters: options,
      overall,
      patterns,
      performance,
      sessions: [...this.sessions.entries()].map(([id, session]) => ({
        agentCount: session.agents.length,
        agents: session.agents,
        endTime: session.endTime,
        sessionId: id,
        startTime: session.startTime
      })),
      
      timeMetrics,
      timestamp: new Date().toISOString()
    };

    if (format === "json") {
      return JSON.stringify(data, undefined, JSON_INDENT_SPACES);
    } else if (format === "csv") {
      return this.convertToCSV(data);
    }

    return JSON.stringify(data, undefined, JSON_INDENT_SPACES);
  }

  /**
   * Get trend metrics for performance over time
   */

  getBottlenecks(filter: string | undefined = undefined): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    for (const [agentType, stats] of this.agentStats.entries()) {
      if (filter !== undefined && filter.length > 0 && !agentType.includes(filter)) continue;
      if (stats.count < INSUFFICIENT_DATA_THRESHOLD) continue;

      const failureRate = (stats.failure / stats.count) * PERCENTAGE_MULTIPLIER;

      if (failureRate > HIGH_FAILURE_RATE_THRESHOLD) {
        bottlenecks.push({
          agentType,
          averageTime: stats.totalTime / stats.count,
          failureRate,
          occurrences: stats.count
        });
      }
    }

    return bottlenecks.toSorted((a, b) => b.failureRate - a.failureRate);
  }

  /**
   * Get bottlenecks and problematic agents
   */

  /**
   * Get agent chaining patterns with frequency and success analysis
   */
  getChainingPatterns(filter: string | undefined = undefined, days: number | undefined = undefined): ChainPattern[] {
    let relevantChains = this.agentChains;

    // Apply time filter
    if (days !== undefined) {
      const cutoff = Date.now() - (days * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND);
      relevantChains = this.agentChains.filter((chain) => chain.timestamp.getTime() >= cutoff);
    }

    // Apply agent type filter
    if (filter !== undefined && filter.length > 0) {
      relevantChains = relevantChains.filter((chain) => chain.from.includes(filter) || chain.to.includes(filter));
    }

    // Count chain frequencies and success rates
    const chainStats = new Map<string, {
      chain: string[];
      frequency: number;
      successCount: number;
      totalCount: number;
    }>();

    for (const chain of relevantChains) {
      const key = `${chain.from} → ${chain.to}`;

      if (!chainStats.has(key)) {
        chainStats.set(key, {
          chain: [chain.from, chain.to],
          frequency: 0,
          successCount: 0,
          totalCount: 0
        });
      }

      const stats = chainStats.get(key);
      if (stats === undefined) continue;

      stats.frequency++;
      stats.totalCount++;
      if (chain.success) {
        stats.successCount++;
      }
    }

    // Convert to array with success rates
    const patterns: ChainPattern[] = [...chainStats.values()]
      .map(stats => ({
        ...stats,
        successRate: stats.totalCount > 0 ? (stats.successCount / stats.totalCount) * PERCENTAGE_MULTIPLIER : 0
      }))
      .toSorted((a, b) => b.frequency - a.frequency);

    return patterns;
  }

  getExecutionPerformanceMetrics(): PerformanceMetrics {
    const allTimes: number[] = [];

    for (const stats of this.agentStats.values()) {
      // Add execution times for calculation
      if (stats.count > 0 && stats.totalTime > 0) {
        const avgTime = stats.totalTime / stats.count;
        for (let i = 0; i < stats.count; i++) {
          allTimes.push(avgTime);
        }
      }
    }

    if (allTimes.length === 0) {
      return {
        averageExecutionTime: 0,
        medianExecutionTime: 0,
        p95ExecutionTime: 0,
        p99ExecutionTime: 0
      };
    }

    allTimes.toSorted((a, b) => a - b);

    const averageExecutionTime = allTimes.reduce((sum, time) => sum + time, 0) / allTimes.length;
    const medianExecutionTime = allTimes[Math.floor(allTimes.length / MEDIAN_INDEX_DIVISOR)] ?? 0;
    const p95ExecutionTime = allTimes[Math.floor(allTimes.length * PERCENTILE_95)] ?? 0;
    const p99ExecutionTime = allTimes[Math.floor(allTimes.length * PERCENTILE_99)] ?? 0;

    return {
      averageExecutionTime,
      medianExecutionTime,
      p95ExecutionTime,
      p99ExecutionTime
    };
  }

  /**
   * Get time-based metrics (daily, hourly, etc.)
   */

  /**
   * Get paths to orchestration log files
   */
  async getLogPaths(): Promise<string[]> {
    const logPaths: string[] = [];

    const claudeDir = path.join(process.cwd(), ".claude");
    const logsDir = path.join(claudeDir, "logs");

    try {
      // Check if logs directory exists
      await fs.access(logsDir);
    } catch (error) {
      // No logs directory found - log and return empty
      const orchError = OrchestrationError.fromError(error instanceof Error ? error : new Error(String(error)), {
        category: ERROR_CATEGORIES.IO,
        code: ERROR_CODES.DIRECTORY_ACCESS_ERROR,
        context: { logsDir },
        operation: "getLogPaths"
      });

      this.logError(orchError);
      return logPaths;
    }

    // Get session directories
    const sessionDirs = await fs.readdir(logsDir);

    for (const sessionDir of sessionDirs) {
      if (sessionDir.startsWith("session-")) {
        const sessionPath = path.join(logsDir, sessionDir);

        // Look for orchestration logs
        const orchestrationLog = path.join(sessionPath, "agent-orchestration.log");
        const spawningLog = path.join(sessionPath, "agent-spawning.log");

        if (fsSync.existsSync(orchestrationLog)) {
          logPaths.push(orchestrationLog);
        }

        if (fsSync.existsSync(spawningLog)) {
          logPaths.push(spawningLog);
        }
      }
    }

    return logPaths;
  }

  /**
   * Get execution performance metrics (execution times, percentiles, etc.)
   */

  /**
   * Get overall performance metrics
   */
  getOverallMetrics(filter: string | undefined = undefined, days: number | undefined = undefined): OverallMetrics {
    let sessions = [...this.sessions.values()];

    // Apply filters
    if (days !== undefined) {
      const cutoff = Date.now() - (days * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND);
      sessions = sessions.filter(session =>
        session.startTime.getTime() >= cutoff
      );
    }

    if (filter !== undefined && filter.length > 0) {
      sessions = sessions.filter(session =>
        session.agents.some((agent) => agent.type.includes(filter))
      );
    }

    const totalWorkflows = sessions.length;
    const totalAgents = sessions.reduce((sum, session) => sum + session.agents.length, 0);
    const successfulAgents = sessions.reduce((sum, session) =>
      sum + session.agents.filter((agent) =>
        agent.decision !== "blocked" &&
        agent.decision !== "error" &&
        agent.status !== "failure"
      ).length, 0
    );

    const successRate = totalAgents > 0 ? (successfulAgents / totalAgents) * PERCENTAGE_MULTIPLIER : 0;

    // Calculate average chain length
    const totalChains = this.agentChains.length;
    const averageChainLength = totalWorkflows > 0 ? totalChains / totalWorkflows : 0;

    // Agent performance breakdown
    const agentPerformance: Record<string, {
      averageTime: number;
      failureRate: number;
      successRate: number;
      total: number;
    }> = {};

    for (const [agentType, stats] of this.agentStats.entries()) {
      if (filter !== undefined && filter.length > 0 && !agentType.includes(filter)) continue;

      agentPerformance[agentType] = {
        averageTime: stats.count > 0 ? stats.totalTime / stats.count : 0,
        failureRate: stats.count > 0 ? (stats.failure / stats.count) * PERCENTAGE_MULTIPLIER : 0,
        successRate: stats.count > 0 ? (stats.success / stats.count) * PERCENTAGE_MULTIPLIER : 0,
        total: stats.count
      };
    }

    return {
      agentPerformance,
      averageChainLength,
      successRate,
      totalAgents,
      totalWorkflows
    };
  }

  getPerformanceMetrics(): Record<string, boolean | number | Record<string, boolean | number | string> | string> {
    // Get execution performance metrics to include in response
    const executionMetrics = this.getExecutionPerformanceMetrics();
    const cacheStatus = this.cache.getStatus();
    const perfReport = this.performanceMonitor.getReport();

    return {
      ...executionMetrics,
       
      cache: cacheStatus as unknown as Record<string, boolean | number | string>,
      instance: {
        averageProcessingTime: this.instanceMetrics.filesProcessed > 0
          ? this.instanceMetrics.totalProcessingTime / this.instanceMetrics.filesProcessed
          : 0,
        cacheHitRate: this.instanceMetrics.cacheHits + this.instanceMetrics.cacheMisses > 0
          ? (this.instanceMetrics.cacheHits / (this.instanceMetrics.cacheHits + this.instanceMetrics.cacheMisses) * PERCENTAGE_MULTIPLIER).toFixed(DECIMAL_PRECISION)
          : 0,
        cacheHits: this.instanceMetrics.cacheHits,
        cacheMisses: this.instanceMetrics.cacheMisses,
        entriesProcessed: this.instanceMetrics.entriesProcessed,
        filesProcessed: this.instanceMetrics.filesProcessed,
        totalProcessingTime: this.instanceMetrics.totalProcessingTime
      },
       
      performance: perfReport as unknown as Record<string, boolean | number | string>
    };
  }

  getTimeBasedMetrics(days: number | undefined = undefined): TimeMetrics {
    let relevantData = this.timeSeriesData;

    if (days !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      relevantData = this.timeSeriesData.filter((d) => new Date(d.date) >= cutoff);
    }

    // Generate hourly activity data
    const hourlyActivity = Array.from({length: HOURS_PER_DAY}).fill(0) as number[];

    for (const session of this.sessions.values()) {
      const hour = session.startTime.getHours();
      if (hour >= 0 && hour < HOURS_PER_DAY) {
        const currentValue = hourlyActivity[hour];
        if (currentValue !== undefined) {
          hourlyActivity[hour] = currentValue + 1;
        }
      }
    }

    return {
      daily: relevantData,
      hourly: hourlyActivity
    };
  }

  /**
   * Get performance metrics and statistics
   */
  
  getTrendMetrics(days: number | undefined = undefined): { successRateTrend: number; workflowTrend: number } {
    let relevantData = this.timeSeriesData;

    if (days !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      relevantData = this.timeSeriesData.filter((d) => new Date(d.date) >= cutoff);
    }

    const minTrendDataPoints = 2;
    if (relevantData.length < minTrendDataPoints) {
      return { successRateTrend: 0, workflowTrend: 0 };
    }

    const recent = relevantData.slice(TREND_PREVIOUS_DAYS_END);
    const previous = relevantData.slice(TREND_PREVIOUS_DAYS_START, TREND_PREVIOUS_DAYS_END);

    const recentSuccessRate = recent.reduce((sum, d) => sum + d.successRate, 0) / recent.length;
    const previousSuccessRate = previous.length > 0 ?
      previous.reduce((sum, d) => sum + d.successRate, 0) / previous.length : recentSuccessRate;

    const recentWorkflows = recent.reduce((sum, d) => sum + d.workflows, 0);
    const previousWorkflows = previous.length > 0 ?
      previous.reduce((sum, d) => sum + d.workflows, 0) : recentWorkflows;

    return {
      successRateTrend: recentSuccessRate - previousSuccessRate,
      workflowTrend: recentWorkflows - previousWorkflows
    };
  }

  /**
   * Parse individual JSONL log file with streaming and caching
   */
  async parseLogFile(logPath: string, options: Record<string, boolean | number | string> = {}): Promise<void> {
    const startTime = Date.now();
    const fileStats = { entriesProcessed: 0, errorsEncountered: 0 };

    try {
      // Get file stats for progress tracking
      const fileStat = await fs.stat(logPath);
      this.instanceMetrics.filesProcessed++;

      // Start performance monitoring for this file
      this.performanceMonitor.startFile(logPath, fileStat.size);

      try {
        // Check cache first if optimizations are enabled
        if (this.optimizationEnabled) {
          const cachedData = await this.cache.get(logPath);
          if (cachedData !== undefined && Array.isArray(cachedData)) {
            this.instanceMetrics.cacheHits++;

            // Process cached entries
            for (const entry of cachedData) {
              try {
                this.processLogEntry(entry as Record<string, boolean | number | Record<string, boolean | number | string> | string>, options);
                fileStats.entriesProcessed++;
              } catch {
                fileStats.errorsEncountered++;
              }
            }

            // End file monitoring
            this.performanceMonitor.endFile(logPath, fileStats.entriesProcessed, fileStats.errorsEncountered);
            return;
          }
          this.instanceMetrics.cacheMisses++;
        }

        // Process file with streaming
        const processResult = await this.streamProcessor.processFile(
          logPath,
          ((entry: Record<string, boolean | number | Record<string, boolean | number | string> | string>) => {
            try {
              this.processLogEntry(entry, options);
              fileStats.entriesProcessed++;
            } catch {
              fileStats.errorsEncountered++;
            }
          }) as EntryCallback
        );

        // Cache the processed entries if caching is enabled and file was successfully processed
        if (this.optimizationEnabled && processResult.entriesProcessed > 0) {
          const entries = await this.streamProcessor.processFileToArray(logPath);
          // Type assertion: JsonValue[] is compatible with ParsedLogData structure
           
          await this.cache.set(logPath, entries as unknown as ParsedLogData);
        }

        // End file monitoring
        this.performanceMonitor.endFile(logPath, fileStats.entriesProcessed, fileStats.errorsEncountered);
      } catch (processingError) {
        // Handle streaming/caching errors
        fileStats.errorsEncountered++;
        console.warn("Error during log processing:", processingError instanceof Error ? processingError.message : String(processingError));
      }

      // Update instance metrics
      this.instanceMetrics.entriesProcessed += fileStats.entriesProcessed;
      this.instanceMetrics.totalProcessingTime += Date.now() - startTime;

    } catch (error) {
      // Log parsing errors but continue with other files
      console.warn(`Failed to parse log file ${logPath}:`, error instanceof Error ? (error).message : String(error));
    }
  }

  /**
   * Parse orchestration logs from agent-orchestrator hook and agent-spawning-tracker
   * Logs location: .claude/logs/session-{id}/agent-orchestration.log and agent-spawning.log
   */
  async parseLogs(options: Record<string, boolean | number | string> = {}): Promise<void> {
    this.performanceMonitor.startSession({
      operation: "parseLogs",
      options: JSON.stringify(options)
    });

    const logPaths = await this.getLogPaths();

    // Reset data for fresh parsing
    this.sessions.clear();
    this.workflows.clear();
    this.agentChains = [];
    this.agentStats.clear();
    this.timeSeriesData = [];

    try {
      for (const logPath of logPaths) {
        await this.parseLogFile(logPath, options);
      }

      this.calculateMetrics();
      this.buildTimeSeriesData();
    } finally {
      this.performanceMonitor.endSession();
    }
  }

  /**
   * Process individual log entry and update analytics data
   */
  processLogEntry(entry: Record<string, boolean | number | Record<string, boolean | number | string> | string>, options: Record<string, boolean | number | string> = {}): void {
    const logEntry = entry;
    const { agentId, agentType, executionTime, nextAction, orchestrationDecision, sessionId, status, timestamp } = logEntry;

    // Apply date filter if specified
    const daysFilter = options.days;
    if (typeof daysFilter === "number" && typeof timestamp === "string") {
      const entryTime = new Date(timestamp).getTime();
      const cutoff = Date.now() - (daysFilter * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND);
      if (entryTime < cutoff) return;
    }

    // Apply session filter if specified
    const sessionFilter = options.session;
    if (sessionFilter !== undefined && sessionId !== sessionFilter) return;

    // Track session
    if (typeof sessionId === "string" && typeof timestamp === "string" && !this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        agents: [],
        endTime: undefined,
        sessionId,
        startTime: new Date(timestamp),
        workflows: []
      });
    }

    if (typeof sessionId !== "string") return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Update session end time
    if (typeof timestamp === "string") {
      session.endTime = new Date(timestamp);
    }

    // Track agent activity
    if (typeof agentId === "string" && typeof agentType === "string") {
      const agentData: AgentData = {
        decision: typeof orchestrationDecision === "string" ? orchestrationDecision : "unknown",
        executionTime: typeof executionTime === "number" ? executionTime : 0,
        id: agentId,
        status: typeof status === "string" ? status : "unknown",
        timestamp: typeof timestamp === "string" ? new Date(timestamp) : new Date(),
        type: agentType
      };

      session.agents.push(agentData);

      // Update agent statistics
      if (!this.agentStats.has(agentType)) {
        this.agentStats.set(agentType, {
          count: 0,
          failure: 0,
          outcomes: new Map(),
          success: 0,
          totalTime: 0
        });
      }

      const stats = this.agentStats.get(agentType);
      if (!stats) return;

      stats.count++;
      stats.totalTime += typeof executionTime === "number" ? executionTime : 0;

      // Track outcome types
      const outcome = typeof orchestrationDecision === "string" ? orchestrationDecision :
        (typeof status === "string" ? status : "unknown");
      stats.outcomes.set(outcome, (stats.outcomes.get(outcome) ?? 0) + 1);

      // Determine success/failure based on orchestration decision and status
      const isSuccess = (typeof orchestrationDecision === "string" &&
        orchestrationDecision !== "blocked" &&
        orchestrationDecision !== "error" &&
        orchestrationDecision !== "skipped") &&
        (status === "success" || status === "partial");

      if (isSuccess) {
        stats.success++;
      } else {
        stats.failure++;
      }
    }

    // Track workflow chains
    if (typeof nextAction === "object") {
      const action = nextAction;
      if ("type" in action && action.type === "spawn_agent" && "agent_name" in action && typeof action.agent_name === "string") {
         
        const agentTypeStr = typeof agentType === "string" ? agentType : String(agentType);
        const chainData: AgentChain = {
          from: agentTypeStr,
          sessionId,
          success: status === "success",
          timestamp: typeof timestamp === "string" ? new Date(timestamp) : new Date(),
          to: action.agent_name
        };
        this.agentChains.push(chainData);
      }
    }
  }
}