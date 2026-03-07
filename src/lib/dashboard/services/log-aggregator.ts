/**
 * Log Aggregator Service
 * Rewritten for event-sourcing architecture (logging consolidation feature)
 *
 * Key changes from old implementation:
 * - No folder scanning - receives events from EventStreamService
 * - In-memory event correlation for recommendations
 * - Filters by last event timestamp, not session start
 */

import type {
  LogEvent,
  RecommendationEvent,
  FollowThroughEvent,
  SessionStartEvent,
  SessionEndEvent,
  AgentInvocationEvent,
  SkillInvocationEvent,
  TokensEvent,
  AgentEndEvent,
  AgentCompletionEvent,
  McpToolCallEvent,
  WorkflowStartEvent,
  WorkflowStageEvent,
  WorkflowTriggerEvent,
  WorkflowCompleteEvent,
  WorkflowResumedEvent,
  LogFilterOptions,
  PaginationOptions,
  QueryResult,
  RecommendationWithStatus,
  RecommendationStatus,
  SessionSummary,
  SessionDetail,
  LogAggregatorStats,
  LogEntry,
  StandardLogEntry,
  AgentStats24h,
  AgentMetrics,
  McpToolMetric,
} from "./types/log-entry.js";

import {
  isAgentEndEvent,
  isAgentStartEvent,
  isAgentCompletionEvent,
  isTokensEvent,
  isSkillInvocationEvent,
  isMcpToolCallEvent,
  isAgentInvocationEvent,
} from "./types/log-entry.js";

// Time constants
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const PERCENTAGE_MULTIPLIER = 100;
const TOP_ENTRIES_LIMIT = 10;
const SESSION_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - session is active if last event within this window

/**
 * Internal session data structure
 */
interface SessionData {
  sessionId: string;
  projectPath?: string;
  projectName?: string;
  pid?: number;
  startTime?: Date;
  endTime?: Date;
  endReason?: "timeout" | "process_exit" | "explicit";
  events: LogEvent[];
  lastEventTime: Date;
}

/**
 * Log Aggregator using event-sourcing pattern
 */
export class LogAggregatorService {
  // Memory management constants
  private static readonly MAX_SESSIONS = 200;
  private static readonly SESSION_RETAIN_MS = 48 * 60 * 60 * 1000; // 48 hours
  private static readonly PRUNE_CHECK_INTERVAL = 100; // Check every N events
  private static readonly MAX_AGENT_ARRAY_ENTRIES = 500; // Max entries per agent in tracking arrays

  // Primary storage: events indexed by session
  private sessions: Map<string, SessionData> = new Map();

  // Secondary indexes for fast lookups
  private recommendations: Map<string, RecommendationEvent> = new Map();
  private followThroughs: Map<string, FollowThroughEvent> = new Map();

  // Counters for stats
  private agentCounts: Map<string, number> = new Map();
  private skillCounts: Map<string, number> = new Map();
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private eventCounter: number = 0;

  // Agent stats tracking (for getAgentStats24h)
  private agentDurations: Map<string, number[]> = new Map(); // Agent name -> durations in ms
  private agentTokens: Map<string, number[]> = new Map(); // Agent name -> token counts
  private agentSkills: Map<string, Set<string>> = new Map(); // Agent name -> skills used
  private mcpToolCalls: Map<string, number> = new Map(); // "server:tool" -> count
  private agentInvocationCounts: Map<string, number> = new Map(); // Agent name -> invocation count (with timestamps)
  private agentInvocationTimestamps: Map<string, number[]> = new Map(); // Agent name -> timestamps (for 24h filtering)

  /**
   * Process an incoming event from EventStreamService
   */
  processEvent(event: LogEvent): void {
    // Periodically prune old sessions to prevent unbounded memory growth
    this.eventCounter++;
    if (this.eventCounter % LogAggregatorService.PRUNE_CHECK_INTERVAL === 0) {
      this.pruneOldSessions();
    }

    const sessionId = event.session;
    const eventTime = new Date(event.ts);

    // Get or create session data
    let sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      sessionData = {
        sessionId,
        events: [],
        lastEventTime: eventTime,
      };
      this.sessions.set(sessionId, sessionData);
    }

    // Add event to session
    sessionData.events.push(event);

    // Update last event time
    if (eventTime > sessionData.lastEventTime) {
      sessionData.lastEventTime = eventTime;
    }

    // Process by event type
    switch (event.type) {
    case "session_start": {
      this.processSessionStart(sessionData, event as SessionStartEvent);
      break;
    }

    case "session_end": {
      this.processSessionEnd(sessionData, event as SessionEndEvent);
      break;
    }

    case "recommendation": {
      this.processRecommendation(event as RecommendationEvent);
      break;
    }

    case "follow_through": {
      this.processFollowThrough(event as FollowThroughEvent);
      break;
    }

    case "agent_invocation": {
      this.processAgentInvocation(event as AgentInvocationEvent);
      break;
    }

    case "skill_invocation": {
      this.processSkillInvocation(event as SkillInvocationEvent);
      break;
    }

    case "tokens": {
      this.processTokens(event as TokensEvent);
      break;
    }

    case "agent_end": {
      this.processAgentEnd(event as AgentEndEvent, sessionData);
      break;
    }

    case "mcp_tool_call": {
      this.processMcpToolCall(event as McpToolCallEvent);
      break;
    }

    case "agent_completion": {
      this.processAgentCompletion(event as AgentCompletionEvent);
      break;
    }

      // agent_start, compliance - just stored, no special indexing
    }
  }

  private processSessionStart(
    session: SessionData,
    event: SessionStartEvent
  ): void {
    session.projectPath = event.projectPath;
    session.projectName = event.projectName;
    session.pid = event.pid;
    session.startTime = new Date(event.ts);
  }

  private processSessionEnd(session: SessionData, event: SessionEndEvent): void {
    session.endTime = new Date(event.ts);
    session.endReason = event.endReason;
  }

  private processRecommendation(event: RecommendationEvent): void {
    this.recommendations.set(event.id, event);

    // Update counts
    if (event.agent) {
      const count = this.agentCounts.get(event.agent) ?? 0;
      this.agentCounts.set(event.agent, count + 1);
    }

    if (event.skills) {
      for (const skill of event.skills) {
        const count = this.skillCounts.get(skill) ?? 0;
        this.skillCounts.set(skill, count + 1);
      }
    }
  }

  private processFollowThrough(event: FollowThroughEvent): void {
    this.followThroughs.set(event.recommendationId, event);
  }

  private processAgentInvocation(event: AgentInvocationEvent): void {
    // Agent counts already handled by recommendation
    // This event provides toolUseId correlation

    // Track invocation counts and timestamps for getAgentStats24h
    const agentName = event.agent;
    const timestamp = new Date(event.ts).getTime();

    // Update invocation count
    const currentCount = this.agentInvocationCounts.get(agentName) ?? 0;
    this.agentInvocationCounts.set(agentName, currentCount + 1);

    // Track timestamp for 24h filtering (capped to prevent unbounded growth)
    const timestamps = this.agentInvocationTimestamps.get(agentName) ?? [];
    timestamps.push(timestamp);
    if (timestamps.length > LogAggregatorService.MAX_AGENT_ARRAY_ENTRIES) {
      timestamps.splice(0, timestamps.length - LogAggregatorService.MAX_AGENT_ARRAY_ENTRIES);
    }
    this.agentInvocationTimestamps.set(agentName, timestamps);
  }

  private processSkillInvocation(event: SkillInvocationEvent): void {
    // Track skill invocations for compliance monitoring

    // Track skills per agent for getAgentStats24h
    const agentContext = event.agentContext ?? "main";
    const skillName = event.skill;

    // Get or create skills set for this agent
    let skillsSet = this.agentSkills.get(agentContext);
    if (!skillsSet) {
      skillsSet = new Set();
      this.agentSkills.set(agentContext, skillsSet);
    }
    skillsSet.add(skillName);
  }

  private processTokens(event: TokensEvent): void {
    // Include cache tokens in totals - these are where most API tokens are
    const cacheTokens = (event.cacheCreation ?? 0) + (event.cacheRead ?? 0);
    this.totalInputTokens += event.input + cacheTokens;
    this.totalOutputTokens += event.output;

    // Note: TokensEvent may have agentContext field for agent attribution
    // Token attribution is handled in getAgentStats24h
  }

  /**
   * Process agent_end event - track completion times per agent
   */
  private processAgentEnd(event: AgentEndEvent, sessionData: SessionData): void {
    // Find the corresponding agent_start event to get the agent type
    const agentStartEvent = sessionData.events.find(
      (e) => e.type === "agent_start" && (e as { agentPid?: number }).agentPid === event.agentPid
    ) as { agentType?: string; ts: string } | undefined;

    if (agentStartEvent && agentStartEvent.agentType) {
      const agentName = agentStartEvent.agentType;

      // Track duration if available (capped to prevent unbounded growth)
      if (event.duration !== undefined && event.duration > 0) {
        const durations = this.agentDurations.get(agentName) ?? [];
        durations.push(event.duration);
        if (durations.length > LogAggregatorService.MAX_AGENT_ARRAY_ENTRIES) {
          durations.splice(0, durations.length - LogAggregatorService.MAX_AGENT_ARRAY_ENTRIES);
        }
        this.agentDurations.set(agentName, durations);
      }
    }
  }

  /**
   * Process mcp_tool_call event - track MCP tool usage
   */
  private processMcpToolCall(event: McpToolCallEvent): void {
    const key = `${event.mcpServer}:${event.mcpTool}`;
    const currentCount = this.mcpToolCalls.get(key) ?? 0;
    this.mcpToolCalls.set(key, currentCount + 1);
  }

  /**
   * Process agent_completion event - track tokens and duration per agent
   * This event comes from AgentCompletionStream with full agent context
   */
  private processAgentCompletion(event: AgentCompletionEvent): void {
    const agentName = event.agentType;

    // Track duration (capped to prevent unbounded growth)
    if (event.durationMs !== undefined && event.durationMs > 0) {
      const durations = this.agentDurations.get(agentName) ?? [];
      durations.push(event.durationMs);
      if (durations.length > LogAggregatorService.MAX_AGENT_ARRAY_ENTRIES) {
        durations.splice(0, durations.length - LogAggregatorService.MAX_AGENT_ARRAY_ENTRIES);
      }
      this.agentDurations.set(agentName, durations);
    }

    // Track tokens (aggregate with total counters)
    if (event.inputTokens !== undefined) {
      this.totalInputTokens += event.inputTokens;
    }
    if (event.outputTokens !== undefined) {
      this.totalOutputTokens += event.outputTokens;
    }
  }

  /**
   * Prune old sessions to prevent unbounded memory growth.
   * Removes sessions older than SESSION_RETAIN_MS or when MAX_SESSIONS exceeded.
   */
  private pruneOldSessions(): void {
    const now = Date.now();
    const cutoff = now - LogAggregatorService.SESSION_RETAIN_MS;

    // First pass: remove sessions older than retention period
    for (const [sessionId, data] of this.sessions) {
      if (data.lastEventTime.getTime() < cutoff) {
        this.removeSession(sessionId);
      }
    }

    // Second pass: if still over limit, remove oldest sessions
    if (this.sessions.size > LogAggregatorService.MAX_SESSIONS) {
      const sortedSessions = [...this.sessions.entries()]
        .sort((a, b) => a[1].lastEventTime.getTime() - b[1].lastEventTime.getTime());

      const toRemove = sortedSessions.slice(0, this.sessions.size - LogAggregatorService.MAX_SESSIONS);
      for (const [sessionId] of toRemove) {
        this.removeSession(sessionId);
      }
    }
  }

  /**
   * Remove a session and clean up related indexes
   */
  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clean up recommendations and follow-throughs for this session
    for (const event of session.events) {
      if (event.type === "recommendation") {
        const recId = (event as RecommendationEvent).id;
        this.recommendations.delete(recId);
        this.followThroughs.delete(recId);
      }
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get recommendation with derived follow-through status
   */
  getRecommendationWithStatus(
    recId: string
  ): RecommendationWithStatus | undefined {
    const rec = this.recommendations.get(recId);
    if (!rec) return undefined;

    const followThrough = this.followThroughs.get(recId);

    let status: RecommendationStatus = "pending";
    if (followThrough) {
      if (followThrough.expired) {
        status = "expired";
      } else if (followThrough.followed) {
        status = "followed";
      } else {
        status = "ignored";
      }
    }

    return {
      ...rec,
      status,
      invokedType: followThrough?.invokedType,
      invokedName: followThrough?.invokedName,
      followThroughTimestamp: followThrough?.ts,
    };
  }

  /**
   * Get all recommendations with status
   */
  getAllRecommendations(): RecommendationWithStatus[] {
    const results: RecommendationWithStatus[] = [];

    for (const recId of this.recommendations.keys()) {
      const recWithStatus = this.getRecommendationWithStatus(recId);
      if (recWithStatus) {
        results.push(recWithStatus);
      }
    }

    return results;
  }

  /**
   * Get sessions active within the last 24 hours.
   * IMPORTANT: Uses the timestamp of the LAST event in each session, not the session start time.
   */
  getRecentSessions(): SessionSummary[] {
    const cutoffTimestamp = Date.now() - TWENTY_FOUR_HOURS_MS;

    return [...this.sessions.values()]
      .filter((session) => session.lastEventTime.getTime() > cutoffTimestamp)
      .map((session) => this.summarizeSession(session))
      .sort((a, b) => b.lastEventTime.getTime() - a.lastEventTime.getTime());
  }

  /**
   * Get detailed session information
   */
  getSessionDetail(sessionId: string): SessionDetail | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const summary = this.summarizeSession(session);

    // Get recommendations for this session
    const recommendations = this.getAllRecommendations().filter(
      (rec) => rec.session === sessionId
    );

    return {
      ...summary,
      events: session.events,
      recommendations,
    };
  }

  private summarizeSession(session: SessionData): SessionSummary {
    // Count recommendations and their statuses
    let recommendationCount = 0;
    let followedCount = 0;
    let ignoredCount = 0;
    let expiredCount = 0;

    const agentInvocations: SessionSummary["agentInvocations"] = [];

    for (const event of session.events) {
      if (event.type === "recommendation") {
        recommendationCount++;
        const status = this.getRecommendationWithStatus(
          (event as RecommendationEvent).id
        );
        if (status) {
          switch (status.status) {
          case "followed": {
            followedCount++;
            break;
          }
          case "ignored": {
            ignoredCount++;
            break;
          }
          case "expired": {
            expiredCount++;
            break;
          }
            // No default needed - pending status doesn't increment counters
          }
        }
      }

      if (event.type === "agent_invocation") {
        const inv = event as AgentInvocationEvent;
        agentInvocations.push({
          agent: inv.agent,
          toolUseId: inv.toolUseId,
          startTime: new Date(inv.ts),
          expectedSkills: inv.expectedSkills ?? [],
          usedSkills: [], // Filled below
        });
      }
    }

    // Calculate used skills per agent
    for (const inv of agentInvocations) {
      const usedSkills = session.events
        .filter(
          (e) =>
            e.type === "skill_invocation" &&
            (e as SkillInvocationEvent).agentContext === inv.agent
        )
        .map((e) => (e as SkillInvocationEvent).skill);
      inv.usedSkills = [...new Set(usedSkills)];
    }

    // Calculate token totals for this session
    let sessionInputTokens = 0;
    let sessionOutputTokens = 0;
    for (const event of session.events) {
      if (event.type === "tokens") {
        const tokensEvent = event as TokensEvent;
        // Include cache tokens - these are where most tokens are
        const cacheTokens = (tokensEvent.cacheCreation ?? 0) + (tokensEvent.cacheRead ?? 0);
        sessionInputTokens += tokensEvent.input + cacheTokens;
        sessionOutputTokens += tokensEvent.output;
      }
    }

    // Activity-based session detection:
    // A session is active if the last event was within the threshold window (5 minutes)
    // This replaces the previous approach of relying on session_end events,
    // which was broken because hooks are ephemeral processes that exit after each tool use.
    const now = Date.now();
    const timeSinceLastEvent = now - session.lastEventTime.getTime();
    const isActiveByActivity = timeSinceLastEvent < SESSION_ACTIVE_THRESHOLD_MS;

    return {
      sessionId: session.sessionId,
      projectPath: session.projectPath ?? "",
      projectName: session.projectName ?? "",
      pid: session.pid ?? 0,
      startTime: session.startTime ?? session.lastEventTime,
      endTime: session.endTime,
      endReason: session.endReason,
      lastEventTime: session.lastEventTime,
      isActive: isActiveByActivity,
      eventCount: session.events.length,
      recommendationCount,
      followedCount,
      ignoredCount,
      expiredCount,
      agentInvocations,
      totalInputTokens: sessionInputTokens,
      totalOutputTokens: sessionOutputTokens,
    };
  }

  /**
   * Query logs with filtering and pagination
   * Returns LogEntry format for backward compatibility
   */
  queryLogs(
    filters: LogFilterOptions,
    pagination: PaginationOptions
  ): Promise<QueryResult<LogEntry>> {
    // Get all recommendations matching filters
    let results = this.getAllRecommendations();

    // Apply type filter
    if (filters.type) {
      results = results.filter((rec) =>
        filters.type === "agent"
          ? rec.agent !== undefined
          : rec.skills !== undefined
      );
    }

    // Apply followed filter
    if (filters.followed !== undefined) {
      results = results.filter((rec) =>
        filters.followed
          ? rec.status === "followed"
          : rec.status !== "followed"
      );
    }

    // Apply project filter (by session projectPath)
    if (filters.project) {
      const matchingSessions = new Set<string>();
      for (const session of this.sessions.values()) {
        if (
          session.projectPath?.includes(filters.project) ||
          session.projectName?.includes(filters.project)
        ) {
          matchingSessions.add(session.sessionId);
        }
      }
      results = results.filter((rec) => matchingSessions.has(rec.session));
    }

    // Apply time range filter
    if (filters.timeRange) {
      const startMs = filters.timeRange.start.getTime();
      const endMs = filters.timeRange.end.getTime();
      results = results.filter((rec) => {
        const ts = new Date(rec.ts).getTime();
        return ts >= startMs && ts <= endMs;
      });
    }

    // Sort by timestamp ascending (chronological order - oldest first)
    results.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    // Apply pagination
    const total = results.length;
    const paged = results.slice(
      pagination.offset,
      pagination.offset + pagination.limit
    );

    // Convert to LogEntry format
    const entries: LogEntry[] = paged.map((rec) => ({
      timestamp: rec.ts,
      project: this.sessions.get(rec.session)?.projectName ?? rec.session,
      type: rec.agent ? "agent" : "skill",
      agent: rec.agent,
      skill: rec.skills?.[0],
      confidence: rec.confidence,
      followed: rec.status === "followed",
      tool_use_id: undefined,
      metadata: {
        status: rec.status,
        agentContext: rec.agentContext,
      },
    }));

    const result: QueryResult<LogEntry> = {
      entries,
      total,
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore: pagination.offset + pagination.limit < total,
    };
    return Promise.resolve(result);
  }

  /**
   * Query ALL events (invocations, MCP calls, workflow events)
   * This method returns all event types from session.events.
   * Used by /api/logs to show agent/skill invocations and MCP tool calls.
   */
  queryAllEvents(
    filters: LogFilterOptions,
    pagination: PaginationOptions
  ): Promise<QueryResult<StandardLogEntry>> {
    // Collect all events from all sessions
    let allEvents: LogEvent[] = [];

    for (const session of this.sessions.values()) {
      for (const event of session.events) {
        // Include the project name in the event for later use
        (event as LogEvent & { _projectName?: string })._projectName = session.projectName;
        (event as LogEvent & { _projectPath?: string })._projectPath = session.projectPath;
        allEvents.push(event);
      }
    }

    // Filter by event types if specified
    if (filters.eventTypes && filters.eventTypes.length > 0) {
      const allowedTypes = new Set(filters.eventTypes);
      allEvents = allEvents.filter((event) => allowedTypes.has(event.type));
    } else {
      // Default: only show user-relevant event types (not session_start, tokens, etc.)
      const defaultTypes = new Set([
        "agent_invocation",
        "skill_invocation",
        "mcp_tool_call",
        "agent_completion",
        "workflow_start",
        "workflow_stage",
        "workflow_trigger",
        "workflow_complete",
        "workflow_resumed",
      ]);
      allEvents = allEvents.filter((event) => defaultTypes.has(event.type));
    }

    // Apply project filter
    if (filters.project) {
      allEvents = allEvents.filter((event) => {
        const projName = (event as LogEvent & { _projectName?: string })._projectName;
        const projPath = (event as LogEvent & { _projectPath?: string })._projectPath;
        return (
          projName?.includes(filters.project!) ||
          projPath?.includes(filters.project!)
        );
      });
    }

    // Apply time range filter
    if (filters.timeRange) {
      const startMs = filters.timeRange.start.getTime();
      const endMs = filters.timeRange.end.getTime();
      allEvents = allEvents.filter((event) => {
        const ts = new Date(event.ts).getTime();
        return ts >= startMs && ts <= endMs;
      });
    }

    // Sort by timestamp ascending (chronological order - oldest first)
    allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    // Apply pagination - take NEWEST events from the end of the chronological array
    // This shows most recent activity in the dashboard while preserving chronological order
    const total = allEvents.length;
    const startIdx = Math.max(0, total - pagination.limit - pagination.offset);
    const endIdx = Math.max(0, total - pagination.offset);
    const paged = allEvents.slice(startIdx, endIdx);

    // Convert to StandardLogEntry format, preserving original event types
    const entries: StandardLogEntry[] = paged.map((event) => {
      const projectName = (event as LogEvent & { _projectName?: string })._projectName ?? event.session;
      const projectPath = (event as LogEvent & { _projectPath?: string })._projectPath ?? "";

      // Base entry
      const baseEntry: Partial<StandardLogEntry> = {
        timestamp: event.ts,
        projectName,
        projectPath,
        sessionId: event.session,
        sessionNumber: 0, // Not tracked per-event
      };

      // Map event type to StandardLogEntry type and populate fields
      switch (event.type) {
      case "agent_invocation": {
        const agentEvent = event as AgentInvocationEvent;
        return {
          ...baseEntry,
          type: "agent_invocation" as const,
          agent: agentEvent.agent,
          expectedSkills: agentEvent.expectedSkills,
          message: `Agent invoked: ${agentEvent.agent}`,
          recommendationId: agentEvent.recommendationId,
        } as StandardLogEntry;
      }

      case "skill_invocation": {
        const skillEvent = event as SkillInvocationEvent;
        return {
          ...baseEntry,
          type: "skill_invocation" as const,
          skill: skillEvent.skill,
          agentContext: skillEvent.agentContext,
          message: skillEvent.agentContext
            ? `Skill invoked in ${skillEvent.agentContext}: ${skillEvent.skill}`
            : `Skill invoked: ${skillEvent.skill}`,
        } as StandardLogEntry;
      }

      case "mcp_tool_call": {
        const mcpEvent = event as McpToolCallEvent;
        return {
          ...baseEntry,
          type: "mcp_tool_call" as const,
          mcpServer: mcpEvent.mcpServer,
          mcpTool: mcpEvent.mcpTool,
          agentContext: mcpEvent.agentContext,
          message: `MCP tool: ${mcpEvent.mcpServer}/${mcpEvent.mcpTool}`,
        } as StandardLogEntry;
      }

      case "agent_completion": {
        const compEvent = event as AgentCompletionEvent;
        return {
          ...baseEntry,
          type: "agent_completion" as const,
          agent: compEvent.agentType,
          totalTokens: compEvent.totalTokens,
          totalDurationMs: compEvent.durationMs,
          message: `Agent completed: ${compEvent.agentType}`,
        } as StandardLogEntry;
      }

      case "workflow_start": {
        const wsEvent = event as WorkflowStartEvent;
        return {
          ...baseEntry,
          type: "workflow_start" as const,
          message: `Workflow started: ${wsEvent.workflowName}`,
        } as StandardLogEntry;
      }

      case "workflow_stage": {
        const wstEvent = event as WorkflowStageEvent;
        return {
          ...baseEntry,
          type: "workflow_stage" as const,
          agent: wstEvent.agentType,
          message: `${wstEvent.stageDescription}: ${wstEvent.action}`,
        } as StandardLogEntry;
      }

      case "workflow_trigger": {
        const wtEvent = event as WorkflowTriggerEvent;
        return {
          ...baseEntry,
          type: "workflow_trigger" as const,
          agent: wtEvent.nextAgent,
          message: `Workflow trigger: ${wtEvent.completedAgent} → ${wtEvent.nextAgent}`,
        } as StandardLogEntry;
      }

      case "workflow_complete": {
        const wcEvent = event as WorkflowCompleteEvent;
        return {
          ...baseEntry,
          type: "workflow_complete" as const,
          message: `Workflow complete: task-${wcEvent.taskId}`,
        } as StandardLogEntry;
      }

      case "workflow_resumed": {
        const wrEvent = event as WorkflowResumedEvent;
        const staleInfo = wrEvent.staleAgentCount > 0 ? ` (${wrEvent.staleAgentCount} stale agents)` : "";
        return {
          ...baseEntry,
          type: "workflow_resumed" as const,
          message: `Workflow resumed: "${wrEvent.workflowName}" from phase ${wrEvent.currentPhase}${staleInfo}`,
        } as StandardLogEntry;
      }

      default: {
        // Fallback for any unhandled event type
        return {
          ...baseEntry,
          type: "agent_invocation" as const,
          message: `Event: ${event.type}`,
        } as StandardLogEntry;
      }
      }
    });

    const result: QueryResult<StandardLogEntry> = {
      entries,
      total,
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore: pagination.offset + pagination.limit < total,
    };
    return Promise.resolve(result);
  }

  /**
   * Get aggregated statistics
   */
  getStats(): Promise<LogAggregatorStats> {
    let followedCount = 0;
    let ignoredCount = 0;
    let expiredCount = 0;

    for (const recId of this.recommendations.keys()) {
      const status = this.getRecommendationWithStatus(recId);
      if (status) {
        switch (status.status) {
        case "followed": {
          followedCount++;
          break;
        }
        case "ignored": {
          ignoredCount++;
          break;
        }
        case "expired": { {
          expiredCount++;
        // No default
        }
        break;
        }
        }
      }
    }

    const totalDecisions = this.recommendations.size;
    const recentSessions = this.getRecentSessions();

    // Get top agents
    const agentCounts = [...this.agentCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_ENTRIES_LIMIT);

    // Get top skills
    const skillCounts = [...this.skillCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_ENTRIES_LIMIT);

    const stats: LogAggregatorStats = {
      totalSessions: this.sessions.size,
      activeSessions: recentSessions.filter((s) => s.isActive).length,
      totalDecisions,
      followedCount,
      ignoredCount,
      expiredCount,
      agentCounts,
      skillCounts,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
    };
    return Promise.resolve(stats);
  }

  /**
   * Calculate follow rate percentage
   * Static method preserved for backward compatibility
   */
  static calculateFollowRate(
    followedCount: number,
    totalDecisions: number
  ): number {
    if (totalDecisions === 0) {
      return 0;
    }
    return (followedCount / totalDecisions) * PERCENTAGE_MULTIPLIER;
  }

  /**
   * Get agent statistics for the last 24 hours
   * Aggregates per-agent metrics including invocations, completion times, tokens, and skills
   */
  getAgentStats24h(): AgentStats24h {
    const now = Date.now();
    const cutoff = now - TWENTY_FOUR_HOURS_MS;

    // Build per-agent metrics by scanning events in last 24h
    const agentMetricsMap = new Map<string, {
      invocationCount: number;
      durations: number[];
      totalTokens: number;
      tokenEvents: number;
      skillsUsed: Set<string>;
    }>();

    // Helper to get or create agent entry
    const getOrCreateAgent = (name: string) => {
      if (!agentMetricsMap.has(name)) {
        agentMetricsMap.set(name, {
          invocationCount: 0,
          durations: [],
          totalTokens: 0,
          tokenEvents: 0,
          skillsUsed: new Set(),
        });
      }
      return agentMetricsMap.get(name)!;
    };

    // Track MCP tools in last 24h
    const mcpToolsMap = new Map<string, number>();

    // Track skill counts in last 24h for topSkills
    const skillCountsMap = new Map<string, number>();

    // Process all sessions for events in last 24 hours
    for (const [, sessionData] of this.sessions) {
      // Track current agent context for token attribution
      let currentAgentContext: string | null = null;

      for (const event of sessionData.events) {
        const eventTime = new Date(event.ts).getTime();
        if (eventTime < cutoff) continue;

        if (isAgentInvocationEvent(event)) {
          const entry = getOrCreateAgent(event.agent);
          entry.invocationCount++;
          currentAgentContext = event.agent;
        }

        // Also track agent context from agent_start events
        if (isAgentStartEvent(event)) {
          currentAgentContext = event.agentType;
        }

        if (isAgentEndEvent(event)) {
          // Find matching agent_start to get agent type
          const startEvent = sessionData.events.find(
            (e) => e.type === "agent_start" &&
              (e as { agentPid?: number }).agentPid === event.agentPid
          ) as { agentType?: string } | undefined;

          if (startEvent?.agentType && event.duration !== undefined && event.duration > 0) {
            const entry = getOrCreateAgent(startEvent.agentType);
            entry.durations.push(event.duration);
          }
        }

        // Attribute tokens to agent context if available
        // Use event's agentContext if present, otherwise fall back to last known context
        if (isTokensEvent(event)) {
          const agentContext = event.agentContext ?? currentAgentContext;
          if (agentContext) {
            const entry = getOrCreateAgent(agentContext);
            // Include cache tokens - these are where most tokens are
            const cacheTokens = (event.cacheCreation ?? 0) + (event.cacheRead ?? 0);
            entry.totalTokens += event.input + event.output + cacheTokens;
            entry.tokenEvents++;
          }
        }

        if (isSkillInvocationEvent(event)) {
          const agentContext = event.agentContext ?? "main";
          const entry = getOrCreateAgent(agentContext);
          entry.skillsUsed.add(event.skill);

          // Track skill counts for topSkills
          const currentSkillCount = skillCountsMap.get(event.skill) ?? 0;
          skillCountsMap.set(event.skill, currentSkillCount + 1);
        }

        if (isMcpToolCallEvent(event)) {
          const key = `${event.mcpServer}:${event.mcpTool}`;
          const currentCount = mcpToolsMap.get(key) ?? 0;
          mcpToolsMap.set(key, currentCount + 1);
        }

        // Process agent_completion events - has tokens and duration with agent type
        if (isAgentCompletionEvent(event)) {
          const entry = getOrCreateAgent(event.agentType);

          // Track duration
          if (event.durationMs !== undefined && event.durationMs > 0) {
            entry.durations.push(event.durationMs);
          }

          // Track tokens - prefer totalTokens (includes cached tokens) over sum of input/output
          // The usage object's input_tokens only counts non-cached tokens for one message,
          // while totalTokens includes all tokens (cached reads + cache creation + output)
          const tokens = event.totalTokens ?? ((event.inputTokens ?? 0) + (event.outputTokens ?? 0));
          if (tokens > 0) {
            entry.totalTokens += tokens;
            entry.tokenEvents++;
          }
        }
      }
    }

    // Build AgentMetrics array
    const agents: AgentMetrics[] = [];
    for (const [name, data] of agentMetricsMap) {
      // Calculate completion time stats
      let completionTime = { avg: 0, min: 0, max: 0 };
      if (data.durations.length > 0) {
        const sorted = [...data.durations].sort((a, b) => a - b);
        const sum = sorted.reduce((acc, val) => acc + val, 0);
        completionTime = {
          avg: Math.round(sum / sorted.length),
          min: sorted[0],
          max: sorted[sorted.length - 1],
        };
      }

      // Calculate token stats
      const tokenTotal = data.totalTokens;
      const tokenAvg = data.tokenEvents > 0 ? Math.round(tokenTotal / data.tokenEvents) : 0;

      agents.push({
        name,
        invocationCount: data.invocationCount,
        completionTime,
        tokens: {
          total: tokenTotal,
          avg: tokenAvg,
        },
        skillsUsed: [...data.skillsUsed].sort(),
      });
    }

    // Sort by invocation count descending
    agents.sort((a, b) => b.invocationCount - a.invocationCount);

    // Build MCP tools array
    const mcpTools: McpToolMetric[] = [];
    for (const [key, count] of mcpToolsMap) {
      const [server, tool] = key.split(":");
      mcpTools.push({ server, tool, count });
    }
    mcpTools.sort((a, b) => b.count - a.count);

    // Build top skills array
    const topSkills = [...skillCountsMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_ENTRIES_LIMIT);

    return {
      timeRangeHours: 24,
      generatedAt: new Date().toISOString(),
      agents,
      mcpTools,
      topSkills,
    };
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.sessions.clear();
    this.recommendations.clear();
    this.followThroughs.clear();
    this.agentCounts.clear();
    this.skillCounts.clear();
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    // Clear agent stats tracking
    this.agentDurations.clear();
    this.agentTokens.clear();
    this.agentSkills.clear();
    this.mcpToolCalls.clear();
    this.agentInvocationCounts.clear();
    this.agentInvocationTimestamps.clear();
  }

  /**
   * Get count of sessions (useful for testing)
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get count of recommendations (useful for testing)
   */
  getRecommendationCount(): number {
    return this.recommendations.size;
  }
}

// Export singleton factory for backward compatibility
let aggregatorInstance: LogAggregatorService | null = null;

export function getLogAggregator(): LogAggregatorService {
  if (!aggregatorInstance) {
    aggregatorInstance = new LogAggregatorService();
  }
  return aggregatorInstance;
}

export function resetLogAggregator(): void {
  if (aggregatorInstance) {
    aggregatorInstance.clear();
  }
  aggregatorInstance = null;
}

// Re-export types for convenience
export {type LogFilterOptions, type PaginationOptions, type QueryResult} from "./types/log-entry.js";

// ============================================================================
// Legacy Types - Exported for backward compatibility with other modules
// ============================================================================

/**
 * Discovered project information
 */
export interface DiscoveredProject {
  /** Whether project has routing logs */
  hasRoutingLogs: boolean;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Path to log directory */
  logDirectory: string;
  /** Project display name */
  name: string;
  /** Full path to project */
  path: string;
}

/**
 * Result of a log query (legacy name alias)
 */
export type LogQueryResult = QueryResult<RoutingLogEntry>;

/**
 * Routing log entry from .claude/logs/routing
 * Extended to support multi-routing recommendations and follow-through tracking
 */
export interface RoutingLogEntry {
  /** Agent name (when type is agent) */
  agent?: string;
  /** Confidence score 0-1 */
  confidence?: number;
  /** The routing decision made */
  decision: string;
  /** Whether user followed the recommendation (null = not yet tracked) */
  followed: boolean | null;
  /** What was actually invoked after recommendation */
  invoked?: {
    /** Agent/skill name that was invoked */
    name: string;
    /** Tool used: "Task" or "Skill" */
    tool: string;
  };
  /** Additional metadata from routing decision */
  metadata?: {
    /** Whether recommendation was followed */
    followed?: boolean;
    /** Agent/skill name that was invoked */
    invokedName?: string;
    /** Tool used */
    invokedTool?: string;
    /** Unique ID for correlating recommendations to invocations */
    recommendationId?: string;
    /** Number of skill recommendations */
    skillCount?: number;
    /** All skill recommendations */
    skills?: { confidence: number; name: string }[];
    /** Comma-separated list of top skills */
    topSkills?: string;
    /** Unique identifier for tool use session (from agent isolation) */
    tool_use_id?: string;
  };
  /** Project name where log originated */
  project: string;
  /** Skill name (when type is skill) */
  skill?: string;
  /** ISO timestamp of decision */
  timestamp: string;
  /** Type of routing decision */
  type: "agent" | "skill";
}

/**
 * Aggregated statistics result
 */
export interface StatsResult {
  /** Agent usage counts */
  agentCounts: { count: number; name: string }[];
  /** Number of followed recommendations */
  followedCount: number;
  /** Skill usage counts */
  skillCounts: { count: number; name: string }[];
  /** Total routing decisions */
  totalDecisions: number;
}