/**
 * Dashboard API Server
 * Express server providing REST API endpoints for routing analytics
 * and WebSocket server for real-time log streaming
 */

import type { CorsOptions } from "cors";
import type { Express, Request, Response } from "express-serve-static-core";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RealTimeLogMonitor } from "../analytics/real-time-log-monitor.js";
import type { ApiLogPayload, WebSocketServerConfig, XOperationProgressPayload } from "../../types/websocket.js";

import { AccountManager } from "../account/account-manager.js";
import type { Account } from "../account/types/account.js";
import { CredentialSyncService } from "../account/credential-sync.js";
import { createAuthMiddleware, getAuthConfig } from "./middleware/auth.js";
import OAuthUsageClient from "./oauth-usage-client.js";
import { AgentColorsService } from "./services/agent-colors.js";
import { CliCredentialWatcher } from "./services/cli-credential-watcher.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createAccountsRouter } from "./routes/accounts.js";
import { createCliLoginRoutes, setCliLoginLogStreamer, stopAllCliLoginSessions } from "./routes/cli-login.js";
import { createExternalModelsRouter } from "./routes/external-models.js";
import { createClaudeProxyRouter } from "./routes/claude-proxy.js";
import { createLogsRouter } from "./routes/logs.js";
import { createMcpProxyRouter } from "./routes/mcpproxy.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createStatsRouter } from "./routes/stats.js";
import { createStatusRouter } from "./routes/status.js";
import { createWorkflowRouter } from "./routes/workflow.js";
import { createDependenciesRouter } from "./routes/dependencies.js";
import { createWorkflowsRouter } from "./routes/workflows.js";
import { createDryRunRouter } from "./routes/dry-run.js";
import { createTmuxRouter } from "./routes/tmux.js";
import { createServiceHealthRouter } from "./routes/health.js";
import { createValidateRouter } from "./routes/validate.js";
import { createClipboardRouter } from "./routes/clipboard.js";
import { createGeelarkRouter } from "./routes/geelark.js";
import { createXAccountsRouter } from "./routes/x-accounts.js";
import { createEmailAccountsRouter } from "./routes/email-accounts.js";
import { createMarketingRouter } from "./routes/marketing.js";
import { createMarketingCampaignsRouter } from "./routes/marketing-campaigns.js";
import { createAnalyticsRouter } from "./routes/analytics.js";
import { createContentCalendarRouter } from "./routes/content-calendar.js";
import { createPersonasRouter } from "./routes/personas.js";
import { createTrendsRouter } from "./routes/trends.js";
import { createDraftsRouter } from "./routes/drafts.js";
import { createAdminRouter } from "./routes/admin/index.js";
import { createAdminConfigRouter } from "./routes/admin/config.js";
import { createSubscribersRouter } from "./routes/admin/subscribers.js";
import { createLicensesRouter } from "./routes/admin/licenses.js";
import { createDeployRouter } from "./routes/deploy.js";
import { createPolarMetricsRouter } from "./routes/polar-metrics.js";
import type { PolarAdminConfig } from "./services/polar-admin-client.js";
import { McpToolClient } from "./services/mcp-tool-client.js";
import { TmuxDockerClient } from "./services/tmux-docker-client.js";
import { WorkflowStorageService } from "./services/workflow-storage.js";
import { LogAggregatorService } from "./services/log-aggregator.js";
import { EventStreamService } from "./services/event-stream.js";
import { LiveLogStream } from "./services/live-log-stream.js";
import { DockerLogStreamService, type DockerLogEntry } from "./services/docker-log-stream.js";
import { AgentCompletionStream } from "./services/agent-completion-stream.js";
import { ActiveAgentTrackerService } from "./services/active-agent-tracker.js";
import type { DiscoveredProject } from "./services/project-scanner.js";
import { ProjectScannerService } from "./services/project-scanner.js";
import { UpdateExecutorService } from "./services/update-executor.js";
import { SessionDataService } from "./services/SessionDataService.js";
import { AccountHealthService } from "./services/account-health-service.js";
import type { HealthAlert } from "./services/account-health-service.js";
import { ContentSchedulerService } from "./services/content-scheduler.js";
import type { PostPublishingEvent, PostPublishedEvent, PostFailedEvent } from "./services/content-scheduler.js";
import { UsageMonitor } from "./services/usage-monitor.js";
import type { RotationNeededEvent } from "./services/types/usage.js";
import { SessionStateWatcher, type SessionStateChange } from "./services/session-state-watcher.js";
import { EmailVaultWatcher } from "./services/email-vault-watcher.js";
import { XVaultWatcher } from "./services/x-vault-watcher.js";
import { systemLogger } from "./services/system-logger.js";
import { createLogWebSocketServer, LogStreamer } from "./websocket-server.js";
import type { LogWebSocketServerResult } from "./websocket-server.js";
import { createTerminalWebSocketServer } from "./terminal-server.js";
import type { TerminalSessionManager } from "./terminal-server.js";

// Constants
const DEFAULT_PORT = 3850;
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// CORS allowed origins for frontend development
const CORS_ORIGINS = [
  "http://localhost:3000", // React/Next.js default
  "http://localhost:5173", // Vite default
  "http://localhost:4173", // Vite preview
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];


// Track active credential watcher for cleanup
let activeCredentialWatcher: CliCredentialWatcher | undefined;

// Track active usage monitor for cleanup
let activeUsageMonitor: UsageMonitor | undefined;

// Track active content scheduler for cleanup
let activeContentScheduler: ContentSchedulerService | undefined;

// Track active account health service for cleanup
let activeAccountHealthService: AccountHealthService | undefined;

// Track active terminal session manager for cleanup
let activeTerminalManager: TerminalSessionManager | undefined;
let activeSessionStateWatcher: SessionStateWatcher | undefined;
let activeXVaultWatcher: XVaultWatcher | undefined;
let activeEmailVaultWatcher: EmailVaultWatcher | undefined;

// Track log streamer for API logging middleware
let apiLogStreamer: LogStreamer | undefined;

/**
 * Server configuration options
 */
export interface ServerConfig {
  /** Hostname to bind (default: localhost) */
  host?: string;
  /** Port number (default: 3850) */
  port?: number;
  /** Paths to projects to aggregate logs from */
  projectPaths?: string[];
  /** RealTimeLogMonitor instance for WebSocket streaming (optional) */
  logMonitor?: RealTimeLogMonitor;
  /** WebSocket server configuration (optional) */
  webSocketConfig?: WebSocketServerConfig;
}

/**
 * Dashboard server result with HTTP server and optional WebSocket streamer
 */
export interface DashboardServerResult {
  /** HTTP server instance */
  server: Server;
  /** WebSocket log streamer instance (only present if logMonitor was provided) */
  logStreamer?: LogStreamer;
}

/**
 * API error with status code
 */
interface ApiError extends Error {
  status?: number;
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: string;
  status: number;
}

/**
 * Health check response
 */
interface HealthResponse {
  /** Whether authentication is enabled on the dashboard API */
  authEnabled: boolean;
  name: string;
  projectCount: number;
  status: string;
  timestamp: string;
  uptime: number;
}

/**
 * Start the dashboard API server
 * @param config - Server configuration
 * @returns Dashboard server result with HTTP server and optional WebSocket streamer
 */
export async function startDashboardServer(config: ServerConfig = {}): Promise<DashboardServerResult> {
  const {
    host = "localhost",
    logMonitor,
    port = DEFAULT_PORT,
    projectPaths = [],
    webSocketConfig,
  } = config;

  const app: Express = createExpressApp();

  // CORS for frontend development
  app.use(cors(createCorsOptions()));

  // JSON parsing
  app.use(createJsonMiddleware());

  // API logging middleware - broadcasts to WebSocket for dashboard monitoring
  app.use(createApiLoggingMiddleware());

  // Get auth configuration from environment
  const authConfig = getAuthConfig();
  if (authConfig.enabled) {
    console.log("[dashboard-api] Authentication enabled");
    if (authConfig.localhostBypass) {
      console.log("[dashboard-api] Localhost bypass enabled");
    }
  }

  // Initialize services
  // Auto-discover claude-workflow projects
  // Use SCAN_ROOT env var if provided (for Docker with mounted home directory)
  // Otherwise use default home directory scanning
  const scanRoot = process.env.SCAN_ROOT;
  let allProjectPaths = [...projectPaths];

  const projectScanner = new ProjectScannerService({
    homeDir: scanRoot, // undefined = use os.homedir()
  });
  const discoveredProjects = await projectScanner.scan();
  const discoveredPaths = discoveredProjects.map((p: DiscoveredProject) => p.path);
  // Merge explicit projectPaths with auto-discovered ones (deduplicated)
  allProjectPaths = [...new Set([...projectPaths, ...discoveredPaths])];

  if (scanRoot !== undefined) {
    console.log(`[dashboard-api] Scanning mounted directory: ${scanRoot}`);
  }
  console.log(`[dashboard-api] Discovered ${discoveredProjects.length} projects, ${allProjectPaths.length} total`);

  const logAggregator = new LogAggregatorService();
  const sessionService = new SessionDataService();
  const oauthClient = new OAuthUsageClient();
  const accountManager = new AccountManager();

  // Wire credential sync for auto-syncing on account switches
  const credentialSync = new CredentialSyncService();
  accountManager.setCredentialSyncService(credentialSync);

  // Create and wire UsageMonitor with proactive rotation at 95% usage threshold
  // Switches accounts BEFORE hitting the hard rate limit for seamless operation
  const usageMonitor = new UsageMonitor(accountManager, { autoRotation: true });
  activeUsageMonitor = usageMonitor;  // Store for cleanup

  // Wire UsageMonitor to AccountManager for capacity-aware rotation selection
  accountManager.setUsageMonitor(usageMonitor);

  // Proactive rotation: UsageMonitor emits rotation-needed at 95% utilization
  // Handler rotates to best available account and syncs credentials
  usageMonitor.on("rotation-needed", (event: RotationNeededEvent) => {
    console.log(
      `[dashboard-api] Proactive rotation triggered: ${event.currentAccountId.slice(0, 8)}... at ${String(event.utilization)}% utilization`
    );
    void accountManager.rotateToNextAccount().then((result) => {
      if (result.success) {
        console.log(
          `[dashboard-api] Rotated to ${result.newAccountId?.slice(0, 8) ?? "none"}... (recommended: ${event.recommendedAccountId.slice(0, 8)}...)`
        );
      } else {
        console.error(`[dashboard-api] Rotation failed: ${result.error ?? "unknown error"}`);
      }
    });
  });

  const updateExecutor = new UpdateExecutorService();
  const agentColorsService = new AgentColorsService(process.cwd());
  const workflowStorage = new WorkflowStorageService();
  const tmuxClient = new TmuxDockerClient();


  // Health check endpoint - registered BEFORE auth middleware (public)
  // Session state REST endpoint - returns current state of all sessions
  app.get("/api/session-states", (_req: Request, res: Response) => {
    if (activeSessionStateWatcher) {
      const states = activeSessionStateWatcher.getCurrentStates();
      res.status(HTTP_STATUS_OK).json({ states });
    } else {
      res.status(HTTP_STATUS_OK).json({ states: [] });
    }
  });

  app.get("/health", (_req: Request, res: Response) => {
    const response: HealthResponse = {
      authEnabled: authConfig.enabled,
      name: "dashboard-api",
      projectCount: allProjectPaths.length,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
    res.status(HTTP_STATUS_OK).json(response);
  });


  // Apply auth middleware ONLY to /api/* routes
  app.use("/api", createAuthMiddleware(authConfig));

  // Mutable reference for LogStreamer - assigned after server.listen() creates it
  // Routes execute at request-time (post-listen), so getter always returns current value
  let logStreamerRef: LogStreamer | undefined;

  // Service health check endpoint (protected by auth middleware via /api prefix)
  app.use("/api/health", createServiceHealthRouter({
    getLogStreamer: () => logStreamerRef,
  }));

  // Mount API routes (now protected by auth middleware)
  app.use("/api/accounts", createAccountsRouter({
    accountManager,
    usageMonitor,
    getLogStreamer: () => logStreamerRef,
  }));
  app.use("/api/cli-login", createCliLoginRoutes(accountManager));
  app.use("/api", createAgentsRouter({ agentColorsService }));
  app.use("/api", createLogsRouter(logAggregator));
  app.use("/api/projects", createProjectsRouter({ projectScanner, updateExecutor }));
  app.use("/api/sessions", createSessionsRouter(sessionService));
  // MCP Proxy router - connects to mcp-proxy container via HTTP health checks
  app.use("/api/mcpproxy", createMcpProxyRouter());
  // X account management and GeeLark cloud phone routes
  // McpToolClient is instantiated once and shared between both routers
  const mcpToolClient = new McpToolClient();
  app.use("/api/x-accounts", createXAccountsRouter({ mcpToolClient }));
  app.use("/api/geelark", createGeelarkRouter({ mcpToolClient }));
  // Email account management routes (shares the same McpToolClient instance)
  app.use("/api/email-accounts", createEmailAccountsRouter({ mcpToolClient }));
  app.use("/api/marketing", createMarketingRouter({ mcpToolClient }));
  app.use("/api/marketing/campaigns", createMarketingCampaignsRouter({ mcpToolClient }));
  app.use("/api/analytics", createAnalyticsRouter({ mcpToolClient }));
  app.use("/api/personas", createPersonasRouter({ mcpToolClient }));
  app.use("/api/trends", createTrendsRouter({ mcpToolClient }));
  app.use("/api/drafts", createDraftsRouter({ mcpToolClient }));
  app.use(
    "/api/content-calendar",
    createContentCalendarRouter({
      mcpToolClient,
      broadcastApprovalEvent: (
        eventType: string,
        data: Record<string, unknown>,
      ) => {
        logStreamerRef?.broadcast({
          type: "content_calendar_event" as const,
          payload: { event: eventType, ...data },
        });
      },
    }),
  );

  // Content Scheduler - polls calendar for due posts and publishes to platforms
  const contentScheduler = new ContentSchedulerService(mcpToolClient, {
    xAccountId: process.env["MARKETING_X_ACCOUNT_ID"],
  });
  activeContentScheduler = contentScheduler;

  // Wire scheduler events to WebSocket broadcast for real-time dashboard updates
  contentScheduler.on("post-publishing", (event: PostPublishingEvent) => {
    logStreamerRef?.broadcast({
      type: "content_scheduler_event",
      payload: { event: "post-publishing", ...event },
    });
  });

  contentScheduler.on("post-published", (event: PostPublishedEvent) => {
    logStreamerRef?.broadcast({
      type: "content_scheduler_event",
      payload: { event: "post-published", ...event },
    });
  });

  contentScheduler.on("post-failed", (event: PostFailedEvent) => {
    logStreamerRef?.broadcast({
      type: "content_scheduler_event",
      payload: { event: "post-failed", ...event },
    });
  });

  // Start polling immediately - croner handles schedule timing
  contentScheduler.start();
  console.log("[dashboard-api] ContentScheduler started for automated post publishing");

  // Account Health Service - monitors X account health scores and shadow bans
  const accountHealthService = new AccountHealthService(mcpToolClient, {
    checkerAccountId: process.env["HEALTH_CHECKER_ACCOUNT_ID"],
  });
  activeAccountHealthService = accountHealthService;

  // Wire health events to WebSocket broadcast
  accountHealthService.on("account_health_update", (event: { accountId: string; handle: string; metrics: Record<string, unknown> }) => {
    logStreamerRef?.broadcast({
      type: "account_health_update",
      payload: event,
    });
  });

  accountHealthService.on("health_alert", (alert: HealthAlert) => {
    logStreamerRef?.broadcast({
      type: "health_alert",
      payload: { alert, action: "created" as const },
    });
  });

  // Emergency auto-pause: stop ContentScheduler when health score critically low
  accountHealthService.on("critical_health", (event: { accountId: string; handle: string; healthScore: number; alert: HealthAlert }) => {
    if (activeContentScheduler) {
      systemLogger.warn("AccountHealth", `Emergency auto-pause triggered for ${event.handle} (score: ${event.healthScore})`);
      activeContentScheduler.stop();
      console.log("[dashboard-api] ContentScheduler auto-paused due to critical account health");
    }
  });

  accountHealthService.start();
  console.log("[dashboard-api] AccountHealthService started for account health monitoring");

  // Claude Proxy router - agent and model routing configuration
  app.use("/api/claude-proxy", createClaudeProxyRouter());
  // External models router - non-Claude model configuration
  app.use("/api/external-models", createExternalModelsRouter());
  app.use("/api/status", createStatusRouter({
    logAggregator,
    oauthClient,
  }));
  // Stats router - agent statistics and analytics
  app.use("/api/stats", createStatsRouter({ logAggregator }));
  // Workflow router - workflow events and status (uses dynamic project discovery)
  app.use("/api/workflow", createWorkflowRouter({ projectScanner }));
  // Dependencies router - dependency graph for workflow visualization (uses dynamic project discovery)
  app.use("/api/workflow", createDependenciesRouter({ projectScanner }));
  // Workflows storage router - CRUD operations for workflow YAML files across three tiers
  app.use("/api/workflows", createWorkflowsRouter({ workflowStorage }));
  // Dry run router - workflow simulation and validation
  try {
    app.use("/api/workflows/dry-run", createDryRunRouter());
  } catch (error) {
    console.warn("[dashboard-api] Dry run router unavailable (schema not found):", (error as Error).message);
  }
  // Validate router - schema validation with detailed error reporting
  try {
    app.use("/api/workflows", createValidateRouter());
  } catch (error) {
    console.warn("[dashboard-api] Validate router unavailable (schema not found):", (error as Error).message);
  }
  // Tmux session management router - session CRUD and notifications
  app.use("/api/tmux", createTmuxRouter({ tmuxClient }));
  // Clipboard image upload router - for pasting screenshots into terminal
  app.use("/api/clipboard", createClipboardRouter());

  // Admin router - subscriber/license/config management via Polar.sh
  // When CLAUDE_WORKFLOW_ADMIN_TOKEN is set, mounts with admin auth middleware.
  // When not set (local dev), mounts sub-routers directly without admin auth.
  const adminRouter = createAdminRouter();
  if (adminRouter) {
    app.use("/api/admin", adminRouter);
  } else {
    // Local dev: mount admin sub-routers without admin auth
    const polarConfig: PolarAdminConfig = {
      apiToken: process.env["POLAR_API_TOKEN"] ?? "",
      organizationId: process.env["POLAR_ORG_ID"] ?? "",
    };
    app.use("/api/admin/config", createAdminConfigRouter({ projectRoot: process.cwd() }));
    app.use("/api/admin/subscribers", createSubscribersRouter({ polarConfig }));
    app.use("/api/admin/licenses", createLicensesRouter({ polarConfig }));
  }

  // Polar revenue metrics router - proxies to Polar.sh metrics API
  app.use("/api/admin/metrics", createPolarMetricsRouter());

  // Deploy pipeline router - triggers and monitors GitHub Actions deploys
  app.use("/api/deploy", createDeployRouter({
    githubToken: process.env["GITHUB_DEPLOY_PAT"] ?? "",
  }));

  // HTTP bridge for MCP proxy to push X operation progress updates
  // The mcp-proxy container POSTs to this endpoint during long-running operations
  // (warming steps, cookie harvesting, etc.) and the dashboard broadcasts via WebSocket
  app.post("/api/x/operations/progress", (req: Request, res: Response) => {
    if (logStreamerRef) {
      const payload = req.body as XOperationProgressPayload;
      logStreamerRef.broadcastXOperationProgress(payload);
    }
    res.sendStatus(204);
  });

  // Serve frontend static files
  // Prefer admin-dist (superset with admin routes) over dist (public-only)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const adminDistPath = path.join(__dirname, "frontend", "admin-dist");
  const publicDistPath = path.join(__dirname, "frontend", "dist");
  const frontendDistPath = existsSync(adminDistPath) ? adminDistPath : publicDistPath;

  if (existsSync(frontendDistPath)) {
    console.log(`[dashboard-api] Serving frontend from ${frontendDistPath}`);
    // Serve static assets - cast to RequestHandler for type safety
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- express v5 types
    app.use(express.static(frontendDistPath));

    // SPA catch-all: serve index.html for non-API routes
    // Express 5 requires named parameters for wildcards
    // Exclude /api/* and /health routes from catch-all
    app.get("/{*splat}", (req: Request, res: Response) => {
      const reqPath = req.path;
      if (reqPath.startsWith("/api/") || reqPath === "/health") {
        res.status(HTTP_STATUS_NOT_FOUND).json({ error: "Not found" });
        return;
      }
      res.sendFile(path.join(frontendDistPath, "index.html"));
    });
  } else {
    console.log("[dashboard-api] Frontend dist not found, API-only mode");
    // Provide helpful response for root path when frontend is not built
    app.get("/", (_req: Request, res: Response) => {
      res.status(HTTP_STATUS_OK).json({
        message: "Dashboard API is running. Frontend not built.",
        endpoints: ["/health", "/api/logs", "/api/sessions", "/api/status", "/api/claude-proxy"],
      });
    });
  }

  // Error handling middleware - must be last
  app.use(errorHandlerMiddleware);

  return new Promise<DashboardServerResult>((resolve, reject) => {
    // Attach WebSocket server if logMonitor is provided
    let liveLogStream: LiveLogStream | undefined;
    let logStreamer: LogStreamer | undefined;

    const server: Server = app
      .listen(port, host, () => {
        console.log(`Dashboard API running on http://${host}:${String(port)}`);

        // Regenerate agent hashes on startup for claude-proxy routing
        // This ensures all agents are available in the dashboard
        void (async () => {
          try {
            const { generateAgentHashes } = await import("../commands/generate-agent-hashes.js");
            generateAgentHashes({ dryRun: false });
          } catch (error) {
            console.warn("[dashboard-api] Failed to generate agent hashes:", error);
          }
        })();

        // Set up live log stream if logMonitor is provided
        if (logMonitor) {
          // Create live log stream with project scanner
          // This will watch routing logs in all discovered projects
          liveLogStream = new LiveLogStream(projectScanner);

          // Create Agent Completion stream early so it can be passed to WebSocket server
          // This allows new subscribers to receive cached completions on connect
          // Compute encoded directory names for ~/.claude/projects/ watching.
          // Must use containerPathToHostPath for Docker (container paths → host paths)
          // then encode (replace / with -) to get actual dir names on disk.
          const watchDirs = allProjectPaths.map(p => {
            const hostPath = projectScanner.containerPathToHostPath(p);
            return hostPath.replaceAll("/", "-");
          });
          const agentCompletionStream = new AgentCompletionStream({ watchDirs });

          // Create Active Agent Tracker to track in-progress agents
          // This allows new subscribers to see agents that are already running
          const activeAgentTracker = new ActiveAgentTrackerService();
          activeAgentTracker.start(liveLogStream, agentCompletionStream);

          // Create log WebSocket server (noServer mode -- does NOT register its own upgrade handler)
          const logWsResult: LogWebSocketServerResult = createLogWebSocketServer(
            logMonitor,
            liveLogStream,
            agentCompletionStream,
            activeAgentTracker,
            webSocketConfig
          );
          logStreamer = logWsResult.logStreamer;

          // Wire LogStreamer reference for service health endpoint
          logStreamerRef = logStreamer;

          // Create terminal WebSocket server for PTY sessions
          const terminalWsResult = createTerminalWebSocketServer({
            tmuxSocketPath: process.env.TMUX_SOCKET,
          });
          activeTerminalManager = terminalWsResult.terminalManager;

          // Centralized WebSocket upgrade dispatcher
          // Routes upgrade requests to the appropriate WSS by URL path.
          // Follows the ws library's documented pattern for multiple WebSocket servers
          // sharing a single HTTP server.
          // See: docs/research/websocket-upgrade-dispatcher-refactoring.md
          server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
            const url = new URL(request.url ?? "", `http://${request.headers.host}`);
            const pathname = url.pathname;

            if (pathname === "/ws/logs") {
              logWsResult.handleUpgrade(request, socket, head);
            } else if (pathname === "/ws/terminal") {
              terminalWsResult.handleUpgrade(request, socket, head);
            } else {
              // FIX: Destroy unclaimed upgrade sockets to prevent socket leak.
              // Previously, unrecognized paths left the socket open until TCP timeout.
              // See: https://github.com/nodejs/node/issues/6339
              socket.destroy();
            }
          });

          // Set log streamer for SystemLogger (broadcasts account management logs)
          systemLogger.setLogStreamer(logStreamer);

          // Set log streamer for CLI login routes (for broadcasting CLI login events)
          setCliLoginLogStreamer(logStreamer);

          // Set log streamer for API logging middleware
          apiLogStreamer = logStreamer;

          // Connect LiveLogStream to WebSocket server
          // This bridges the gap between log file watching and frontend delivery
          liveLogStream.on("log-entry", (entry) => {
            // LogStreamer.broadcastLogEntry will broadcast to global subscribers
            if (logStreamer) {
              logStreamer.broadcastLogEntry(entry);
            }
          });

          // Handle errors from log stream to prevent server crashes
          liveLogStream.on("error", (error: Error) => {
            console.error("[dashboard-api] LiveLogStream error:", error.message);
          });

          // Start watching log files across all projects
          void liveLogStream.startLiveStream();
          console.log("[dashboard-api] LiveLogStream started and connected to WebSocket");
          console.log(`WebSocket server attached at ws://${host}:${String(port)}/ws/logs`);
          console.log(`[dashboard-api] Terminal WebSocket server attached at ws://${host}:${String(port)}/ws/terminal`);

          // Start EventStreamService for each project to feed LogAggregatorService
          // This connects events.jsonl to the dashboard's event processing pipeline
          const eventStreams: EventStreamService[] = [];
          for (const projectPath of allProjectPaths) {
            const eventStream = new EventStreamService({
              projectPath,
              onEvent: (event) => {
                // Process event through LogAggregatorService for API queries
                logAggregator.processEvent(event);
              },
              onError: (error) => {
                console.error(`[dashboard-api] EventStreamService error for ${projectPath}:`, error.message);
              },
            });
            eventStreams.push(eventStream);
            void eventStream.start();
          }
          console.log(`[dashboard-api] EventStreamService started for ${eventStreams.length} project(s)`);

          // Start Docker log streaming for container logs (claude-proxy, mcp-proxy)
          const dockerLogStream = new DockerLogStreamService();

          // Connect DockerLogStreamService to WebSocket server
          dockerLogStream.on("log", (entry: DockerLogEntry) => {
            if (logStreamer) {
              logStreamer.broadcastDockerLog({
                container: entry.container,
                level: entry.level,
                message: entry.message,
                stream: entry.stream,
                timestamp: entry.timestamp,
              });
            }
          });

          // Handle Docker stream errors
          dockerLogStream.on("error", (error: Error, container: string) => {
            console.error(`[dashboard-api] DockerLogStream error for ${container}:`, error.message);
          });

          // Start Docker log streaming
          void dockerLogStream.start();
          console.log("[dashboard-api] DockerLogStreamService started and connected to WebSocket");

          // Connect AgentCompletionStream to WebSocket server and log aggregator
          // (agentCompletionStream was created earlier and passed to WebSocket server)
          agentCompletionStream.on("agent-completion", (event) => {
            console.log(`[dashboard-api] Received agent-completion: agentType=${event.agentType}, tokens=${event.totalTokens}`);
            if (logStreamer) {
              // Broadcast to global subscribers as agent_completion message type
              console.log("[dashboard-api] Broadcasting agent_completion to WebSocket subscribers");
              logStreamer.broadcast({
                type: "agent_completion",
                payload: {
                  timestamp: event.timestamp,
                  projectName: event.projectName,
                  agentId: event.agentId,
                  agentType: event.agentType,
                  status: event.status,
                  totalTokens: event.totalTokens,
                  totalDurationMs: event.totalDurationMs,
                  totalToolUseCount: event.totalToolUseCount,
                  usage: event.usage,
                },
              });
            } else {
              console.warn("[dashboard-api] No logStreamer available for agent_completion broadcast");
            }

            // Process as AgentCompletionEvent for log aggregator stats
            // This enables agent stats to show tokens and duration per agent
            if (event.agentType) {
              const completionEvent = {
                ts: event.timestamp,
                session: event.sessionId,
                type: "agent_completion" as const,
                agentType: event.agentType,
                status: event.status,
                durationMs: event.totalDurationMs,
                totalTokens: event.totalTokens,
                inputTokens: event.usage?.input_tokens,
                outputTokens: event.usage?.output_tokens,
              };
              logAggregator.processEvent(completionEvent);
            }
          });

          // Handle Agent Completion stream errors
          agentCompletionStream.on("error", (error: Error, context: string) => {
            console.error(`[dashboard-api] AgentCompletionStream error (${context}):`, error.message);
          });

          // Start watching Claude session logs for agent completions
          void agentCompletionStream.start();
          console.log("[dashboard-api] AgentCompletionStream started and connected to WebSocket");

          // Create SessionStateWatcher to broadcast session state changes
          const sessionStateWatcher = new SessionStateWatcher();
          activeSessionStateWatcher = sessionStateWatcher;
          sessionStateWatcher.on("state_change", (change: SessionStateChange) => {
            console.log(`[dashboard-api] Session state change: ${change.sessionName} -> ${change.state}`);
            if (logStreamer) {
              logStreamer.broadcast({
                type: "session_state_change",
                payload: {
                  sessionName: change.sessionName,
                  state: change.state,
                  timestamp: change.timestamp,
                  ...(change.toolName && { toolName: change.toolName }),
                  ...(change.cumulativeTokens !== undefined && { cumulativeTokens: change.cumulativeTokens }),
                  ...(change.projectName && { projectName: change.projectName }),
                },
              });
            } else {
              console.log("[dashboard-api] logStreamer is null, cannot broadcast session state change");
            }
          });
          void sessionStateWatcher.start();
          console.log("[dashboard-api] SessionStateWatcher started and connected to WebSocket");

          // Create CLI credential watcher to sync CLI logins to dashboard
          // Uses CLAUDE_HOME or HOME env var for Docker environments (not SCAN_ROOT which is for projects)
          const claudeHome = process.env.CLAUDE_HOME ?? process.env.HOME;
          const cliCredentialWatcher = new CliCredentialWatcher(
            accountManager,
            credentialSync,
            {
              // If CLAUDE_HOME is set (Docker), use that path's credentials file
              credentialsPath: claudeHome
                ? path.join(claudeHome, ".credentials.json")
                : undefined,  // Use default detection
            }
          );

          // Store reference for cleanup in stopDashboardServer
          activeCredentialWatcher = cliCredentialWatcher;

          // Connect CliCredentialWatcher to WebSocket server
          // When CLI credentials sync, broadcast to frontend clients
          cliCredentialWatcher.on("credentials-synced", (account: Account) => {
            if (logStreamer) {
              logStreamer.broadcastCredentialUpdate({
                accountId: account.id,
                action: account.metadata.lastUsedAt ? "updated" : "added",
                email: account.metadata.email ?? "unknown",
                subscriptionType: account.token.subscriptionType ?? "unknown",
                syncedAt: new Date().toISOString(),
              });
            }
          });

          // Handle watcher errors gracefully - log but don't crash
          cliCredentialWatcher.on("error", (error: Error) => {
            console.error("[dashboard-api] CliCredentialWatcher error:", error.message);
          });

          // Start watching CLI credentials file (non-blocking)
          void cliCredentialWatcher.start().then(() => {
            console.log("[dashboard-api] CliCredentialWatcher started for CLI login sync");
          }).catch((error: unknown) => {
            // Don't fail startup if watcher can't start (e.g., permissions issue)
            console.log("[dashboard-api] CliCredentialWatcher not available:", (error as Error).message);
          });

          // Create XVaultWatcher for detecting external X vault mutations
          // (changes made by mcp-proxy container or CLI tools directly)
          const xVaultWatcher = new XVaultWatcher({
            // Use CLAUDE_HOME for Docker environments, falling back to HOME
            vaultPath: claudeHome
              ? path.join(claudeHome, ".claude-workflow", "x-accounts.json")
              : undefined,
          });
          activeXVaultWatcher = xVaultWatcher;

          // Connect XVaultWatcher to LogStreamer
          // When vault file changes externally, broadcast update to frontend
          xVaultWatcher.on("vault_changed", () => {
            if (logStreamer) {
              // Broadcast a generic account update indicating vault file changed
              // The frontend will re-fetch the full account list via REST
              logStreamer.broadcastXAccountUpdate({
                accountId: "vault",
                handle: "vault",
                currentState: "active",
                changeSource: "vault_file_change",
                timestamp: new Date().toISOString(),
              });
            }
          });

          // Handle watcher errors gracefully
          xVaultWatcher.on("error", (error: Error) => {
            console.error("[dashboard-api] XVaultWatcher error:", error.message);
          });

          // Set up snapshot provider for handleSubscribeAll
          // This reads the vault via the MCP proxy REST API (or local file)
          // For now, the snapshot provider returns null; it will be connected
          // when the X accounts REST routes are added in a subsequent task
          logStreamer.setXAccountsSnapshotProvider(() => {
            // TODO: Connect to X accounts data source when REST routes are added
            return null;
          });

          // Start watching vault file (non-blocking)
          void xVaultWatcher.start().then(() => {
            console.log("[dashboard-api] XVaultWatcher started for X vault file monitoring");
          }).catch((error: unknown) => {
            console.log(
              "[dashboard-api] XVaultWatcher not available:",
              (error as Error).message
            );
          });

          // Create EmailVaultWatcher for detecting external email vault mutations
          // (changes made by mcp-proxy container or CLI tools directly)
          const emailVaultWatcher = new EmailVaultWatcher({
            // Use CLAUDE_HOME for Docker environments, falling back to HOME
            vaultPath: claudeHome
              ? path.join(claudeHome, ".claude-workflow", "email-accounts.json")
              : undefined,
          });
          activeEmailVaultWatcher = emailVaultWatcher;

          // Connect EmailVaultWatcher to LogStreamer
          // When vault file changes externally, broadcast update to frontend
          emailVaultWatcher.on("vault_changed", () => {
            if (logStreamer) {
              logStreamer.broadcastEmailAccountUpdate({
                accountId: "vault",
                email: "vault",
                provider: "vault",
                changeSource: "vault_file_change",
                timestamp: new Date().toISOString(),
              });
            }
          });

          // Handle watcher errors gracefully
          emailVaultWatcher.on("error", (error: Error) => {
            console.error("[dashboard-api] EmailVaultWatcher error:", error.message);
          });

          // Set up snapshot provider for handleSubscribeAll
          // Returns null for now; will be connected when email REST routes are added
          logStreamer.setEmailAccountsSnapshotProvider(() => {
            // TODO: Connect to email accounts data source when REST routes are added
            return null;
          });

          // Start watching email vault file (non-blocking)
          void emailVaultWatcher.start().then(() => {
            console.log("[dashboard-api] EmailVaultWatcher started for email vault file monitoring");
          }).catch((error: unknown) => {
            console.log(
              "[dashboard-api] EmailVaultWatcher not available:",
              (error as Error).message
            );
          });

          // Set up UsageMonitor for automatic account rotation based on usage limits
          // Set active account ID for threshold tracking (rotation-needed events)
          void accountManager.getActiveAccount().then((activeAccount) => {
            if (activeAccount) {
              usageMonitor.setActiveAccountId(activeAccount.id);
            }
          });

          // Update UsageMonitor when account switches (keeps rotation tracking accurate)
          accountManager.on("account-switched", (_fromId: string | null, toId: string) => {
            usageMonitor.setActiveAccountId(toId);
          });

          // Start usage monitoring after server is ready
          usageMonitor.start();
          console.log("[dashboard-api] UsageMonitor started for account usage polling");
        }

        resolve({ logStreamer, server });
      })
      .on("error", (error: Error) => {
        console.error("Dashboard API startup error:", error);
        reject(error);
      });
  });
}

/**
 * Stop the dashboard server gracefully
 * @param result - Dashboard server result (server and optional logStreamer)
 */
export async function stopDashboardServer(result: DashboardServerResult | Server): Promise<void> {
  // Handle both old (Server) and new (DashboardServerResult) signatures for backwards compatibility
  const server = "server" in result ? result.server : result;
  const logStreamer = "logStreamer" in result ? result.logStreamer : undefined;

  // Stop CLI credential watcher if running
  if (activeCredentialWatcher?.isActive()) {
    activeCredentialWatcher.stop();
    activeCredentialWatcher = undefined;
    console.log("[dashboard-api] CliCredentialWatcher stopped");
  }

  // Stop usage monitor if running
  if (activeUsageMonitor !== undefined) {
    activeUsageMonitor.stop();
    activeUsageMonitor = undefined;
    console.log("[dashboard-api] UsageMonitor stopped");
  }

  // Stop content scheduler if running
  if (activeContentScheduler !== undefined) {
    activeContentScheduler.stop();
    activeContentScheduler = undefined;
    console.log("[dashboard-api] ContentScheduler stopped");
  }

  // Stop account health service if running
  if (activeAccountHealthService?.isActive()) {
    activeAccountHealthService.stop();
    activeAccountHealthService = undefined;
    console.log("[dashboard-api] AccountHealthService stopped");
  }

  // Stop session state watcher if running
  if (activeSessionStateWatcher) {
    void activeSessionStateWatcher.stop();
    activeSessionStateWatcher = undefined;
    console.log("[dashboard-api] SessionStateWatcher stopped");
  }

  // Stop X vault watcher if running
  if (activeXVaultWatcher?.isActive()) {
    void activeXVaultWatcher.stop();
    activeXVaultWatcher = undefined;
    console.log("[dashboard-api] XVaultWatcher stopped");
  }

  // Stop email vault watcher if running
  if (activeEmailVaultWatcher?.isActive()) {
    void activeEmailVaultWatcher.stop();
    activeEmailVaultWatcher = undefined;
    console.log("[dashboard-api] EmailVaultWatcher stopped");
  }

  // Stop any active CLI login sessions
  stopAllCliLoginSessions();

  // Destroy all terminal sessions if terminal manager exists
  if (activeTerminalManager) {
    activeTerminalManager.destroyAllSessions();
    activeTerminalManager = undefined;
    console.log("[dashboard-api] Terminal sessions destroyed");
  }

  // Close WebSocket server first if present
  if (logStreamer) {
    try {
      await logStreamer.close();
      console.log("WebSocket server shut down gracefully");
    } catch (error) {
      console.error("WebSocket server shutdown error:", error);
    }
  }

  // Close HTTP server
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        console.error("Dashboard API shutdown error:", err);
        reject(err);
      } else {
        console.log("Dashboard API shut down gracefully");
        resolve();
      }
    });
  });
}

/**
 * Create CORS options
 */
function createCorsOptions(): CorsOptions {
  return {
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    origin: CORS_ORIGINS,
  };
}

/**
 * Helper to properly type express() which returns any in v5 types
 */
function createExpressApp(): Express {
   
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- express v5 types
  return express() as Express;
}

/**
 * Helper to properly type express.json()
 */
function createJsonMiddleware(): ReturnType<typeof express.json> {
   
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- express v5 types
  return express.json();
}

/**
 * Error handling middleware
 * Note: Express requires all 4 parameters for error middleware signature detection
 */
// eslint-disable-next-line unused-imports/no-unused-vars -- Express requires all 4 params for error middleware detection
function errorHandlerMiddleware(err: ApiError, _req: Request, res: Response, _next: () => void): void {
  const status = err.status ?? HTTP_STATUS_INTERNAL_ERROR;
  const message = err.message || "Internal server error";

  console.error(`[dashboard-api] Error ${String(status)}: ${message}`);

  const errorResponse: ErrorResponse = {
    error: status === HTTP_STATUS_INTERNAL_ERROR ? "Internal server error" : message,
    status,
  };

  res.status(status).json(errorResponse);
}

/**
 * API logging middleware
 * Broadcasts API request logs via WebSocket for dashboard monitoring
 */
function createApiLoggingMiddleware() {
  return (req: Request, res: Response, next: () => void): void => {
    // Only log API requests (skip health, static files)
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }

    const startTime = Date.now();

    // Capture request body detail before response finishes
    // For POST /api/projects/update, extract project name
    let detail: string | undefined;
    if (req.method === "POST" && req.path === "/api/projects/update") {
      const body = req.body as { projectPath?: string } | undefined;
      if (body?.projectPath) {
        // Extract just the project name (last path segment)
        const projectName = body.projectPath.split("/").pop() ?? body.projectPath;
        detail = projectName;
      }
    }

    // Use 'finish' event - works reliably across Express versions
    res.on("finish", () => {
      const responseTimeMs = Date.now() - startTime;

      const entry: ApiLogPayload = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTimeMs,
      };

      // Add error for 4xx/5xx responses
      if (res.statusCode >= 400) {
        entry.error = res.statusMessage ?? "Error";
      }

      // Add detail context if captured
      if (detail) {
        entry.detail = detail;
      }

      // Broadcast to WebSocket subscribers
      if (apiLogStreamer) {
        apiLogStreamer.broadcastApiLog(entry);
      }
    });

    next();
  };
}

/**
 * Export LogAggregatorService for direct usage
 */
export { LogAggregatorService } from "./services/log-aggregator.js";
export type {
  DiscoveredProject,
  LogFilterOptions,
  LogQueryResult,
  PaginationOptions,
  RoutingLogEntry,
  StatsResult,
} from "./services/log-aggregator.js";

/**
 * Export WebSocket server components
 */
export {
  attachWebSocketServer,
  createLogWebSocketServer,
  createStandaloneWebSocketServer,
  LogStreamer,
} from "./websocket-server.js";
export type { LogWebSocketServerResult } from "./websocket-server.js";
export type {
  BackpressureConfig,
  ConnectionMetadata,
  ErrorPayload,
  LogEventPayload,
  SessionUpdatePayload,
  WarningPayload,
  WebSocketServerConfig,
  WSClientMessage,
  WSErrorCode,
  WSServerMessage,
  WSWarningCode,
} from "../../types/websocket.js";

/**
 * Export WebSocket authentication utility
 */
export { validateWebSocketAuth } from "./middleware/ws-auth.js";