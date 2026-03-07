/**
 * Unified hook for log stream WebSocket connection
 *
 * Provides real-time streaming for both activity logs AND Docker container logs.
 * Single WebSocket connection to avoid duplicate subscribers.
 *
 * Features:
 * - WebSocket connection management
 * - Entry deduplication by timestamp
 * - Reconnection with exponential backoff (1s to 30s max)
 * - Connection status states (connected/disconnected/reconnecting)
 * - Handles both log_entry and docker_log message types
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ActiveAgentEntry, ActiveAgentsPayload, AgentCompletionPayload, ApiLogPayload, DockerLogPayload, LogEntryPayload, SystemLogPayload, WSServerMessage } from "../types";

/** WebSocket URL for log streaming */
const WS_URL = `ws://${window.location.host}/ws/logs`;

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL = 30000;

/** Initial reconnection delay (1 second) */
const INITIAL_RECONNECT_DELAY = 1000;

/** Maximum reconnection delay (30 seconds) */
const MAX_RECONNECT_DELAY = 30000;

/** Maximum log entries to keep in memory */
const MAX_LOG_ENTRIES = 1000;

/** Maximum Docker log entries per container */
const MAX_DOCKER_LOG_ENTRIES = 2000;

/**
 * Valid log entry type values
 */
export type LogEntryType =
  | "agent_invocation"
  | "skill_invocation"
  | "agent_with_skill"
  | "mcp_tool_call"
  | "agent_recommendation"
  | "skill_recommendation"
  | "recommendation_followed"
  | "recommendation_ignored"
  | "agent_completion"
  | "workflow_stage"
  | "workflow_trigger"
  | "workflow_complete"
  | "workflow_resumed";

/**
 * Token usage breakdown
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Activity log entry from WebSocket
 */
export interface StreamLogEntry {
  timestamp: string;
  projectName: string;
  sessionNumber: number;
  type: LogEntryType; // Strict type - only valid log entry types
  agent?: string;
  skill?: string;
  agentContext?: string;
  decision?: string;
  confidence?: number;
  /** Whether recommendation was followed */
  followed?: boolean;
  /** Recommendation ID for correlating with follow-through events */
  recommendationId?: string;
  /** Human-readable message for dashboard display */
  message?: string;
  // MCP tool call fields (when type === "mcp_tool_call")
  mcpServer?: string;
  mcpTool?: string;
  // Agent completion fields (when type === "agent_completion")
  agentId?: string;
  agentType?: string;
  status?: string;
  totalTokens?: number;
  totalDurationMs?: number;
  totalToolUseCount?: number;
  usage?: TokenUsage;
  /** Cumulative context token usage for this session */
  sessionContextTokens?: number;
}

// /**
//  * Docker log entry from WebSocket
//  */
// export interface DockerLogEntry {
//   container: string;
//   level: "debug" | "error" | "info" | "warn";
//   message: string;
//   stream: "stderr" | "stdout";
//   timestamp: string;
// }

/**
 * API log entry from WebSocket
 */
export interface ApiLogEntry {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  error?: string;
  /** Additional context (e.g., project name for update requests) */
  detail?: string;
}

/**
 * System log entry from WebSocket
 * Used for account management logs (AccountManager, UsageMonitor, etc.)
 */
export interface SystemLogEntry {
  timestamp: string;
  source: string;
  level: "debug" | "error" | "info" | "warn";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Docker log entry from WebSocket
 */
export interface DockerLogEntry {
  timestamp: string;
  container: string;
  level: "debug" | "error" | "info" | "warn";
  message: string;
  stream: "stderr" | "stdout";
}

/**
 * Connection status type
 */
export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

/**
 * Result of useLogStream hook
 */
export interface UseLogStreamResult {
  /** Activity log entries received */
  entries: StreamLogEntry[];
  /** Docker log entries received */
  dockerEntries: DockerLogEntry[];
  /** Current connection status */
  connectionStatus: ConnectionStatus;
  /** Clear all activity entries */
  clearEntries: () => void;
  /** All Docker log entries */
  // dockerEntries: DockerLogEntry[];
  /** claude-proxy container logs */
  claudeProxyEntries: DockerLogEntry[];
  /** MCP Proxy container logs */
  mcpproxyEntries: DockerLogEntry[];
  /** Clear all Docker entries */
  clearDockerEntries: () => void;
  /** Clear entries for a specific container */
  clearContainerEntries: (container: string) => void;
  /** API log entries */
  apiEntries: ApiLogEntry[];
  /** Clear all API entries */
  clearApiEntries: () => void;
  /** System log entries (account management) */
  systemEntries: SystemLogEntry[];
  /** Clear all system entries */
  clearSystemEntries: () => void;
  /** Active agents from server (for visualization seeding) */
  activeAgents: ActiveAgentEntry[];
}

/**
 * Generate a unique deduplication key for a log entry
 * Combines timestamp, type, and identifying fields to ensure uniqueness
 * This prevents duplicates when entries have the same timestamp but different content
 */
function generateDedupeKey(entry: StreamLogEntry): string {
  const parts = [entry.timestamp, entry.type];

  // Add identifying fields based on entry type for uniqueness
  if (entry.agent) parts.push(entry.agent);
  if (entry.skill) parts.push(entry.skill);
  if (entry.agentId) parts.push(entry.agentId);
  if (entry.projectName) parts.push(entry.projectName);

  return parts.join("|");
}

/**
 * Generate a unique deduplication key for a Docker log entry
 * Combines container, timestamp, and message prefix for uniqueness
 */
function generateDockerDedupeKey(entry: DockerLogEntry): string {
  // Use first 100 chars of message to handle slight variations
  const messagePrefix = entry.message.slice(0, 100);
  return `${entry.container}|${entry.timestamp}|${messagePrefix}`;
}

/**
 * Unified hook for log stream WebSocket connection
 * Handles both activity logs and Docker container logs via single connection
 */
export function useLogStream(): UseLogStreamResult {
  const [entries, setEntries] = useState<StreamLogEntry[]>([]);
  const [dockerEntries, setDockerEntries] = useState<DockerLogEntry[]>([]);
  const [apiEntries, setApiEntries] = useState<ApiLogEntry[]>([]);
  const [systemEntries, setSystemEntries] = useState<SystemLogEntry[]>([]);
  const [activeAgents, setActiveAgents] = useState<ActiveAgentEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);
  /** Tracks seen activity log entries by composite dedup key */
  const seenTimestampsRef = useRef<Set<string>>(new Set());
  /** Tracks seen Docker log entries by composite dedup key */
  const seenDockerLogsRef = useRef<Set<string>>(new Set());

  /**
   * Fetch initial/recent entries from API on mount
   */
  useEffect(() => {
    if (initialLoadDone) return;

    const fetchInitialEntries = async (): Promise<void> => {
      try {
        // Fetch logs from last 30 minutes only to avoid loading stale/old session logs
        const response = await fetch("/api/logs?limit=50&timeRange=30m");
        if (!response.ok) return;

        const result = await response.json() as {
          data: Array<{
            timestamp: string;
            project: string;
            type: string;
            agent?: string;
            skill?: string;
            decision?: string;
            confidence?: number;
            message?: string;
          }>;
        };

        if (result.data && result.data.length > 0) {
          const initialEntries: StreamLogEntry[] = result.data.map((entry) => ({
            timestamp: entry.timestamp,
            projectName: entry.project,
            sessionNumber: 0,
            type: entry.type as LogEntryType,
            agent: entry.agent,
            skill: entry.skill,
            decision: entry.decision,
            confidence: entry.confidence,
            message: entry.message,
          }));

          // Add to seen timestamps using composite keys to prevent duplicates
          for (const entry of initialEntries) {
            const dedupeKey = generateDedupeKey(entry);
            seenTimestampsRef.current.add(dedupeKey);
          }

          // Sort by timestamp ascending (chronological order - oldest first)
          setEntries(initialEntries.sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          ));
        }
        setInitialLoadDone(true);
      } catch (err) {
        console.error("[useLogStream] Failed to fetch initial entries:", err);
        setInitialLoadDone(true);
      }
    };

    void fetchInitialEntries();
  }, [initialLoadDone]);

  /**
   * Clear all activity entries
   */
  const clearEntries = useCallback((): void => {
    setEntries([]);
    seenTimestampsRef.current.clear();
  }, []);

  /**
   * Clear all Docker entries
   */
  const clearDockerEntries = useCallback((): void => {
    setDockerEntries([]);
    seenDockerLogsRef.current.clear();
  }, []);

  /**
   * Clear entries for a specific container
   */
  const clearContainerEntries = useCallback((container: string): void => {
    setDockerEntries((prev) => prev.filter((e) => e.container !== container));
  }, []);

  /**
   * Clear all API entries
   */
  const clearApiEntries = useCallback((): void => {
    setApiEntries([]);
  }, []);

  /**
   * Clear all system entries
   */
  const clearSystemEntries = useCallback((): void => {
    setSystemEntries([]);
  }, []);

  /**
   * Send ping for heartbeat
   */
  const sendPing = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "ping" }));
    }
  }, []);

  /**
   * Start heartbeat timer
   */
  const startHeartbeat = useCallback((): void => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
    }
    heartbeatRef.current = setInterval(sendPing, HEARTBEAT_INTERVAL);
  }, [sendPing]);

  /**
   * Stop heartbeat timer
   */
  const stopHeartbeat = useCallback((): void => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /**
   * Handle incoming message - handles both log_entry and docker_log types
   */
  const handleMessage = useCallback((event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data as string) as WSServerMessage;

      // Handle subscription confirmations and pong silently
      if (message.type === "subscribed_all" || message.type === "pong") {
        return;
      }

      // Handle activity log_entry messages
      if (message.type === "log_entry" && message.payload !== undefined) {
        const payload = message.payload as LogEntryPayload;

        // Validate required fields to prevent phantom entries
        if (payload.timestamp === undefined || payload.projectName === undefined) {
          console.warn("[useLogStream] Skipping entry with missing required fields:", payload);
          return;
        }

        const entryType = payload.type as LogEntryType;

        // Handle follow-through events by updating existing recommendation entries
        // instead of creating new log lines
        if (
          (entryType === "recommendation_followed" || entryType === "recommendation_ignored") &&
          payload.recommendationId
        ) {
          setEntries((prev) => {
            // Find ALL recommendation entries with matching recommendationId
            // (agent + skills share the same recommendationId as a set)
            const matchingIndices: number[] = [];
            for (let i = 0; i < prev.length; i++) {
              const e = prev[i];
              if (
                (e.type === "agent_recommendation" || e.type === "skill_recommendation") &&
                e.recommendationId === payload.recommendationId
              ) {
                matchingIndices.push(i);
              }
            }
            if (matchingIndices.length === 0) {
              // Recommendation not found - could be from before page load, skip
              return prev;
            }
            // Update ALL matching entries with followed status
            const updated = [...prev];
            for (const idx of matchingIndices) {
              updated[idx] = {
                ...updated[idx],
                followed: payload.followed,
              };
            }
            return updated;
          });
          return;
        }

        const entry: StreamLogEntry = {
          timestamp: payload.timestamp,
          projectName: payload.projectName,
          sessionNumber: payload.sessionNumber,
          type: entryType,
          agent: payload.agent,
          skill: payload.skill,
          agentContext: payload.agentContext,
          decision: payload.decision,
          confidence: payload.confidence,
          followed: payload.followed,
          recommendationId: payload.recommendationId,
          message: payload.message,
          mcpServer: payload.mcpServer,
          mcpTool: payload.mcpTool,
          // Agent completion fields (for type === "agent_completion")
          agentId: payload.agentId,
          agentType: payload.agentType,
          status: payload.status,
          totalTokens: payload.totalTokens,
          totalDurationMs: payload.totalDurationMs,
          totalToolUseCount: payload.totalToolUseCount,
          usage: payload.usage,
          // Session context tokens
          sessionContextTokens: payload.sessionContextTokens,
        };

        // Deduplicate using composite key (timestamp + type + identifying fields)
        const dedupeKey = generateDedupeKey(entry);
        if (seenTimestampsRef.current.has(dedupeKey)) {
          return;
        }
        seenTimestampsRef.current.add(dedupeKey);

        // Limit seen timestamps set size
        if (seenTimestampsRef.current.size > MAX_LOG_ENTRIES * 2) {
          const keys = Array.from(seenTimestampsRef.current);
          seenTimestampsRef.current = new Set(keys.slice(-MAX_LOG_ENTRIES));
        }

        // Append new entries (chronological order - oldest first, newest at bottom)
        setEntries((prev) => {
          if (prev.length >= MAX_LOG_ENTRIES) {
            // At capacity: slice off oldest (at start), append new
            return [...prev.slice(1), entry];
          }
          // Under capacity: append for chronological order
          return [...prev, entry];
        });
        return;
      }

      // Handle docker_log messages
      if (message.type === "docker_log" && message.payload !== undefined) {
        const payload = message.payload as DockerLogPayload;

        const dockerEntry: DockerLogEntry = {
          container: payload.container,
          level: payload.level,
          message: payload.message,
          stream: payload.stream,
          timestamp: payload.timestamp,
        };

        // Deduplicate Docker logs using composite key
        const dockerDedupeKey = generateDockerDedupeKey(dockerEntry);
        if (seenDockerLogsRef.current.has(dockerDedupeKey)) {
          return;
        }
        seenDockerLogsRef.current.add(dockerDedupeKey);

        // Limit seen Docker logs set size
        if (seenDockerLogsRef.current.size > MAX_DOCKER_LOG_ENTRIES * 2) {
          const keys = Array.from(seenDockerLogsRef.current);
          seenDockerLogsRef.current = new Set(keys.slice(-MAX_DOCKER_LOG_ENTRIES));
        }

        // Append new entries (chronological order - oldest first, newest at bottom)
        setDockerEntries((prev) => {
          if (prev.length >= MAX_DOCKER_LOG_ENTRIES) {
            // At capacity: slice off oldest (at start), append new
            return [...prev.slice(1), dockerEntry];
          }
          // Under capacity: append for chronological order
          return [...prev, dockerEntry];
        });
        return;
      }

      // Handle api_log messages (dashboard API requests)
      if (message.type === "api_log" && message.payload !== undefined) {
        const payload = message.payload as ApiLogPayload;

        const apiEntry: ApiLogEntry = {
          timestamp: payload.timestamp,
          method: payload.method,
          path: payload.path,
          statusCode: payload.statusCode,
          responseTimeMs: payload.responseTimeMs,
          error: payload.error,
          detail: payload.detail,
        };

        // Append new entries (chronological order - oldest first, newest at bottom)
        setApiEntries((prev) => {
          if (prev.length >= MAX_LOG_ENTRIES) {
            // At capacity: slice off oldest (at start), append new
            return [...prev.slice(1), apiEntry];
          }
          // Under capacity: append for chronological order
          return [...prev, apiEntry];
        });
        return;
      }

      // Handle system_log messages (account management logs)
      if (message.type === "system_log" && message.payload !== undefined) {
        const payload = message.payload as SystemLogPayload;

        const systemEntry: SystemLogEntry = {
          timestamp: payload.timestamp,
          source: payload.source,
          level: payload.level,
          message: payload.message,
          details: payload.details,
        };

        // Append new entries (chronological order - oldest first, newest at bottom)
        setSystemEntries((prev) => {
          if (prev.length >= MAX_LOG_ENTRIES) {
            // At capacity: slice off oldest (at start), append new
            return [...prev.slice(1), systemEntry];
          }
          // Under capacity: append for chronological order
          return [...prev, systemEntry];
        });
        return;
      }

      // Handle agent_completion messages (token usage metrics)
      if (message.type === "agent_completion" && message.payload !== undefined) {
        const payload = message.payload as AgentCompletionPayload;

        const entry: StreamLogEntry = {
          timestamp: payload.timestamp,
          projectName: payload.projectName,
          sessionNumber: 0, // Session number not meaningful for agent completions
          type: "agent_completion",
          agentId: payload.agentId,
          agentType: payload.agentType,
          status: payload.status,
          totalTokens: payload.totalTokens,
          totalDurationMs: payload.totalDurationMs,
          totalToolUseCount: payload.totalToolUseCount,
          usage: payload.usage,
        };

        // Deduplicate by timestamp + agentId combo
        const dedupeKey = `${entry.timestamp}-${entry.agentId ?? ""}`;
        if (seenTimestampsRef.current.has(dedupeKey)) {
          return;
        }
        seenTimestampsRef.current.add(dedupeKey);

        // Limit seen timestamps set size
        if (seenTimestampsRef.current.size > MAX_LOG_ENTRIES * 2) {
          const timestamps = Array.from(seenTimestampsRef.current);
          seenTimestampsRef.current = new Set(timestamps.slice(-MAX_LOG_ENTRIES));
        }

        // Append new entries (chronological order - oldest first, newest at bottom)
        setEntries((prev) => {
          const newEntries = prev.length >= MAX_LOG_ENTRIES
            ? [...prev.slice(1), entry]
            : [...prev, entry];
          return newEntries;
        });
      }

      // Handle active_agents messages (in-progress agents for visualization seeding)
      if (message.type === "active_agents" && message.payload !== undefined) {
        const payload = message.payload as ActiveAgentsPayload;
        // Replace active agents with the server's current list
        // This is sent once on subscribe_all to seed the visualization
        setActiveAgents(payload.agents);
        console.log(`[useLogStream] Received ${payload.agents.length} active agents from server`);
      }
    } catch (err) {
      console.error("[useLogStream] Failed to parse message:", err);
    }
  }, []);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback((): void => {
    if (isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;
    setConnectionStatus("reconnecting");

    // Clean up existing connection
    if (wsRef.current !== null) {
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = (): void => {
      isConnectingRef.current = false;
      setConnectionStatus("connected");
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      startHeartbeat();
      // Subscribe to all sessions for dashboard-wide log feed
      ws.send(JSON.stringify({ type: "subscribe_all" }));
    };

    ws.onmessage = handleMessage;

    ws.onclose = (): void => {
      isConnectingRef.current = false;
      setConnectionStatus("disconnected");
      stopHeartbeat();

      // Schedule reconnection with exponential backoff
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = (): void => {
      console.error("[useLogStream] WebSocket connection error");
    };

    wsRef.current = ws;
  }, [handleMessage, startHeartbeat, stopHeartbeat]);

  /**
   * Initialize connection on mount
   * Note: Empty dependency array - connect once on mount, cleanup on unmount
   * Using refs to avoid dependency issues that cause flickering reconnections
   *
   * The deferred setTimeout(connect, 0) prevents React 18 strict mode from
   * creating a WebSocket that gets immediately closed during the rapid
   * mount → unmount → remount cycle, which would cause a browser warning:
   * "WebSocket is closed before the connection is established."
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      connect();
    }, 0);

    return () => {
      clearTimeout(timer);
      stopHeartbeat();
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current !== null) {
        wsRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Filter Docker entries by container - memoized
   */
  const claudeProxyEntries = useMemo(
    () => dockerEntries.filter((e) => e.container === "claude-proxy"),
    [dockerEntries]
  );
  const mcpproxyEntries = useMemo(
    () => dockerEntries.filter((e) => e.container === "mcp-proxy"),
    [dockerEntries]
  );

  return {
    entries,
    dockerEntries,
    connectionStatus,
    clearEntries,
    // dockerEntries,
    claudeProxyEntries,
    mcpproxyEntries,
    clearDockerEntries,
    clearContainerEntries,
    apiEntries,
    clearApiEntries,
    systemEntries,
    clearSystemEntries,
    activeAgents,
  };
}
