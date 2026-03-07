/**
 * UpdateExecutorService - Manages project update jobs with SSE streaming
 * @module dashboard/services/update-executor
 *
 * Executes `claude-workflow update` commands in project directories,
 * manages job queue with rate limiting, and streams output via SSE.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { tryAutoDetectHostPath } from "../../utils/docker-utils.js";

// Rate limiting constants
// Note: Per-project limit of 1 is enforced implicitly by Map's single-value-per-key behavior
const MAX_CONCURRENT_TOTAL = 3;

// Memory management constants
const JOB_TTL_MS = 5 * 60 * 1000; // Jobs cleaned up 5 minutes after completion
const MAX_OUTPUT_LINES = 500; // Limit output buffer per job
const CLEANUP_INTERVAL_MS = 60 * 1000; // Run cleanup every minute

/**
 * Status of an update job
 */
export type UpdateJobStatus = "pending" | "queued" | "running" | "completed" | "failed";

/**
 * Update job metadata and state
 */
export interface UpdateJob {
  /** Unique job identifier */
  id: string;
  /** Absolute path to project directory */
  projectPath: string;
  /** Current job status */
  status: UpdateJobStatus;
  /** When job was queued */
  queuedAt: Date;
  /** When job started running */
  startedAt?: Date;
  /** When job completed */
  completedAt?: Date;
  /** Exit code from update command */
  exitCode?: number;
  /** Buffered output lines for late subscribers */
  outputLines: Array<{ line: string; stream: "stdout" | "stderr"; timestamp: Date }>;
}

/**
 * Job subscriber callbacks for SSE streaming
 */
interface JobSubscriber {
  /** Called on each line of output */
  onOutput: (line: string, stream: "stdout" | "stderr") => void;
  /** Called when job completes successfully */
  onComplete: (exitCode: number) => void;
  /** Called when job fails */
  onError: (error: string) => void;
}

/**
 * Service for managing project update jobs with rate limiting and SSE streaming
 *
 * Features:
 * - Job queue with UUID-based tracking
 * - Per-project rate limiting (max 1 concurrent)
 * - Global rate limiting (max 2 concurrent) with automatic queuing
 * - Server-Sent Events streaming of stdout/stderr
 * - Output buffering for late subscribers
 */
export class UpdateExecutorService {
  private jobs: Map<string, UpdateJob> = new Map();
  private runningByProject: Map<string, string> = new Map(); // projectPath -> jobId
  private pendingByProject: Map<string, string> = new Map(); // projectPath -> jobId (queued)
  private subscribers: Map<string, Set<JobSubscriber>> = new Map();
  private jobQueue: string[] = []; // Queue of job IDs waiting to run
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanupCompletedJobs(), CLEANUP_INTERVAL_MS);
    // Unref so it doesn't keep the process alive
    this.cleanupTimer.unref();
  }

  /**
   * Clean up completed/failed jobs older than TTL
   */
  private cleanupCompletedJobs(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, job] of this.jobs) {
      // Only clean completed/failed jobs
      if (job.status !== "completed" && job.status !== "failed") continue;

      // Check if job is older than TTL
      const completedAt = job.completedAt?.getTime() ?? 0;
      if (now - completedAt > JOB_TTL_MS) {
        this.jobs.delete(jobId);
        this.subscribers.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[update-executor] Cleaned up ${cleaned} old jobs, ${this.jobs.size} remaining`);
    }
  }

  /** Current number of running jobs */
  get runningCount(): number {
    return this.runningByProject.size;
  }

  /** Current number of queued jobs */
  get queuedCount(): number {
    return this.jobQueue.length;
  }

  /**
   * Start an update job for a project
   * Jobs are queued if max concurrent limit is reached
   *
   * @param projectPath - Absolute path to project directory
   * @returns Created UpdateJob with pending or queued status
   * @throws Error if project already has a job in progress or queued
   */
  startUpdate(projectPath: string): UpdateJob {
    // Check if project already has a job running
    if (this.runningByProject.has(projectPath)) {
      throw new Error(
        `Rate limit: Project ${projectPath} already has an update in progress ` +
        `(job ${this.runningByProject.get(projectPath)})`
      );
    }

    // Check if project already has a job queued
    if (this.pendingByProject.has(projectPath)) {
      throw new Error(
        `Rate limit: Project ${projectPath} already has an update queued ` +
        `(job ${this.pendingByProject.get(projectPath)})`
      );
    }

    // Create job
    const job: UpdateJob = {
      id: randomUUID(),
      projectPath,
      status: "pending",
      queuedAt: new Date(),
      outputLines: [],
    };

    this.jobs.set(job.id, job);

    // Check if we can run immediately or need to queue
    if (this.runningCount < MAX_CONCURRENT_TOTAL) {
      // Run immediately
      this.runningByProject.set(projectPath, job.id);
      this.executeUpdate(job).catch((error) => {
        console.error(`[update-executor] Job ${job.id} error:`, error);
      });
    } else {
      // Queue for later
      job.status = "queued";
      this.pendingByProject.set(projectPath, job.id);
      this.jobQueue.push(job.id);
      console.log(`[update-executor] Job ${job.id} queued (${this.jobQueue.length} in queue, ${this.runningCount} running)`);

      // Notify subscribers that job is queued
      this.notifySubscribers(job.id, "output", {
        line: `⏳ Queued (position ${this.jobQueue.length}, waiting for ${this.runningCount} running jobs to complete)`,
        stream: "stdout"
      });
    }

    return job;
  }

  /**
   * Process next job in queue if capacity available
   */
  private processQueue(): void {
    while (this.runningCount < MAX_CONCURRENT_TOTAL && this.jobQueue.length > 0) {
      const jobId = this.jobQueue.shift()!;
      const job = this.jobs.get(jobId);

      if (!job) {
        console.warn(`[update-executor] Queued job ${jobId} not found, skipping`);
        continue;
      }

      // Move from pending to running
      this.pendingByProject.delete(job.projectPath);
      this.runningByProject.set(job.projectPath, job.id);

      console.log(`[update-executor] Dequeued job ${job.id}, starting (${this.jobQueue.length} remaining in queue)`);

      // Notify that job is starting
      this.notifySubscribers(job.id, "output", {
        line: "▶️ Starting update (was queued)",
        stream: "stdout"
      });

      this.executeUpdate(job).catch((error) => {
        console.error(`[update-executor] Job ${job.id} error:`, error);
      });
    }
  }

  /**
   * Get job by ID
   *
   * @param jobId - Job UUID
   * @returns Job object or undefined if not found
   */
  getJob(jobId: string): UpdateJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Subscribe to job output for SSE streaming
   *
   * Sends buffered output to new subscriber immediately,
   * then streams new output as it arrives.
   *
   * @param jobId - Job UUID
   * @param subscriber - Callbacks for output, completion, errors
   * @returns Unsubscribe function
   */
  subscribeToJob(jobId: string, subscriber: JobSubscriber): () => void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set());
    }
    this.subscribers.get(jobId)!.add(subscriber);
    console.log(`[update-executor] Subscriber added for job ${jobId}, total subscribers: ${this.subscribers.get(jobId)!.size}`);

    // Send buffered output to new subscriber
    const job = this.jobs.get(jobId);
    if (job) {
      console.log(`[update-executor] Job ${jobId} status at subscription: ${job.status}, exitCode: ${job.exitCode}`);
      for (const { line, stream } of job.outputLines) {
        subscriber.onOutput(line, stream);
      }
      if (job.status === "completed") {
        console.log(`[update-executor] Job ${jobId} already completed, calling onComplete immediately`);
        subscriber.onComplete(job.exitCode ?? 0);
      } else if (job.status === "failed") {
        console.log(`[update-executor] Job ${jobId} already failed, calling onError immediately`);
        subscriber.onError("Job failed");
      }
    } else {
      console.log(`[update-executor] Job ${jobId} not found at subscription time`);
    }

    return () => {
      this.subscribers.get(jobId)?.delete(subscriber);
      console.log(`[update-executor] Subscriber removed for job ${jobId}`);
    };
  }

  /**
   * Convert container path to host path for settings.json hook paths
   * Uses /proc/self/mountinfo to automatically detect volume mount mappings
   */
  private containerPathToHostPath(containerPath: string): string {
    const autoDetected = tryAutoDetectHostPath(containerPath);
    if (autoDetected) {
      return autoDetected;
    }
    return containerPath;
  }

  /**
   * Execute update command for a job
   *
   * Spawns `claude-workflow update` in project directory,
   * captures stdout/stderr, and notifies subscribers.
   * Uses globally installed claude-workflow (installed in Docker container).
   *
   * @param job - Job to execute
   */
  private async executeUpdate(job: UpdateJob): Promise<void> {
    job.status = "running";
    job.startedAt = new Date();

    // Compute the host path for settings.json hook paths
    // This translates /app/projects/... to /home/user/... for Claude Code on host
    const hostPath = this.containerPathToHostPath(job.projectPath);

    console.log(`[update-executor] Starting job ${job.id} for project: ${job.projectPath}`);
    console.log(`[update-executor] Host path for settings: ${hostPath}`);
    console.log("[update-executor] Command: claude-workflow update --force");
    console.log(`[update-executor] Working directory: ${job.projectPath}`);

    return new Promise((resolve) => {
      // Strip NODE_OPTIONS from child process env to prevent inheriting
      // the dashboard's --max-old-space-size=5120, which gives the update
      // command an unnecessarily large 5GB heap budget
      // Also set LIGHTWEIGHT_UPDATE=1 to skip heavy Docker ops (npm pack, npm install)
      // that aren't needed when running from the dashboard container
      // eslint-disable-next-line unused-imports/no-unused-vars -- destructure to omit NODE_OPTIONS
      const { NODE_OPTIONS: _, ...envWithoutNodeOptions } = process.env;
      const childEnv = {
        ...envWithoutNodeOptions,
        FORCE_COLOR: "1",
        HOST_PATH_FOR_SETTINGS: hostPath,
        LIGHTWEIGHT_UPDATE: "1",
      };

      const child = spawn("claude-workflow", ["update", "--force"], {
        cwd: job.projectPath,
        env: childEnv,
        shell: true,
      });

      const handleOutput = (data: Buffer, stream: "stdout" | "stderr"): void => {
        const lines = data.toString().split("\n").filter((l) => l.trim());
        for (const line of lines) {
          // Log stderr for debugging
          if (stream === "stderr") {
            console.error(`[update-executor] stderr (${job.id}): ${line}`);
          }
          // Limit output buffer to prevent memory bloat
          if (job.outputLines.length < MAX_OUTPUT_LINES) {
            job.outputLines.push({ line, stream, timestamp: new Date() });
          } else if (job.outputLines.length === MAX_OUTPUT_LINES) {
            job.outputLines.push({ line: `... output truncated (>${MAX_OUTPUT_LINES} lines)`, stream: "stderr", timestamp: new Date() });
          }
          this.notifySubscribers(job.id, "output", { line, stream });
        }
      };

      child.stdout?.on("data", (data: Buffer) => handleOutput(data, "stdout"));
      child.stderr?.on("data", (data: Buffer) => handleOutput(data, "stderr"));

      child.on("close", (code) => {
        const exitCode = code ?? 1;
        job.status = exitCode === 0 ? "completed" : "failed";
        job.exitCode = exitCode;
        job.completedAt = new Date();

        // Log job completion with meaningful context
        if (exitCode === 0) {
          console.log(`[update-executor] Job ${job.id} completed successfully`);
        } else {
          const stderrLines = job.outputLines
            .filter((o) => o.stream === "stderr")
            .map((o) => o.line);
          const errorMessage = stderrLines.length > 0
            ? stderrLines.join("\n")
            : `Update failed with exit code ${exitCode}`;
          console.error(`[update-executor] Job ${job.id} failed (exit code ${exitCode}): ${errorMessage}`);
        }

        // Release rate limit slot
        this.runningByProject.delete(job.projectPath);

        this.notifySubscribers(job.id, "complete", { exitCode });

        // Process next queued job
        this.processQueue();

        resolve();
      });

      child.on("error", (error) => {
        console.error(`[update-executor] Job ${job.id} spawn error: ${error.message}`);
        job.status = "failed";
        job.completedAt = new Date();

        this.runningByProject.delete(job.projectPath);

        this.notifySubscribers(job.id, "error", { error: error.message });

        // Process next queued job
        this.processQueue();

        resolve();
      });
    });
  }

  /**
   * Notify all subscribers of a job event
   *
   * @param jobId - Job UUID
   * @param event - Event type
   * @param data - Event payload
   */
  private notifySubscribers(
    jobId: string,
    event: "output" | "complete" | "error",
    data: { line?: string; stream?: "stdout" | "stderr"; exitCode?: number; error?: string }
  ): void {
    const subs = this.subscribers.get(jobId);
    if (!subs) {
      console.log(`[update-executor] notifySubscribers: No subscribers for job ${jobId}, event: ${event}`);
      return;
    }
    console.log(`[update-executor] notifySubscribers: job ${jobId}, event: ${event}, subscribers: ${subs.size}`);

    for (const sub of subs) {
      switch (event) {
      case "output": {
        if (data.line !== undefined && data.stream !== undefined) {
          sub.onOutput(data.line, data.stream);
        }
        break;
      }
      case "complete": {
        console.log(`[update-executor] Calling subscriber.onComplete for job ${jobId} with exitCode ${data.exitCode}`);
        sub.onComplete(data.exitCode ?? 0);
        break;
      }
      case "error": {
        console.log(`[update-executor] Calling subscriber.onError for job ${jobId}`);
        sub.onError(data.error ?? "Unknown error");
        break;
      }
      }
    }
  }
}
