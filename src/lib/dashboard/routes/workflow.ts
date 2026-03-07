/**
 * Workflow Router
 * REST API endpoints for workflow detection, events, and status
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";
import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";

import type {
  LogEvent,
  WorkflowStartEvent,
  WorkflowStageEvent,
  WorkflowTriggerEvent,
  WorkflowCompleteEvent,
  WorkflowResumedEvent,
  AgentInvocationEvent,
} from "../services/types/log-entry.js";

import {
  isWorkflowStartEvent,
  isWorkflowStageEvent,
  isWorkflowTriggerEvent,
  isWorkflowCompleteEvent,
  isWorkflowResumedEvent,
  isWorkflowEvent,
  isAgentInvocationEvent,
} from "../services/types/log-entry.js";

import type { ProjectScannerService } from "../services/project-scanner.js";

// Pagination constants
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// HTTP status codes
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// Manually completed workflows storage file (stored in .claude-workflow directory for Docker persistence)
const COMPLETED_WORKFLOWS_FILE = "completed-workflows.json";

// Maximum events.jsonl file size to read (50MB) - prevents memory exhaustion on huge files
const MAX_EVENTS_FILE_SIZE = 50 * 1024 * 1024;

// Cache for workflow events to avoid re-reading entire files on every poll (every 3s)
// Uses file mtime as cache key - only re-reads when file actually changes
interface EventCache<T> {
  events: T[];
  mtimeMs: number;
  sizeBytes: number;
}

const workflowEventCache = new Map<string, EventCache<WorkflowEventWithProject>>();
const extendedEventCache = new Map<string, EventCache<ExtendedEventWithProject>>();

/** Structure for tracking manually completed workflows */
interface CompletedWorkflowsData {
  /** Map of project name to completion timestamp */
  completedProjects: Record<string, string>;
}

/**
 * Get the path to the completed workflows file
 * Stores in ~/.claude-workflow/ directory which is mounted as a Docker volume
 */
function getCompletedWorkflowsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  // Store in .claude-workflow directory which is mounted as a volume in Docker
  // This ensures persistence across container restarts/rebuilds
  const workflowDir = path.join(homeDir, ".claude-workflow");

  // Ensure the directory exists
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
  }

  return path.join(workflowDir, COMPLETED_WORKFLOWS_FILE);
}

/**
 * Read the list of manually completed workflows
 */
function readCompletedWorkflows(): CompletedWorkflowsData {
  const filePath = getCompletedWorkflowsPath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data) as CompletedWorkflowsData;
    }
  } catch {
    // Ignore errors, return empty
  }
  return { completedProjects: {} };
}

/**
 * Write the list of manually completed workflows
 */
function writeCompletedWorkflows(data: CompletedWorkflowsData): void {
  const filePath = getCompletedWorkflowsPath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Mark a project's workflow as manually complete
 */
function markWorkflowComplete(projectName: string): void {
  const data = readCompletedWorkflows();
  data.completedProjects[projectName] = new Date().toISOString();
  writeCompletedWorkflows(data);
}

/**
 * Check if a project's workflow has been manually marked complete
 */
function isWorkflowManuallyComplete(projectName: string): boolean {
  const data = readCompletedWorkflows();
  return projectName in data.completedProjects;
}

/**
 * Clear manual completion for a project (called when new workflow starts)
 */
function clearWorkflowComplete(projectName: string): void {
  const data = readCompletedWorkflows();
  if (projectName in data.completedProjects) {
    delete data.completedProjects[projectName];
    writeCompletedWorkflows(data);
  }
}

/**
 * Error response
 */
interface ErrorResponse {
  error: string;
  message?: string;
}

/**
 * Workflow event with human-readable message
 */
interface WorkflowEventResponse {
  ts: string;
  type: "workflow_start" | "workflow_stage" | "workflow_trigger" | "workflow_complete" | "workflow_resumed";
  session: string;
  message: string;
  /** Project name where workflow event originated */
  project: string;
  // Start-specific fields
  workflowName?: string;
  promptPreview?: string;
  // Stage-specific fields
  stage?: string;
  action?: string;
  agentType?: string;
  toolName?: string;
  reason?: string;
  stageProgress?: { completed: number; total: number };
  // Trigger-specific fields
  taskId?: number;
  completedAgent?: string;
  nextAgent?: string;
  // Complete-specific fields
  stagesCompleted?: string[];
  // Resumed-specific fields
  previousSessionId?: string;
  currentPhase?: string;
  staleAgentCount?: number;
}

/**
 * Workflow status response
 */
interface WorkflowStatusResponse {
  /** Whether a workflow is currently active */
  active: boolean;
  /** Current stage if active */
  currentStage?: string;
  /** Number of active tasks in pipeline */
  activeTasks?: number;
  /** Recent workflow events count (last 24h) */
  recentEventsCount: number;
  /** Last workflow event timestamp */
  lastEventTime?: string;
  /** Human-readable workflow name from workflow_start event */
  workflowName: string;
}

/**
 * Per-session workflow status (legacy, kept for compatibility)
 */
interface SessionWorkflowStatus {
  /** Session identifier (timestamp-pid format) */
  session: string;
  /** Project name where workflow runs */
  project: string;
  /** Whether this session has an active workflow */
  active: boolean;
  /** Current stage if active */
  currentStage?: string;
  /** Number of active tasks */
  activeTasks: number;
  /** Total event count for this session */
  eventCount: number;
  /** Last event timestamp */
  lastEventTime?: string;
  /** Human-readable workflow name from workflow_start event */
  workflowName: string;
}

/** Workflow status classification for UI grouping */
type WorkflowStatusType = "active" | "paused" | "complete";

/**
 * Per-project workflow status
 * Groups all sessions/workflows by project name
 */
interface ProjectWorkflowStatus {
  /** Project name */
  project: string;
  /** Whether this project has an active workflow */
  active: boolean;
  /** Workflow status for UI grouping: active, paused, or complete */
  workflowStatus: WorkflowStatusType;
  /** Current stage if active */
  currentStage?: string;
  /** Current agent being executed (from most recent agent_invocation) */
  currentAgent?: string;
  /** Number of active tasks across all sessions */
  activeTasks: number;
  /** Total event count for this project (last 24h) */
  eventCount: number;
  /** Last event timestamp */
  lastEventTime?: string;
  /** Human-readable workflow name from most recent workflow_start event */
  workflowName?: string;
  /** Whether this workflow has been manually marked complete */
  manuallyCompleted?: boolean;
  /** Session ID for resuming workflow (claude --resume <sessionId>) */
  sessionId?: string;
}

/**
 * Projects status response with summary
 */
interface WorkflowProjectsStatusResponse {
  /** Per-project status list */
  projects: ProjectWorkflowStatus[];
  /** Summary across all projects */
  summary: {
    /** Number of projects with active workflows */
    activeCount: number;
    /** Number of projects with paused workflows */
    pausedCount: number;
    /** Number of projects with complete workflows */
    completeCount: number;
    /** Total number of projects with workflow events */
    totalCount: number;
    /** Number of workflows not marked complete (legacy, kept for compatibility) */
    incompleteCount: number;
  };
}

/** Sessions status response with summary - exported for API type documentation */
export interface WorkflowSessionsStatusResponse {
  /** Per-session status list */
  sessions: SessionWorkflowStatus[];
  /** Summary across all sessions */
  summary: {
    /** Number of sessions with active workflows */
    activeCount: number;
    /** Total number of sessions with workflow events */
    totalCount: number;
    /** Total events across all sessions in last 24h */
    totalEventsLast24h: number;
  };
}

/**
 * Paginated response wrapper
 */
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
}

/**
 * Query parameters for /api/workflow/events endpoint
 */
interface WorkflowEventsQueryParams {
  limit?: string;
  offset?: string;
  type?: string;
  session?: string;
}

/**
 * Router configuration
 */
export interface WorkflowRouterConfig {
  /** Project scanner service for dynamic project discovery */
  projectScanner: ProjectScannerService;
}

/**
 * Helper to get current project paths from scanner
 * This ensures newly registered projects are always included
 */
async function getProjectPaths(scanner: ProjectScannerService): Promise<string[]> {
  const projects = await scanner.scan();
  return projects.map((p) => p.path);
}

/**
 * Workflow event with attached project name
 */
type WorkflowEventWithProject = (WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent) & {
  _projectName: string;
};

/**
 * Extended event type that includes agent_invocation for status tracking
 */
type ExtendedEventWithProject = (WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent | AgentInvocationEvent) & {
  _projectName: string;
};

/**
 * Read workflow events from a project's events.jsonl
 * Uses mtime-based caching to avoid re-reading unchanged files on every poll
 */
async function readWorkflowEvents(
  projectPath: string
): Promise<WorkflowEventWithProject[]> {
  const eventsPath = path.join(projectPath, ".claude", "logs", "events.jsonl");

  if (!fs.existsSync(eventsPath)) {
    return [];
  }

  // Check file stats for cache validation and size guard
  const stats = fs.statSync(eventsPath);

  if (stats.size > MAX_EVENTS_FILE_SIZE) {
    console.warn(`[workflow] events.jsonl at ${eventsPath} exceeds ${String(MAX_EVENTS_FILE_SIZE)} bytes, skipping`);
    return [];
  }

  // Return cached result if file hasn't changed
  const cached = workflowEventCache.get(eventsPath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.sizeBytes === stats.size) {
    return cached.events;
  }

  // Extract project name from path (last directory name)
  const projectName = path.basename(projectPath);

  const events: WorkflowEventWithProject[] = [];

  const fileStream = fs.createReadStream(eventsPath);
  const rl = readline.createInterface({ input: fileStream });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as LogEvent;
        if (isWorkflowEvent(event)) {
          events.push({ ...event, _projectName: projectName });
        }
      } catch {
        // Skip corrupt lines
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  // Cache the result
  workflowEventCache.set(eventsPath, {
    events,
    mtimeMs: stats.mtimeMs,
    sizeBytes: stats.size,
  });

  return events;
}

/**
 * Read extended events from a project's events.jsonl
 * Includes workflow events AND agent_invocation events for comprehensive status tracking
 * Uses mtime-based caching to avoid re-reading unchanged files on every poll
 */
async function readExtendedEvents(
  projectPath: string
): Promise<ExtendedEventWithProject[]> {
  const eventsPath = path.join(projectPath, ".claude", "logs", "events.jsonl");

  if (!fs.existsSync(eventsPath)) {
    return [];
  }

  // Check file stats for cache validation and size guard
  const stats = fs.statSync(eventsPath);

  if (stats.size > MAX_EVENTS_FILE_SIZE) {
    console.warn(`[workflow] events.jsonl at ${eventsPath} exceeds ${String(MAX_EVENTS_FILE_SIZE)} bytes, skipping`);
    return [];
  }

  // Return cached result if file hasn't changed
  const cached = extendedEventCache.get(eventsPath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.sizeBytes === stats.size) {
    return cached.events;
  }

  // Extract project name from path (last directory name)
  const projectName = path.basename(projectPath);

  const events: ExtendedEventWithProject[] = [];

  const fileStream = fs.createReadStream(eventsPath);
  const rl = readline.createInterface({ input: fileStream });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as LogEvent;
        // Include workflow events AND agent_invocation events
        if (isWorkflowEvent(event) || isAgentInvocationEvent(event)) {
          events.push({ ...event, _projectName: projectName });
        }
      } catch {
        // Skip corrupt lines
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  // Cache the result
  extendedEventCache.set(eventsPath, {
    events,
    mtimeMs: stats.mtimeMs,
    sizeBytes: stats.size,
  });

  return events;
}

/**
 * Get the most recent agent from agent_invocation events
 * Returns undefined if no agent_invocation events found
 */
function getCurrentAgent(
  events: ExtendedEventWithProject[]
): string | undefined {
  // Filter to agent_invocation events
  const agentEvents = events.filter((e) => isAgentInvocationEvent(e)) as (AgentInvocationEvent & { _projectName: string })[];

  if (agentEvents.length === 0) return undefined;

  // Sort by timestamp descending to get most recent
  agentEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  return agentEvents[0].agent;
}

/**
 * Transform workflow event to response format
 */
function transformEvent(
  event: WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent,
  projectName: string
): WorkflowEventResponse {
  const base: WorkflowEventResponse = {
    ts: event.ts,
    type: event.type,
    session: event.session,
    message: (event as unknown as { _message?: string })._message ?? "",
    project: projectName,
  };

  if (isWorkflowStartEvent(event)) {
    base.workflowName = event.workflowName;
    base.promptPreview = event.promptPreview;
    if (!base.message) {
      base.message = `Start: "${event.workflowName || "Unnamed Workflow"}"`;
    }
  } else if (isWorkflowStageEvent(event)) {
    base.stage = event.stage;
    base.action = event.action;
    // Normalize empty strings to undefined for consistent frontend handling
    base.agentType = event.agentType || undefined;
    base.toolName = event.toolName || undefined;
    base.reason = event.reason;
    base.stageProgress = event.stageProgress;
    if (!base.message) {
      // Build meaningful fallback message
      // Priority: agentType > toolName > stage name
      const actor = event.agentType || event.toolName || "";
      const stage = event.stage || "workflow";
      const action = event.action || "processed";

      base.message = actor
        ? `${stage}: ${actor} ${action}`
        : `${stage}: ${action}`;

      // Append reason if available for context
      if (event.reason) {
        base.message += ` (${event.reason})`;
      }
    }
  } else if (isWorkflowTriggerEvent(event)) {
    base.taskId = event.taskId;
    base.completedAgent = event.completedAgent;
    base.nextAgent = event.nextAgent;
    if (!base.message) {
      base.message = `Pipeline: ${event.completedAgent || "agent"} triggered ${event.nextAgent || "next"} for task-${event.taskId}`;
    }
  } else if (isWorkflowCompleteEvent(event)) {
    base.taskId = event.taskId;
    base.stagesCompleted = event.stagesCompleted;
    if (!base.message) {
      const stages = event.stagesCompleted?.length ? event.stagesCompleted.join(" > ") : "completed";
      base.message = `Complete: task-${event.taskId} (${stages})`;
    }
  } else if (isWorkflowResumedEvent(event)) {
    base.previousSessionId = event.previousSessionId;
    base.currentPhase = event.currentPhase;
    base.staleAgentCount = event.staleAgentCount;
    base.workflowName = event.workflowName;
    if (!base.message) {
      const staleInfo = event.staleAgentCount > 0 ? ` (${event.staleAgentCount} stale agents)` : "";
      base.message = `Resumed: "${event.workflowName}" at phase ${event.currentPhase}${staleInfo}`;
    }
  }

  return base;
}

/**
 * Determine current workflow stage from recent events
 *
 * Fixed in Issue 3: Now also checks for workflow_complete events.
 * When the most recent event is a workflow_complete, returns "complete".
 * This ensures the dashboard properly shows workflows as complete after
 * code-reviewer finishes.
 */
function determineCurrentStage(
  events: (WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent)[]
): string | undefined {
  // Get workflow_complete events (Issue 3 fix)
  const completeEvents = events.filter((e) => isWorkflowCompleteEvent(e));

  // Get the most recent stage events
  const stageEvents = events.filter((e) => isWorkflowStageEvent(e));

  // If no events at all, return undefined
  if (completeEvents.length === 0 && stageEvents.length === 0) return undefined;

  // Combine and sort all relevant events by timestamp descending
  const allRelevantEvents = [...completeEvents, ...stageEvents];
  allRelevantEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // Get the most recent event
  const mostRecent = allRelevantEvents[0];

  // If most recent is a workflow_complete event, return "complete"
  if (isWorkflowCompleteEvent(mostRecent)) {
    return "complete";
  }

  // Otherwise return the stage from the most recent stage event
  // At this point, mostRecent must be a WorkflowStageEvent since we filtered for both types
  // and already handled the WorkflowCompleteEvent case above
  if (isWorkflowStageEvent(mostRecent)) {
    return mostRecent.stage;
  }
  return undefined;
}

/**
 * Count active tasks (triggered but not complete)
 */
function countActiveTasks(
  events: (WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent)[]
): number {
  const triggeredTasks = new Set<number>();
  const completedTasks = new Set<number>();

  for (const event of events) {
    if (isWorkflowTriggerEvent(event)) {
      triggeredTasks.add(event.taskId);
    } else if (isWorkflowCompleteEvent(event)) {
      completedTasks.add(event.taskId);
    }
  }

  // Active = triggered but not completed
  let count = 0;
  for (const taskId of triggeredTasks) {
    if (!completedTasks.has(taskId)) {
      count++;
    }
  }

  return count;
}

/**
 * Extract workflow name from events
 * Looks for the most recent workflow_start event and extracts workflowName
 * Returns "Unnamed Workflow" if no workflow_start event found or name is missing
 */
function getWorkflowName(
  events: (WorkflowStartEvent | WorkflowStageEvent | WorkflowTriggerEvent | WorkflowCompleteEvent | WorkflowResumedEvent)[]
): string {
  // Find workflow_start events
  const startEvents = events.filter((event) => isWorkflowStartEvent(event));

  if (startEvents.length === 0) {
    return "Unnamed Workflow";
  }

  // Sort by timestamp descending to get the most recent
  startEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // Return the most recent workflow name, or default if not set
  return startEvents[0].workflowName || "Unnamed Workflow";
}

/**
 * Create workflow router
 */
export function createWorkflowRouter(config: WorkflowRouterConfig): Router {
   
  const router: Router = express.Router() as Router;

  /**
   * GET /api/workflow/events - Query workflow events with pagination
   * By default, returns events from the most recent session per project within the last 24 hours.
   * This aligns with the /projects-status endpoint for consistent UI display.
   */
  router.get("/events", (req: Request, res: Response): void => {
    const handleEvents = async (): Promise<void> => {
      const query = req.query as WorkflowEventsQueryParams;

      // Parse pagination
      const limit = Math.min(
        Math.max(1, Number.parseInt(query.limit ?? String(DEFAULT_PAGE_SIZE), 10)),
        MAX_PAGE_SIZE
      );
      const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10));

      // Collect events from all projects (dynamically discovered)
      const projectPaths = await getProjectPaths(config.projectScanner);
      let allEvents: WorkflowEventWithProject[] = [];

      for (const projectPath of projectPaths) {
        const projectEvents = await readWorkflowEvents(projectPath);
        allEvents = [...allEvents, ...projectEvents];
      }

      // Filter to last 24 hours (aligned with /projects-status endpoint)
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      let recentEvents = allEvents.filter(
        (e) => new Date(e.ts).getTime() > dayAgo
      );

      // Sort by timestamp descending (newest first)
      recentEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      // Only include events from sessions that have a workflow_start event
      // This filters out non-workflow sessions without losing concurrent workflow sessions
      if (!query.session) {
        const workflowSessions = new Set<string>();
        for (const event of recentEvents) {
          if (isWorkflowStartEvent(event)) {
            workflowSessions.add(event.session);
          }
        }
        recentEvents = recentEvents.filter((event) => workflowSessions.has(event.session));
      }

      // Filter by type if specified
      if (query.type) {
        const filterType = `workflow_${query.type}`;
        recentEvents = recentEvents.filter((e) => e.type === filterType);
      }

      // Filter by session if specified (overrides the most-recent-session filter above)
      if (query.session) {
        recentEvents = recentEvents.filter((e) => e.session === query.session);
      }

      // Sort by timestamp ascending (chronological order - oldest first) for display
      recentEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      // Paginate - take the NEWEST events (from end of chronological array)
      // For a log viewer, we want most recent activity in chronological order
      const total = recentEvents.length;
      const startIdx = Math.max(0, total - limit - offset);
      const endIdx = Math.max(0, total - offset);
      const paginatedEvents = recentEvents.slice(startIdx, endIdx);

      // Transform to response format
      const transformedEvents = paginatedEvents.map((e) => transformEvent(e, e._projectName));

      const response: PaginatedResponse<WorkflowEventResponse> = {
        data: transformedEvents,
        pagination: {
          hasMore: offset + limit < total,
          limit,
          offset,
          total,
        },
      };

      res.status(HTTP_STATUS_OK).json(response);
    };

    handleEvents().catch((error: unknown) => {
      console.error("[workflow] Error querying events:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to query workflow events",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * GET /api/workflow/status - Get current workflow status
   */
  router.get("/status", (_req: Request, res: Response): void => {
    const handleStatus = async (): Promise<void> => {
      // Collect events from all projects (dynamically discovered)
      const projectPaths = await getProjectPaths(config.projectScanner);
      let allEvents: WorkflowEventWithProject[] = [];

      for (const projectPath of projectPaths) {
        const projectEvents = await readWorkflowEvents(projectPath);
        allEvents = [...allEvents, ...projectEvents];
      }

      // Sort by timestamp descending
      allEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      // Filter to last 24 hours for "recent" count
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const recentEvents = allEvents.filter(
        (e) => new Date(e.ts).getTime() > dayAgo
      );

      // Determine if workflow is active
      // Active if there are recent stage events that aren't "complete" AND there are active tasks
      const currentStage = determineCurrentStage(recentEvents);
      const activeTasks = countActiveTasks(recentEvents);
      const isActive =
        currentStage !== undefined &&
        currentStage !== "complete" &&
        activeTasks > 0;

      // Extract workflow name from most recent events
      const workflowName = getWorkflowName(recentEvents);

      const response: WorkflowStatusResponse = {
        active: isActive,
        currentStage: isActive ? currentStage : undefined,
        activeTasks: isActive ? activeTasks : undefined,
        recentEventsCount: recentEvents.length,
        lastEventTime: allEvents.length > 0 ? allEvents[0].ts : undefined,
        workflowName,
      };

      res.status(HTTP_STATUS_OK).json(response);
    };

    handleStatus().catch((error: unknown) => {
      console.error("[workflow] Error getting status:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get workflow status",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * GET /api/workflow/projects-status - Get per-session workflow status
   * Groups workflow events by session, so multiple concurrent workflows on the same
   * project each appear as separate entries in the dashboard
   */
  router.get("/projects-status", (_req: Request, res: Response): void => {
    const handleProjectsStatus = async (): Promise<void> => {
      // Collect extended events (workflow + agent_invocation) from all projects (dynamically discovered)
      const projectPaths = await getProjectPaths(config.projectScanner);
      let allEvents: ExtendedEventWithProject[] = [];

      for (const projectPath of projectPaths) {
        const projectEvents = await readExtendedEvents(projectPath);
        allEvents = [...allEvents, ...projectEvents];
      }

      // Filter to last 24 hours
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const recentEvents = allEvents.filter(
        (e) => new Date(e.ts).getTime() > dayAgo
      );

      // Sort by timestamp descending (newest first)
      recentEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      // Group events by SESSION (not project) to support multiple concurrent workflows
      // Each /workflow invocation gets its own session ID
      const eventsBySession = new Map<string, ExtendedEventWithProject[]>();
      for (const event of recentEvents) {
        const sessionId = event.session;
        if (!eventsBySession.has(sessionId)) {
          eventsBySession.set(sessionId, []);
        }
        eventsBySession.get(sessionId)!.push(event);
      }

      // Only include sessions that have at least one workflow_start event
      // This filters out non-workflow sessions (e.g., regular Claude sessions)
      const workflowSessions = new Map<string, ExtendedEventWithProject[]>();
      for (const [sessionId, events] of eventsBySession) {
        const hasWorkflowStart = events.some((e) => isWorkflowStartEvent(e));
        if (hasWorkflowStart) {
          workflowSessions.set(sessionId, events);
        }
      }

      // Build per-session status (one entry per workflow session)
      const projectStatuses: ProjectWorkflowStatus[] = [];

      for (const [sessionId, events] of workflowSessions) {
        // Sort events by timestamp descending
        events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        // Get project name from events
        const projectName = events[0]._projectName;

        // Filter to workflow events only for stage/task counting
        const workflowEvents = events.filter((e) => isWorkflowEvent(e)) as WorkflowEventWithProject[];

        const currentStage = determineCurrentStage(workflowEvents);
        const activeTasks = countActiveTasks(workflowEvents);

        // Get current agent from agent_invocation events
        const currentAgent = getCurrentAgent(events);

        // Check if manually completed (uses "project::session" key for per-session completion)
        const completionKey = `${projectName}::${sessionId}`;
        const manuallyCompleted = isWorkflowManuallyComplete(completionKey) || isWorkflowManuallyComplete(projectName);

        // Check for recent workflow_start event that should clear manual completion
        const startEvents = workflowEvents.filter((e) => isWorkflowStartEvent(e));
        if (manuallyCompleted && startEvents.length > 0) {
          const completedData = readCompletedWorkflows();
          // Check both legacy (project-only) and new (project::session) keys
          const completedTime = completedData.completedProjects[completionKey] ?? completedData.completedProjects[projectName];
          if (completedTime) {
            const mostRecentStart = new Date(startEvents[0].ts).getTime();
            const completedTimestamp = new Date(completedTime).getTime();
            if (mostRecentStart > completedTimestamp) {
              clearWorkflowComplete(completionKey);
              clearWorkflowComplete(projectName);
            }
          }
        }

        // Re-check manual completion status after potential clear
        const isManuallyComplete = isWorkflowManuallyComplete(completionKey) || isWorkflowManuallyComplete(projectName);

        // Active if: has non-complete stage AND has active tasks OR recent events (within 5 min)
        const lastEventTime = events.length > 0 ? new Date(events[0].ts).getTime() : 0;
        const isRecent = now - lastEventTime < 5 * 60 * 1000; // 5 minutes
        const isActive = !isManuallyComplete && ((currentStage !== undefined && currentStage !== "complete" && activeTasks > 0) || isRecent);

        // Determine workflow status for UI grouping
        let workflowStatus: WorkflowStatusType;
        if (isManuallyComplete || currentStage === "complete") {
          workflowStatus = "complete";
        } else if (isActive) {
          workflowStatus = "active";
        } else {
          workflowStatus = "paused";
        }

        // Extract workflow name from this session's workflow events
        const workflowName = getWorkflowName(workflowEvents);

        projectStatuses.push({
          project: projectName,
          active: isActive,
          workflowStatus,
          currentStage: isActive ? currentStage : undefined,
          currentAgent: isActive ? currentAgent : undefined,
          activeTasks,
          eventCount: events.length,
          lastEventTime: events.length > 0 ? events[0].ts : undefined,
          workflowName: workflowName === "Unnamed Workflow" ? undefined : workflowName,
          manuallyCompleted: isManuallyComplete,
          sessionId,
        });
      }

      // Sort: active first, then paused, then complete - within each group by last event time
      const statusOrder: Record<WorkflowStatusType, number> = { active: 0, paused: 1, complete: 2 };
      projectStatuses.sort((a, b) => {
        const statusDiff = statusOrder[a.workflowStatus] - statusOrder[b.workflowStatus];
        if (statusDiff !== 0) {
          return statusDiff;
        }
        // Same status - sort by last event time descending
        const aTime = a.lastEventTime ? new Date(a.lastEventTime).getTime() : 0;
        const bTime = b.lastEventTime ? new Date(b.lastEventTime).getTime() : 0;
        return bTime - aTime;
      });

      // Build summary
      const activeCount = projectStatuses.filter((p) => p.workflowStatus === "active").length;
      const pausedCount = projectStatuses.filter((p) => p.workflowStatus === "paused").length;
      const completeCount = projectStatuses.filter((p) => p.workflowStatus === "complete").length;
      // Count workflows not marked complete (legacy, kept for compatibility)
      const incompleteCount = projectStatuses.filter(
        (p) => p.workflowStatus !== "complete"
      ).length;

      const response: WorkflowProjectsStatusResponse = {
        projects: projectStatuses,
        summary: {
          activeCount,
          pausedCount,
          completeCount,
          totalCount: projectStatuses.length,
          incompleteCount,
        },
      };

      res.status(HTTP_STATUS_OK).json(response);
    };

    handleProjectsStatus().catch((error: unknown) => {
      console.error("[workflow] Error getting projects status:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get project workflow status",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * GET /api/workflow/sessions/:sessionId - Get workflow events for a specific session
   */
  router.get("/sessions/:sessionId", (req: Request, res: Response): void => {
    const handleSession = async (): Promise<void> => {
      const sessionId = String(req.params.sessionId);

      if (!sessionId) {
        const errorResponse: ErrorResponse = {
          error: "Session ID required",
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      // Collect events from all projects (dynamically discovered)
      const projectPaths = await getProjectPaths(config.projectScanner);
      let allEvents: WorkflowEventWithProject[] = [];

      for (const projectPath of projectPaths) {
        const projectEvents = await readWorkflowEvents(projectPath);
        allEvents = [...allEvents, ...projectEvents];
      }

      // Filter by session
      const sessionEvents = allEvents.filter((e) => e.session === sessionId);

      if (sessionEvents.length === 0) {
        const errorResponse: ErrorResponse = {
          error: "No workflow events found for session",
          message: `Session: ${sessionId}`,
        };
        res.status(HTTP_STATUS_NOT_FOUND).json(errorResponse);
        return;
      }

      // Sort by timestamp ascending (chronological)
      sessionEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      // Transform to response format
      const transformedEvents = sessionEvents.map((e) => transformEvent(e, e._projectName));

      res.status(HTTP_STATUS_OK).json({
        sessionId,
        events: transformedEvents,
        currentStage: determineCurrentStage(sessionEvents),
        activeTasks: countActiveTasks(sessionEvents),
      });
    };

    handleSession().catch((error: unknown) => {
      console.error("[workflow] Error getting session:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to get session workflow",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    });
  });

  /**
   * POST /api/workflow/projects/:projectName/complete - Mark a project's workflow as complete
   */
  router.post("/projects/:projectName/complete", (req: Request, res: Response): void => {
    const projectName = decodeURIComponent(String(req.params.projectName));

    if (!projectName) {
      const errorResponse: ErrorResponse = {
        error: "Project name required",
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
      return;
    }

    try {
      markWorkflowComplete(projectName);
      res.status(HTTP_STATUS_OK).json({
        success: true,
        project: projectName,
        completedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      console.error("[workflow] Error marking workflow complete:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to mark workflow complete",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  /**
   * DELETE /api/workflow/projects/:projectName/complete - Clear a project's manual completion
   * (Reactivate a workflow that was manually marked complete)
   */
  router.delete("/projects/:projectName/complete", (req: Request, res: Response): void => {
    const projectName = decodeURIComponent(String(req.params.projectName));

    if (!projectName) {
      const errorResponse: ErrorResponse = {
        error: "Project name required",
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(errorResponse);
      return;
    }

    try {
      clearWorkflowComplete(projectName);
      res.status(HTTP_STATUS_OK).json({
        success: true,
        project: projectName,
        message: "Manual completion cleared",
      });
    } catch (error: unknown) {
      console.error("[workflow] Error clearing workflow completion:", error);
      const errorResponse: ErrorResponse = {
        error: "Failed to clear workflow completion",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      res.status(HTTP_STATUS_INTERNAL_ERROR).json(errorResponse);
    }
  });

  return router;
}

/**
 * Export types for external use
 */
export type {
  ErrorResponse,
  WorkflowEventResponse,
  WorkflowStatusResponse,
  PaginatedResponse,
  WorkflowEventsQueryParams,
};
