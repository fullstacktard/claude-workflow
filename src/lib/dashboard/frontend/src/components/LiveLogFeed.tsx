/**
 * LiveLogFeed Component
 * Displays real-time log feed with tabs for Activity logs and Docker container logs
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { Link } from "react-router-dom";

import { AgentStatsPanel } from "./AgentStatsPanel";
import { LogEntry, type LogEntryProps } from "./LogEntry";
import { TerminalCard } from "./TerminalCard";
import { type WorkflowEvent, type ProjectWorkflowStatus, type WorkflowStatusType } from "./WorkflowProjectGroup";
import { WorkflowStatusSection } from "./WorkflowStatusSection";
import {
  type ApiLogEntry,
  type DockerLogEntry,
  type StreamLogEntry,
  type SystemLogEntry,
  useLogStream,
} from "../hooks/useLogStream";

/**
 * Props for the LiveLogFeed component
 */
interface LiveLogFeedProps {
  /** Maximum entries to display */
  maxVisibleEntries?: number;
  /** Additional CSS classes */
  className?: string;
}

/** Tab type options */
type TabType = "activity" | "dashboard" | "claudeproxy" | "mcpproxy" | "workflow" | "stats";

/** Filter type options for activity logs */
type FilterType = "all" | "completions" | "agent_invocation" | "skill_invocation" | "agent_with_skill" | "agent_recommendation" | "skill_recommendation" | "agent_completion" | "mcp_tool_call";

/** Default maximum visible entries */
const DEFAULT_MAX_ENTRIES = 100;

/** Auto-scroll resume delay after user scroll (5 seconds) */
const AUTO_SCROLL_RESUME_DELAY = 5000;

/** Minimum time to wait before showing empty state (prevents flickering) */
const EMPTY_STATE_DELAY = 2000;

/** Distance in pixels from bottom to consider "at bottom" for auto-scroll */
const SCROLL_BOTTOM_THRESHOLD = 50;

/** Number of skeleton rows to show while loading - overflows are clipped by container */
const SKELETON_ROW_COUNT = 40;

/**
 * SkeletonLogRows Component
 * Displays pulsing placeholder rows matching actual LogEntry layout:
 * timestamp | projectName :: Session #N | type - agent
 */
function SkeletonLogRows(): JSX.Element {
  return (
    <div className="animate-pulse flex flex-col h-full overflow-hidden">
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
        <div key={i} className="font-mono text-sm py-1 px-2 border-l-2 border-transparent flex items-center gap-0">
          {/* Timestamp (e.g., "10:42:15 AM") */}
          <div className="h-3.5 w-[5.5rem] bg-gray-800/50 rounded shrink-0" />
          {/* Separator */}
          <div className="h-3.5 w-3 mx-1" />
          {/* Project name :: Session #N */}
          <div className="h-3.5 bg-gray-800/35 rounded shrink-0" style={{ width: `${80 + (i % 3) * 30}px` }} />
          <div className="h-3.5 w-5 mx-1 bg-gray-800/20 rounded" />
          <div className="h-3.5 w-16 bg-gray-800/35 rounded shrink-0" />
          {/* Separator */}
          <div className="h-3.5 w-3 mx-1" />
          {/* Type - agent/skill name */}
          <div className="h-3.5 bg-gray-800/35 rounded" style={{ width: `${60 + (i % 4) * 25}px` }} />
          {i % 3 !== 0 && (
            <>
              <div className="h-3.5 w-2 mx-1" />
              <div className="h-3.5 bg-gray-800/20 rounded" style={{ width: `${40 + (i % 5) * 15}px` }} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Generate stable React key for activity log entry
 * Must be unique across all entries without relying on array index
 */
function getActivityEntryKey(entry: StreamLogEntry): string {
  const parts = [entry.timestamp, entry.type];
  if (entry.agent) parts.push(entry.agent);
  if (entry.skill) parts.push(entry.skill);
  if (entry.agentId) parts.push(entry.agentId);
  if (entry.projectName) parts.push(entry.projectName);
  // Add session number for additional uniqueness
  parts.push(String(entry.sessionNumber));
  return parts.join("-");
}

/**
 * Generate stable React key for Docker log entry
 * Uses container, timestamp, and message prefix for uniqueness
 */
function getDockerEntryKey(entry: DockerLogEntry, prefix: string): string {
  // Use first 50 chars of message to ensure uniqueness
  const messagePrefix = entry.message.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "");
  return `${prefix}-${entry.container}-${entry.timestamp}-${messagePrefix}`;
}

/**
 * Generate stable React key for API log entry
 */
function getApiEntryKey(entry: ApiLogEntry): string {
  return `api-${entry.timestamp}-${entry.method}-${entry.path}-${entry.statusCode}`;
}

/**
 * Generate stable React key for system log entry
 */
function getSystemEntryKey(entry: SystemLogEntry): string {
  const messagePrefix = entry.message.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "");
  return `sys-${entry.timestamp}-${entry.source}-${messagePrefix}`;
}

/** Filter options configuration - left side (general filters) */
const FILTER_OPTIONS: Array<{ label: string; value: FilterType; title?: string }> = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completions" },
];

/** Filter options for the right side (agent/skill/MCP type filters) */
const RHS_FILTER_OPTIONS: Array<{ label: string; value: FilterType; title?: string }> = [
  { label: "Agent", value: "agent_invocation" },
  { label: "Skill", value: "skill_invocation" },
  { label: "Agent+Skill", value: "agent_with_skill" },
  { label: "MCP", value: "mcp_tool_call" },
];

/** Tab options */
const TAB_OPTIONS: Array<{ label: string; shortLabel?: string; value: TabType }> = [
  { label: "Activity", value: "activity" },
  { label: "Workflow", value: "workflow" },
  { label: "Stats", value: "stats" },
  { label: "Dashboard", shortLabel: "Dash", value: "dashboard" },
  { label: "Claude Proxy", shortLabel: "Claude", value: "claudeproxy" },
  { label: "MCP Proxy", shortLabel: "MCP", value: "mcpproxy" },
];

/**
 * Projects status response from API
 */
interface WorkflowProjectsStatusResponse {
  projects: ProjectWorkflowStatus[];
  summary: {
    activeCount: number;
    pausedCount: number;
    completeCount: number;
    totalCount: number;
    incompleteCount: number;
  };
}

/**
 * Workflow status from API
 */
interface WorkflowStatus {
  active: boolean;
  currentStage?: string;
  activeTasks?: number;
  recentEventsCount: number;
  lastEventTime?: string;
}

/**
 * Docker container log entry display component
 * Matches Activity tab inline format: timestamp | container :: level | message
 */
/** Base Tailwind classes for log entry rows */
const LOG_ROW_BASE = "font-mono text-sm py-1 px-2 border-l-2 border-transparent";

function DockerLogRow({ entry, containerName }: { entry: DockerLogEntry; containerName?: string }): JSX.Element {
  const levelColors: Record<string, string> = {
    error: "text-red-400",
    warn: "text-yellow-400",
    info: "text-blue-400",
    debug: "text-gray-500",
  };

  const levelColor = levelColors[entry.level] || "text-gray-400";

  return (
    <div className={LOG_ROW_BASE}>
      <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
      <span className="ml-2">
        <span className="text-cyan-400">{containerName ?? entry.container}</span>
        <span className="text-gray-600"> :: </span>
        <span className={levelColor}>{entry.level}</span>
      </span>
      <span className="ml-2 text-gray-600">|</span>
      <span className="ml-2 text-gray-300">{entry.message}</span>
    </div>
  );
}

/**
 * API log entry display component
 * Matches Activity tab inline format: timestamp | API :: method | statusCode - path - responseTime
 */
function ApiLogRow({ entry }: { entry: ApiLogEntry }): JSX.Element {
  // Color code status: 2xx green, 4xx yellow, 5xx red
  const getStatusColor = (status: number): string => {
    if (status >= 500) return "text-red-400";
    if (status >= 400) return "text-yellow-400";
    if (status >= 200 && status < 300) return "text-green-400";
    return "text-gray-300";
  };

  // Color code method
  const getMethodColor = (method: string): string => {
    switch (method.toUpperCase()) {
      case "GET": return "text-blue-400";
      case "POST": return "text-green-400";
      case "PUT": return "text-yellow-400";
      case "DELETE": return "text-red-400";
      case "PATCH": return "text-purple-400";
      default: return "text-gray-400";
    }
  };

  return (
    <div className={LOG_ROW_BASE}>
      <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
      <span className="ml-2">
        <span className="text-cyan-400">API</span>
        <span className="text-gray-600"> :: </span>
        <span className={getMethodColor(entry.method)}>{entry.method}</span>
      </span>
      <span className="ml-2 text-gray-600">|</span>
      <span className={`ml-2 ${getStatusColor(entry.statusCode)}`}>{entry.statusCode}</span>
      <span className="text-gray-600 ml-1">-</span>
      <span className="ml-1 text-gray-300">{entry.path}</span>
      <span className="text-gray-600 ml-1">-</span>
      <span className="ml-1 text-gray-500">{entry.responseTimeMs}ms</span>
      {entry.detail !== undefined && (
        <span className="ml-2 text-purple-400" title={entry.detail}>
          [{entry.detail}]
        </span>
      )}
      {entry.error !== undefined && (
        <span className="ml-2 text-red-400" title={entry.error}>
          {entry.error.length > 50 ? entry.error.slice(0, 50) + "..." : entry.error}
        </span>
      )}
    </div>
  );
}

/**
 * System log entry display component
 * Shows account management logs: timestamp | source :: level - message
 */
function SystemLogRow({ entry }: { entry: SystemLogEntry }): JSX.Element {
  // Color code level
  const getLevelColor = (level: string): string => {
    switch (level) {
      case "error": return "text-red-400";
      case "warn": return "text-yellow-400";
      case "info": return "text-cyan-400";
      case "debug": return "text-gray-500";
      default: return "text-gray-400";
    }
  };

  // Color code source service
  const getSourceColor = (source: string): string => {
    if (source.includes("AccountManager")) return "text-purple-400";
    if (source.includes("UsageMonitor")) return "text-blue-400";
    if (source.includes("CredentialSync")) return "text-green-400";
    if (source.includes("cli-credential-watcher")) return "text-orange-400";
    return "text-cyan-400";
  };

  return (
    <div className={LOG_ROW_BASE}>
      <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
      <span className="ml-2">
        <span className={getSourceColor(entry.source)}>{entry.source}</span>
        <span className="text-gray-600"> :: </span>
        <span className={getLevelColor(entry.level)}>{entry.level.toUpperCase()}</span>
      </span>
      <span className="ml-2 text-gray-600">-</span>
      <span className="ml-2 text-gray-300">{entry.message}</span>
      {entry.details !== undefined && Object.keys(entry.details).length > 0 && (
        <span className="ml-2 text-gray-500" title={JSON.stringify(entry.details, null, 2)}>
          {JSON.stringify(entry.details)}
        </span>
      )}
    </div>
  );
}

/**
 * LiveLogFeed component
 */
export function LiveLogFeed({
  maxVisibleEntries = DEFAULT_MAX_ENTRIES,
  className = "",
}: LiveLogFeedProps): JSX.Element {
  // Unified hook for activity logs AND Docker container logs (single WebSocket)
  const {
    entries,
    connectionStatus,
    clearEntries,
    claudeProxyEntries,
    mcpproxyEntries,
    clearContainerEntries,
    apiEntries,
    clearApiEntries,
    systemEntries,
    clearSystemEntries,
  } = useLogStream();

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef<boolean>(true);
  // Ref to track active tab for use in timer callbacks (avoids stale closure)
  const activeTabRef = useRef<TabType>("activity");

  const [activeTab, setActiveTab] = useState<TabType>("activity");
  const [filter, setFilter] = useState<FilterType>("all");

  // Workflow events state
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [projectsStatus, setProjectsStatus] = useState<WorkflowProjectsStatusResponse | null>(null);
  const [completingProject, setCompletingProject] = useState<string | null>(null);
  const workflowPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track auto-scroll pause state for each tab
  const [autoScrollPaused, setAutoScrollPaused] = useState<Record<TabType, boolean>>({
    activity: false,
    dashboard: false,
    claudeproxy: false,
    mcpproxy: false,
    workflow: false,
    stats: false,
  });

  // Track if we've ever received logs for each tab (prevents flickering on tab switch)
  const hasReceivedLogsRef = useRef<Record<TabType, boolean>>({
    activity: false,
    dashboard: false,
    claudeproxy: false,
    mcpproxy: false,
    workflow: false,
    stats: false,
  });

  // Track when each tab was first loaded (for delayed empty state)
  const tabLoadTimeRef = useRef<Record<TabType, number>>({
    activity: Date.now(),
    dashboard: 0,
    claudeproxy: 0,
    mcpproxy: 0,
    workflow: 0,
    stats: 0,
  });

  // Force re-render trigger for delayed empty state
  const [, forceUpdate] = useState(0);

  /**
   * Check if container is at bottom (within threshold) - for chronological ordering
   */
  const isAtBottom = useCallback((): boolean => {
    if (containerRef.current === null) {
      return true;
    }
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD;
  }, []);

  /**
   * Auto-scroll to bottom when new entries arrive (chronological order - newest at bottom)
   * Only scrolls if not paused by user
   * Uses requestAnimationFrame to ensure DOM is laid out before scrolling
   */
  useEffect(() => {
    if (autoScrollPaused[activeTab] || containerRef.current === null) {
      return;
    }
    requestAnimationFrame(() => {
      if (containerRef.current !== null) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
  }, [entries.length, apiEntries.length, systemEntries.length, claudeProxyEntries.length, mcpproxyEntries.length, activeTab, autoScrollPaused]);

  /**
   * Handle scroll events - pause auto-scroll when user scrolls up (away from bottom)
   * Uses activeTabRef to avoid stale closure issues in timer callbacks
   */
  const handleScroll = useCallback((): void => {
    const currentTab = activeTabRef.current;
    if (!isAtBottom()) {
      setAutoScrollPaused((prev) => ({ ...prev, [currentTab]: true }));

      // Clear existing resume timer
      if (scrollResumeTimerRef.current !== null) {
        clearTimeout(scrollResumeTimerRef.current);
      }

      // Set new resume timer (5 seconds)
      // Note: Uses activeTabRef.current at timer execution time to get current tab
      scrollResumeTimerRef.current = setTimeout(() => {
        // Only execute if component is still mounted
        if (!mountedRef.current) return;

        const tabAtTimeout = activeTabRef.current;
        setAutoScrollPaused((prev) => ({ ...prev, [tabAtTimeout]: false }));
        if (containerRef.current !== null) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, AUTO_SCROLL_RESUME_DELAY);
    } else {
      // User scrolled to bottom, resume auto-scroll
      setAutoScrollPaused((prev) => ({ ...prev, [currentTab]: false }));
      if (scrollResumeTimerRef.current !== null) {
        clearTimeout(scrollResumeTimerRef.current);
        scrollResumeTimerRef.current = null;
      }
    }
  }, [isAtBottom]);

  /**
   * Cleanup timers on unmount
   */
  useEffect(() => {
    // Capture refs at effect creation time to avoid stale closure in cleanup
    const scrollCheckTimer = scrollCheckTimerRef;
    const scrollResumeTimer = scrollResumeTimerRef;

    return () => {
      mountedRef.current = false;

      if (scrollCheckTimer.current !== null) {
        clearInterval(scrollCheckTimer.current);
      }
      if (scrollResumeTimer.current !== null) {
        clearTimeout(scrollResumeTimer.current);
      }
    };
  }, []);

  /**
   * Reset scroll when tab or filter changes - scroll to bottom (chronological order)
   * Also keeps activeTabRef in sync with activeTab state
   */
  useEffect(() => {
    // Keep ref in sync with state for timer callbacks
    activeTabRef.current = activeTab;

    // Clear any pending resume timer when switching tabs
    if (scrollResumeTimerRef.current !== null) {
      clearTimeout(scrollResumeTimerRef.current);
      scrollResumeTimerRef.current = null;
    }

    setAutoScrollPaused((prev) => ({ ...prev, [activeTab]: false }));
    if (containerRef.current !== null) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filter, activeTab]);

  /**
   * Track when tabs are first loaded and set up delayed empty state
   */
  useEffect(() => {
    if (tabLoadTimeRef.current[activeTab] === 0) {
      tabLoadTimeRef.current[activeTab] = Date.now();
      // Schedule re-render after delay to show empty state if still no logs
      const timer = setTimeout(() => {
        forceUpdate((n) => n + 1);
      }, EMPTY_STATE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  /**
   * Update hasReceivedLogs when entries arrive
   */
  useEffect(() => {
    if (entries.length > 0) {
      hasReceivedLogsRef.current.activity = true;
    }
  }, [entries.length]);

  useEffect(() => {
    if (claudeProxyEntries.length > 0) {
      hasReceivedLogsRef.current.claudeproxy = true;
    }
  }, [claudeProxyEntries.length]);

  useEffect(() => {
    if (mcpproxyEntries.length > 0) {
      hasReceivedLogsRef.current.mcpproxy = true;
    }
  }, [mcpproxyEntries.length]);

  useEffect(() => {
    if (apiEntries.length > 0 || systemEntries.length > 0) {
      hasReceivedLogsRef.current.dashboard = true;
    }
  }, [apiEntries.length, systemEntries.length]);

  /**
   * Fetch workflow events when workflow tab is active
   */
  useEffect(() => {
    if (activeTab !== "workflow") {
      // Clean up polling when leaving workflow tab
      if (workflowPollRef.current !== null) {
        clearInterval(workflowPollRef.current);
        workflowPollRef.current = null;
      }
      return;
    }

    const fetchWorkflowData = async (): Promise<void> => {
      try {
        // Fetch events, status, and projects-status in parallel
        const [eventsRes, statusRes, projectsRes] = await Promise.all([
          fetch("/api/workflow/events?limit=100"),
          fetch("/api/workflow/status"),
          fetch("/api/workflow/projects-status"),
        ]);

        if (eventsRes.ok) {
          const eventsData = await eventsRes.json() as { data: WorkflowEvent[] };
          // Keep chronological order (API returns oldest first)
          setWorkflowEvents(eventsData.data);
          if (eventsData.data.length > 0) {
            hasReceivedLogsRef.current.workflow = true;
          }
        }

        if (statusRes.ok) {
          const statusData = await statusRes.json() as WorkflowStatus;
          setWorkflowStatus(statusData);
        }

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json() as WorkflowProjectsStatusResponse;
          setProjectsStatus(projectsData);
        }
      } catch (err) {
        console.error("[LiveLogFeed] Failed to fetch workflow data:", err);
      }
    };

    // Initial fetch
    void fetchWorkflowData();

    // Poll every 3 seconds for updates
    workflowPollRef.current = setInterval(() => {
      void fetchWorkflowData();
    }, 3000);

    return () => {
      if (workflowPollRef.current !== null) {
        clearInterval(workflowPollRef.current);
        workflowPollRef.current = null;
      }
    };
  }, [activeTab]);

  /**
   * Update hasReceivedLogs for workflow
   */
  useEffect(() => {
    if (workflowEvents.length > 0) {
      hasReceivedLogsRef.current.workflow = true;
    }
  }, [workflowEvents.length]);

  /**
   * Filter activity entries by type
   * Sorts entries chronologically to ensure correct order regardless of how they arrived
   */
  const displayEntries = useMemo(() => {
    // Sort entries chronologically (oldest first) to ensure correct display order
    // This handles cases where WebSocket entries arrive out of order
    const sorted = [...entries].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let filtered = sorted;

    if (filter === "completions") {
      // Show only agent completions (with token metrics)
      filtered = sorted.filter((entry) => entry.type === "agent_completion");
    } else if (filter === "mcp_tool_call") {
      // Show only MCP tool calls (type is mcp_tool_call)
      filtered = sorted.filter((entry) => entry.type === "mcp_tool_call");
    } else if (filter === "agent_with_skill") {
      // Show tool/skill invocations that have an agent context (used within an agent)
      filtered = sorted.filter((entry) =>
        (entry.type === "skill_invocation" || entry.type === "mcp_tool_call") && entry.agentContext !== undefined
      );
    } else if (filter !== "all") {
      // Specific type filter
      filtered = sorted.filter((entry) => entry.type === filter);
    }

    // Limit to maxVisibleEntries - take newest entries (from end of chronological array)
    return filtered.slice(-maxVisibleEntries);
  }, [entries, filter, maxVisibleEntries]);

  /**
   * Display claude-proxy entries (from WebSocket stream) - take newest entries
   */
  const displayClaudeProxyEntries = useMemo(() => {
    return claudeProxyEntries.slice(-maxVisibleEntries);
  }, [claudeProxyEntries, maxVisibleEntries]);

  /**
   * Display mcpproxy entries (from WebSocket stream) - take newest entries
   */
  const displayMcpproxyEntries = useMemo(() => {
    return mcpproxyEntries.slice(-maxVisibleEntries);
  }, [mcpproxyEntries, maxVisibleEntries]);

  /**
   * Display combined dashboard entries (API + System logs) - sorted by timestamp, oldest first
   * (newest at bottom, matching terminal behavior)
   */
  const displayDashboardEntries = useMemo(() => {
    // Combine API and System entries with a type discriminator
    const apiWithType = apiEntries.map((e) => ({ ...e, _type: "api" as const }));
    const systemWithType = systemEntries.map((e) => ({ ...e, _type: "system" as const }));

    // Merge and sort by timestamp (oldest first - newest at bottom like a terminal)
    const combined = [...apiWithType, ...systemWithType].sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    // Take the last N entries (most recent ones)
    return combined.slice(-maxVisibleEntries);
  }, [apiEntries, systemEntries, maxVisibleEntries]);

  /**
   * Display workflow entries - chronological order (oldest first)
   */
  /**
   * Display workflow entries - take newest entries (from end of chronological array)
   * Consistent with other tabs that use slice(-maxVisibleEntries)
   */
  const displayWorkflowEvents = useMemo(() => {
    return workflowEvents.slice(-maxVisibleEntries);
  }, [workflowEvents, maxVisibleEntries]);

  /**
   * Group workflow events by session for collapsible view
   * Each workflow session gets its own group, even if multiple sessions
   * are running against the same project (e.g., two /workflow commands)
   */
  const eventsByProject = useMemo(() => {
    const grouped = new Map<string, WorkflowEvent[]>();

    // Build set of known session IDs from projects-status API
    const knownSessions = new Set<string>();
    if (projectsStatus) {
      for (const project of projectsStatus.projects) {
        if (project.sessionId) {
          knownSessions.add(project.sessionId);
        }
      }
    }

    // Group events by session ID (using sessionId as key, not project name)
    for (const event of displayWorkflowEvents) {
      const sessionId = event.session;
      if (!sessionId || !knownSessions.has(sessionId)) continue;

      if (!grouped.has(sessionId)) {
        grouped.set(sessionId, []);
      }
      grouped.get(sessionId)!.push(event);
    }
    return grouped;
  }, [displayWorkflowEvents, projectsStatus]);

  /**
   * Group projects by workflow status for sectioned display
   */
  const projectsByStatus = useMemo(() => {
    if (!projectsStatus) {
      return { active: [], paused: [], complete: [] };
    }
    const grouped: Record<WorkflowStatusType, ProjectWorkflowStatus[]> = {
      active: [],
      paused: [],
      complete: [],
    };
    for (const project of projectsStatus.projects) {
      grouped[project.workflowStatus].push(project);
    }
    return grouped;
  }, [projectsStatus]);

  /**
   * Handle marking a workflow as complete
   */
  const handleMarkComplete = useCallback(async (projectName: string): Promise<void> => {
    setCompletingProject(projectName);
    try {
      const response = await fetch(`/api/workflow/projects/${encodeURIComponent(projectName)}/complete`, {
        method: "POST",
      });
      if (response.ok) {
        // Refresh the projects status to reflect the change
        const projectsRes = await fetch("/api/workflow/projects-status");
        if (projectsRes.ok) {
          const projectsData = await projectsRes.json() as WorkflowProjectsStatusResponse;
          setProjectsStatus(projectsData);
        }
      } else {
        console.error("[LiveLogFeed] Failed to mark workflow complete:", await response.text());
      }
    } catch (err) {
      console.error("[LiveLogFeed] Error marking workflow complete:", err);
    } finally {
      setCompletingProject(null);
    }
  }, []);

  /**
   * Handle keyboard navigation
   * Uses activeTabRef for consistency with scroll handling
   * Home = top (newest), End = bottom (oldest)
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (containerRef.current === null) return;

      const scrollAmount = 50;
      switch (event.key) {
        case "ArrowUp":
        case "k":
          containerRef.current.scrollTop -= scrollAmount;
          handleScroll();
          event.preventDefault();
          break;
        case "ArrowDown":
        case "j":
          containerRef.current.scrollTop += scrollAmount;
          handleScroll();
          event.preventDefault();
          break;
        case "Home":
          // Go to top (oldest entries) - pauses auto-scroll
          containerRef.current.scrollTop = 0;
          handleScroll();
          event.preventDefault();
          break;
        case "End":
          // Go to bottom (newest entries) and resume auto-scroll
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          setAutoScrollPaused((prev) => ({ ...prev, [activeTabRef.current]: false }));
          if (scrollResumeTimerRef.current !== null) {
            clearTimeout(scrollResumeTimerRef.current);
            scrollResumeTimerRef.current = null;
          }
          event.preventDefault();
          break;
      }
    },
    [handleScroll]
  );

  /**
   * Convert StreamLogEntry to LogEntryProps
   */
  const toLogEntryProps = useCallback(
    (entry: StreamLogEntry): LogEntryProps => ({
      timestamp: entry.timestamp,
      projectName: entry.projectName,
      sessionNumber: entry.sessionNumber,
      type: entry.type,
      agent: entry.agent,
      skill: entry.skill,
      agentContext: entry.agentContext,
      // Recommendation fields
      confidence: entry.confidence,
      followed: entry.followed,
      // MCP tool call fields
      mcpServer: entry.mcpServer,
      mcpTool: entry.mcpTool,
      // Agent completion fields
      agentId: entry.agentId,
      agentType: entry.agentType,
      status: entry.status,
      totalTokens: entry.totalTokens,
      totalDurationMs: entry.totalDurationMs,
      totalToolUseCount: entry.totalToolUseCount,
      usage: entry.usage,
      // Session context tokens
      sessionContextTokens: entry.sessionContextTokens,
    }),
    []
  );

  /**
   * Handle clear for current tab
   */
  const handleClear = useCallback((): void => {
    if (activeTab === "activity") {
      clearEntries();
    } else if (activeTab === "dashboard") {
      clearApiEntries();
      clearSystemEntries();
    } else if (activeTab === "workflow") {
      setWorkflowEvents([]);
    } else if (activeTab === "claudeproxy") {
      clearContainerEntries("claude-proxy");
    } else {
      clearContainerEntries("mcp-proxy");
    }
  }, [activeTab, clearEntries, clearApiEntries, clearSystemEntries, clearContainerEntries]);

  /**
   * Determine if we should show loading indicator vs empty state for a tab
   * Returns: 'loading' | 'empty' | 'content'
   */
  const getTabDisplayState = useCallback((
    tab: TabType,
    entryCount: number
  ): "loading" | "empty" | "content" => {
    // If we have entries, show content
    if (entryCount > 0) {
      return "content";
    }

    // If we've ever received logs for this tab, show empty state immediately
    // (User cleared logs or logs stopped coming)
    if (hasReceivedLogsRef.current[tab]) {
      return "empty";
    }

    // Check if we've waited long enough to show empty state
    const loadTime = tabLoadTimeRef.current[tab];
    if (loadTime > 0 && Date.now() - loadTime >= EMPTY_STATE_DELAY) {
      return "empty";
    }

    // Still waiting for initial logs
    return "loading";
  }, []);

  /**
   * Render tab buttons - horizontally scrollable on mobile
   */
  const headerTabs = (
    <div className="overflow-x-auto scrollbar-hide scroll-fade-x lg:overflow-visible lg:after:hidden">
      <div className="flex gap-1.5 flex-nowrap" role="tablist" aria-label="Log source tabs">
        {TAB_OPTIONS.map((tab) => (
          <button
            className={`h-10 min-h-[44px] px-3 text-sm lg:h-7 lg:min-h-0 lg:px-2 lg:text-xs rounded-md transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 border-1 border-red-800 ${
              activeTab === tab.value
                ? "bg-red-600 text-white"
                : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
            }`}
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            aria-controls={`tabpanel-${tab.value}`}
          >
            {tab.shortLabel ? (
              <>
                <span className="lg:hidden 3xl:inline">{tab.label}</span>
                <span className="hidden lg:inline 3xl:hidden">{tab.shortLabel}</span>
              </>
            ) : tab.label}
          </button>
        ))}
      </div>
    </div>
  );

  /**
   * Render filter buttons (only for activity tab) - horizontally scrollable on mobile
   */
  const headerFilters = activeTab === "activity" ? (
    <div className="overflow-x-auto scrollbar-hide scroll-fade-x sm:ml-2 lg:overflow-visible lg:after:hidden">
      <div className="flex gap-1.5 flex-nowrap" role="group" aria-label="Log filter options">
        {FILTER_OPTIONS.map((option) => (
          <button
            className={`h-10 min-h-[44px] px-3 text-sm lg:h-7 lg:min-h-0 lg:px-2 lg:text-xs rounded-md transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 border-1 border-red-800 ${
              filter === option.value
                ? "bg-red-600 text-white"
                : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
            }`}
            key={option.value}
            onClick={() => setFilter(option.value)}
            type="button"
            aria-pressed={filter === option.value}
            aria-label={`Filter by ${option.label.toLowerCase()}`}
            title={option.title}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  /**
   * Render header actions (controls) - right side
   * Includes agent/skill/MCP type filters (activity tab only) and nav links
   */
  const headerActions = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Agent/Skill/MCP type filters - only on activity tab */}
      {activeTab === "activity" && RHS_FILTER_OPTIONS.map((option) => (
        <button
          className={`h-10 min-h-[44px] px-3 text-sm lg:h-7 lg:min-h-0 lg:px-2 lg:text-xs rounded-md transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 border-1 border-red-800 ${
            filter === option.value
              ? "bg-red-600 text-white"
              : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
          }`}
          key={option.value}
          onClick={() => setFilter(option.value)}
          type="button"
          aria-pressed={filter === option.value}
          aria-label={`Filter by ${option.label.toLowerCase()}`}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
      {/* Visualize button - commented out
      <Link
        to="/visualization"
        className="h-10 min-h-[44px] px-3 text-sm lg:h-7 lg:min-h-0 lg:px-2 lg:text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 flex items-center"
        aria-label="Open 3D visualization"
      >
        Visualize
      </Link>
      */}
      {/* Workflow Builder button - commented out
      <Link
        to="/workflow-builder"
        className="h-10 min-h-[44px] px-3 text-sm lg:h-7 lg:min-h-0 lg:px-2 lg:text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900 flex items-center"
        aria-label="Open workflow builder"
      >
        Builder
      </Link>
      */}
    </div>
  );

  // Calculate unique project count from entries
  const uniqueProjectCount = useMemo(() => {
    const projectNames = new Set(entries.map(e => e.projectName));
    return projectNames.size;
  }, [entries]);

  // Get filename based on active tab
  const filename = activeTab === "activity"
    ? uniqueProjectCount > 0
      ? `${uniqueProjectCount} project${uniqueProjectCount === 1 ? "" : "s"} → routing logs`
      : "discovering projects..."
    : activeTab === "workflow"
      ? workflowStatus?.active
        ? `workflow active: ${workflowStatus.currentStage ?? "unknown"}`
        : "workflow events"
      : activeTab === "stats"
        ? "agent statistics (24h)"
        : activeTab === "dashboard"
          ? "API + system logs"
          : activeTab === "claudeproxy"
            ? "docker://claude-proxy"
            : "docker://mcp-proxy";

  // Loading state for activity tab - skeleton loader while connecting
  if (activeTab === "activity" && connectionStatus === "disconnected" && displayEntries.length === 0) {
    return (
      <TerminalCard command="tail -f" filename={filename} className={className} noPadding>
        <SkeletonLogRows />
      </TerminalCard>
    );
  }

  return (
    <TerminalCard
      command="tail -f"
      filename={filename}
      headerText={
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          {headerTabs}
          {headerFilters}
        </div>
      }
      headerActions={headerActions}
      className={className}
      noPadding
    >
      <div className="flex flex-col h-full">
        {/* Activity Tab Content */}
        {activeTab === "activity" && (
          <div
            className="overflow-auto flex-1 min-h-0 scroll-smooth scrollbar-slim"
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            ref={containerRef}
            role="tabpanel"
            id="tabpanel-activity"
            tabIndex={0}
            aria-label="Live log entries"
            aria-live="polite"
          >
            {(() => {
              const state = getTabDisplayState("activity", displayEntries.length);
              if (state === "loading") {
                return <SkeletonLogRows />;
              }
              if (state === "empty") {
                return (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500 text-sm">
                      {filter === "all"
                        ? "No activity detected"
                        : `No ${filter.replace("_", " ")} entries found`}
                    </p>
                  </div>
                );
              }
              return displayEntries.map((entry) => (
                <LogEntry key={getActivityEntryKey(entry)} {...toLogEntryProps(entry)} />
              ));
            })()}
          </div>
        )}

        {/* Dashboard Tab Content (API + System logs combined) */}
        {activeTab === "dashboard" && (
          <div
            className="overflow-auto flex-1 min-h-0 scroll-smooth scrollbar-slim"
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            ref={containerRef}
            role="tabpanel"
            id="tabpanel-dashboard"
            tabIndex={0}
            aria-label="Dashboard log entries"
            aria-live="polite"
          >
            {(() => {
              const state = getTabDisplayState("dashboard", displayDashboardEntries.length);
              if (state === "loading") {
                return <SkeletonLogRows />;
              }
              if (state === "empty") {
                return (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500 text-sm">No dashboard logs</p>
                  </div>
                );
              }
              return displayDashboardEntries.map((entry) => {
                if (entry._type === "api") {
                  return <ApiLogRow key={getApiEntryKey(entry)} entry={entry} />;
                }
                return <SystemLogRow key={getSystemEntryKey(entry)} entry={entry} />;
              });
            })()}
          </div>
        )}

        {/* Claude Proxy Tab Content */}
        {activeTab === "claudeproxy" && (
          <div
            className="overflow-auto flex-1 min-h-0 scroll-smooth scrollbar-slim"
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            ref={containerRef}
            role="tabpanel"
            id="tabpanel-claudeproxy"
            tabIndex={0}
            aria-label="Claude Proxy log entries"
            aria-live="polite"
          >
            {(() => {
              const state = getTabDisplayState("claudeproxy", displayClaudeProxyEntries.length);
              if (state === "loading") {
                return <SkeletonLogRows />;
              }
              if (state === "empty") {
                return (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500 text-sm">No claude-proxy logs</p>
                  </div>
                );
              }
              return displayClaudeProxyEntries.map((entry) => (
                <DockerLogRow key={getDockerEntryKey(entry, "claudeproxy")} entry={entry} containerName="claude-proxy" />
              ));
            })()}
          </div>
        )}

        {/* MCP Proxy Tab Content */}
        {activeTab === "mcpproxy" && (
          <div
            className="overflow-auto flex-1 min-h-0 scroll-smooth scrollbar-slim"
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            ref={containerRef}
            role="tabpanel"
            id="tabpanel-mcpproxy"
            tabIndex={0}
            aria-label="MCP Proxy log entries"
            aria-live="polite"
          >
            {(() => {
              const state = getTabDisplayState("mcpproxy", displayMcpproxyEntries.length);
              if (state === "loading") {
                return <SkeletonLogRows />;
              }
              if (state === "empty") {
                return (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500 text-sm">No mcp-proxy logs</p>
                  </div>
                );
              }
              return displayMcpproxyEntries.map((entry) => (
                <DockerLogRow key={getDockerEntryKey(entry, "mcpproxy")} entry={entry} containerName="mcp-proxy" />
              ));
            })()}
          </div>
        )}

        {/* Workflow Tab Content */}
        {activeTab === "workflow" && (
          <div
            className="overflow-auto flex-1 min-h-0 scroll-smooth scrollbar-slim"
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            ref={containerRef}
            role="tabpanel"
            id="tabpanel-workflow"
            tabIndex={0}
            aria-label="Workflow log entries"
            aria-live="polite"
          >
            {/* Workflow summary banner */}
            {projectsStatus && projectsStatus.projects.length > 0 && (
              <div className={`${LOG_ROW_BASE} border-b-1 border-gray-800 sticky top-0 bg-gray-900/95 z-10`}>
                <span className="text-cyan-400">workflow</span>
                <span className="text-gray-600"> :: </span>
                <span className={projectsStatus.summary.activeCount > 0 ? "text-yellow-400" : "text-gray-500"}>
                  {projectsStatus.summary.activeCount} active
                </span>
                {projectsStatus.summary.pausedCount > 0 && (
                  <>
                    <span className="ml-2 text-gray-600">|</span>
                    <span className="ml-2 text-orange-400">
                      {projectsStatus.summary.pausedCount} paused
                    </span>
                  </>
                )}
                {projectsStatus.summary.completeCount > 0 && (
                  <>
                    <span className="ml-2 text-gray-600">|</span>
                    <span className="ml-2 text-green-400">
                      {projectsStatus.summary.completeCount} complete
                    </span>
                  </>
                )}
              </div>
            )}
            {(() => {
              const state = getTabDisplayState("workflow", displayWorkflowEvents.length);
              if (state === "loading") {
                return <SkeletonLogRows />;
              }
              if (state === "empty") {
                return (
                  <div className="flex flex-col items-center justify-center h-full">
                    <p className="text-gray-500 text-sm mb-2">No workflow events</p>
                    <p className="text-gray-600 text-xs">Run /workflow to start a workflow</p>
                  </div>
                );
              }
              // Render status sections (active, paused, complete)
              if (projectsStatus && projectsStatus.projects.length > 0) {
                return (
                  <>
                    <WorkflowStatusSection
                      statusType="active"
                      projects={projectsByStatus.active}
                      eventsByProject={eventsByProject}
                      defaultExpanded={true}
                      onMarkComplete={(projectPath) => void handleMarkComplete(projectPath)}
                      completingProject={completingProject}
                    />
                    <WorkflowStatusSection
                      statusType="paused"
                      projects={projectsByStatus.paused}
                      eventsByProject={eventsByProject}
                      defaultExpanded={false}
                      onMarkComplete={(projectPath) => void handleMarkComplete(projectPath)}
                      completingProject={completingProject}
                    />
                    <WorkflowStatusSection
                      statusType="complete"
                      projects={projectsByStatus.complete}
                      eventsByProject={eventsByProject}
                      defaultExpanded={false}
                    />
                  </>
                );
              }
              // No projects-status available - show empty state
              return (
                <div className="flex flex-col items-center justify-center h-full">
                  <p className="text-gray-500 text-sm mb-2">Waiting for workflow data...</p>
                  <p className="text-gray-600 text-xs">Run /workflow to start a workflow</p>
                </div>
              );
            })()}
          </div>
        )}

        {/* Stats Tab Content */}
        {activeTab === "stats" && (
          <div
            className="overflow-auto flex-1 min-h-0"
            role="tabpanel"
            id="tabpanel-stats"
            tabIndex={0}
            aria-label="Agent statistics"
          >
            <AgentStatsPanel />
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
