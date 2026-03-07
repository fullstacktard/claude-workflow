/**
 * WebSocket Server for Real-Time Log Streaming
 *
 * Provides WebSocket-based real-time streaming of log events from RealTimeLogMonitor
 * to dashboard clients. Features include:
 * - Session subscription management
 * - Heartbeat mechanism for connection health
 * - Backpressure handling for slow clients
 * - Connection limits per IP and total
 * - Graceful error handling
 *
 * @module websocket-server
 */

import { EventEmitter } from "node:events";
import type { Server as HTTPServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer as WsServer } from "ws";

import type { AgentCompletionStream } from "./services/agent-completion-stream.js";
import type { ActiveAgentTrackerService, ActiveAgent } from "./services/active-agent-tracker.js";

// WebSocket.OPEN is always 1 (https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState)
const WS_OPEN = 1;

/**
 * WebSocket type for Node.js ws library
 * Minimal interface for what we actually use
 */
interface WS extends EventEmitter {
  readyState: number;
  bufferedAmount: number;
  send(data: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(data?: unknown, mask?: boolean, callback?: (error?: Error) => void): void;
  on(event: "message", listener: (data: RawData) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "pong", listener: () => void): this;
  once(event: "close", listener: (code: number, reason: Buffer) => void): this;
}

/**
 * WebSocket Server type for Node.js ws library
 */
interface WSServer extends EventEmitter {
  clients: Set<WS>;
  close(callback?: (error?: Error) => void): void;
  on(event: "connection", listener: (ws: WS, request: IncomingMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WS) => void
  ): void;
}

/** WebSocket raw data type */
type RawData = Buffer | ArrayBuffer | Buffer[];

/** WebSocket ready state constants - WS_OPEN is defined at top of file */

import type { RealTimeLogMonitor } from "../analytics/real-time-log-monitor.js";
import type {
  ApiLogPayload,
  BackpressureConfig,
  ConnectionMetadata,
  CredentialUpdatedPayload,
  DockerLogPayload,
  EmailAccountUpdatedPayload,
  EmailAccountsSnapshotPayload,
  ErrorPayload,
  LogEntryPayload,
  LogEventPayload,
  SessionUpdatePayload,
  SystemLogPayload,
  WarningPayload,
  WebSocketServerConfig,
  WSClientMessage,
  WSErrorCode,
  WSServerMessage,
  WSServerMessageType,
  WSWarningCode,
  XAccountUpdatedPayload,
  XAccountsSnapshotPayload,
  XOperationProgressPayload,
} from "../../types/websocket.js";

import type { LiveLogStream, LiveLogEntry } from "./services/live-log-stream.js";

// ============================================================================
// Constants
// ============================================================================

/** Default configuration values */
const DEFAULTS = {
  /** Maximum connections per IP address */
  MAX_CONNECTIONS_PER_IP: 10,
  /** Maximum total connections */
  MAX_TOTAL_CONNECTIONS: 100,
  /** Maximum subscriptions per connection */
  MAX_SUBSCRIPTIONS_PER_CONNECTION: 20,
  /** Heartbeat interval in milliseconds */
  HEARTBEAT_INTERVAL_MS: 30_000,
  /** Heartbeat timeout in milliseconds */
  HEARTBEAT_TIMEOUT_MS: 10_000,
  /** Message buffer size per client */
  BUFFER_SIZE: 1000,
  /** Buffer warning threshold (80%) */
  WARNING_THRESHOLD: 0.8,
  /** Overflow strategy when buffer is full */
  OVERFLOW_STRATEGY: "drop-oldest" as const,
} as const;

// ============================================================================
// Log Streamer Class
// ============================================================================

/**
 * WebSocket log streaming server
 *
 * Manages WebSocket connections, subscriptions, and streams events from
 * RealTimeLogMonitor to subscribed clients.
 */
export class LogStreamer {
  private readonly wss: WSServer;
  private readonly logMonitor: RealTimeLogMonitor;
  private readonly liveStream?: LiveLogStream;
  private readonly agentCompletionStream?: AgentCompletionStream;
  private readonly activeAgentTracker?: ActiveAgentTrackerService;
  private readonly config: Required<WebSocketServerConfig>;
  private readonly backpressureConfig: BackpressureConfig;

  /** Map of WebSocket connections to their metadata */
  private readonly connections: Map<WS, ConnectionMetadata> = new Map();
  /** Map of IP addresses to their connection count */
  private readonly connectionsByIp: Map<string, Set<WS>> = new Map();
  /** Map of session IDs to subscribed connections */
  private readonly sessionSubscribers: Map<string, Set<WS>> = new Map();
  /** Set of connections subscribed to all sessions (global broadcast) */
  private readonly globalSubscribers: Set<WS> = new Set();
  /** Heartbeat interval timer */
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  /** Whether the server is shutting down */
  private isShuttingDown = false;
  /** Optional provider function for X accounts snapshot on subscribe_all */
  private xAccountsSnapshotProvider: (() => XAccountsSnapshotPayload | null) | null = null;
  /** Optional provider function for email accounts snapshot on subscribe_all */
  private emailAccountsSnapshotProvider: (() => EmailAccountsSnapshotPayload | null) | null = null;

  constructor(
    wss: WSServer,
    logMonitor: RealTimeLogMonitor,
    liveStream: LiveLogStream | undefined = undefined,
    agentCompletionStream: AgentCompletionStream | undefined = undefined,
    activeAgentTracker: ActiveAgentTrackerService | undefined = undefined,
    config: WebSocketServerConfig = {}
  ) {
    this.wss = wss;
    this.logMonitor = logMonitor;
    this.liveStream = liveStream;
    this.agentCompletionStream = agentCompletionStream;
    this.activeAgentTracker = activeAgentTracker;

    // Merge config with defaults
    this.config = {
      heartbeatInterval: config.heartbeatInterval ?? DEFAULTS.HEARTBEAT_INTERVAL_MS,
      heartbeatTimeout: config.heartbeatTimeout ?? DEFAULTS.HEARTBEAT_TIMEOUT_MS,
      maxConnectionsPerIp: config.maxConnectionsPerIp ?? DEFAULTS.MAX_CONNECTIONS_PER_IP,
      maxSubscriptionsPerConnection:
        config.maxSubscriptionsPerConnection ?? DEFAULTS.MAX_SUBSCRIPTIONS_PER_CONNECTION,
      maxTotalConnections: config.maxTotalConnections ?? DEFAULTS.MAX_TOTAL_CONNECTIONS,
      backpressure: config.backpressure ?? {},
    };

    // Merge backpressure config with defaults
    this.backpressureConfig = {
      bufferSize: config.backpressure?.bufferSize ?? DEFAULTS.BUFFER_SIZE,
      overflowStrategy: config.backpressure?.overflowStrategy ?? DEFAULTS.OVERFLOW_STRATEGY,
      warningThreshold: config.backpressure?.warningThreshold ?? DEFAULTS.WARNING_THRESHOLD,
    };

    this.setupWebSocketHandlers();
    this.setupLogMonitorHandlers();
    if (this.liveStream) {
      this.setupLiveLogStreamHandlers();
    }
    this.startHeartbeat();
  }

  /**
   * Get the number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get the number of connections for a specific IP
   */
  getConnectionCountByIp(ip: string): number {
    return this.connectionsByIp.get(ip)?.size ?? 0;
  }

  /**
   * Get the number of subscribers for a session
   */
  getSubscriberCount(sessionId: string): number {
    return this.sessionSubscribers.get(sessionId)?.size ?? 0;
  }

  /**
   * Gracefully close all connections and clean up resources
   */
  async close(): Promise<void> {
    // Guard against double-close
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    // Stop heartbeat
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // Close all connections
    const closePromises: Promise<void>[] = [];
    for (const ws of this.connections.keys()) {
      closePromises.push(this.closeConnection(ws, 1001, "Server shutting down"));
    }
    await Promise.all(closePromises);

    // Clear all maps and sets
    this.connections.clear();
    this.connectionsByIp.clear();
    this.sessionSubscribers.clear();
    this.globalSubscribers.clear();

    // Close WebSocket server
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err?: Error) => {
        if (err) {
          // Ignore "not running" error - server may already be closed
          if (err.message.includes("not running")) {
            resolve();
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  }

  // ==========================================================================
  // Private: Setup Handlers
  // ==========================================================================

  /**
   * Setup WebSocket server event handlers
   */
  private setupWebSocketHandlers(): void {
    this.wss.on("connection", (ws: WS, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.wss.on("error", (error: Error) => {
      console.error("[websocket-server] Server error:", error);
    });
  }

  /**
   * Setup RealTimeLogMonitor event handlers
   */
  private setupLogMonitorHandlers(): void {
    // Tool call events
    this.logMonitor.on("tool-call", (event) => {
      const payload: LogEventPayload = {
        data: event,
        eventType: "tool-call",
      };
      this.broadcastToSession(event.sessionId, "log", payload);
    });

    // Token update events
    this.logMonitor.on("token-update", (event) => {
      const payload: LogEventPayload = {
        data: event,
        eventType: "token-update",
      };
      this.broadcastToSession(event.sessionId, "log", payload);
    });

    // Routing decision events
    this.logMonitor.on("routing-decision", (event) => {
      const payload: LogEventPayload = {
        data: event,
        eventType: "routing-decision",
      };
      this.broadcastToSession(event.sessionId, "log", payload);
    });

    // Session lifecycle events
    this.logMonitor.on("session-start", (event) => {
      const payload: SessionUpdatePayload = { status: "started" };
      this.broadcastToSession(event.sessionId, "session-update", payload);
    });

    this.logMonitor.on("session-end", (event) => {
      const payload: SessionUpdatePayload = { status: "ended" };
      this.broadcastToSession(event.sessionId, "session-update", payload);
    });
  }

  /**
   * Setup LiveLogStream event handlers
   *
   * Bridges the gap between LiveLogStream (watches routing logs) and WebSocket server.
   * Emits log-entry events to all global subscribers for the dashboard activity feed.
   */
  private setupLiveLogStreamHandlers(): void {
    if (!this.liveStream) {
      return;
    }

    // Log entry events from LiveLogStream (routing decision logs)
    this.liveStream.on("log-entry", (entry: LiveLogEntry) => {
      // Broadcast to all global subscribers (dashboard live feed)
      this.broadcastLogEntry(entry);
    });

    // Handle errors from LiveLogStream
    this.liveStream.on("error", (error: Error, project: string) => {
      console.error(`[websocket-server] LiveLogStream error for ${project}:`, error.message);
    });
  }

  // ==========================================================================
  // Private: Connection Management
  // ==========================================================================

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WS, req: IncomingMessage): void {
    const ip = this.extractIp(req);

    // Check connection limits
    if (!this.checkConnectionLimits(ws, ip)) {
      return;
    }

    // Initialize connection metadata
    const metadata: ConnectionMetadata = {
      bufferWarningActive: false,
      ip,
      isAlive: true,
      lastActivity: Date.now(),
      messageBuffer: [],
      subscriptions: new Set(),
    };

    this.connections.set(ws, metadata);

    // Track by IP
    if (!this.connectionsByIp.has(ip)) {
      this.connectionsByIp.set(ip, new Set());
    }
    this.connectionsByIp.get(ip)!.add(ws);

    console.log(
      `[websocket-server] Connection opened from ${ip} (total: ${this.connections.size})`
    );

    // Setup connection event handlers
    ws.on("message", (data: RawData) => {
      this.handleMessage(ws, data);
    });

    ws.on("close", () => {
      this.handleDisconnect(ws);
    });

    ws.on("error", (error: Error) => {
      console.error(`[websocket-server] Connection error from ${ip}:`, error.message);
      this.handleDisconnect(ws);
    });

    ws.on("pong", () => {
      const meta = this.connections.get(ws);
      if (meta) {
        meta.isAlive = true;
        meta.lastActivity = Date.now();
      }
    });
  }

  /**
   * Check if connection should be accepted based on limits
   */
  private checkConnectionLimits(ws: WS, ip: string): boolean {
    // Check total connection limit
    if (this.connections.size >= this.config.maxTotalConnections) {
      this.sendErrorAndClose(ws, "CONNECTION_LIMIT", "Maximum total connections exceeded");
      return false;
    }

    // Check per-IP connection limit
    const ipConnections = this.connectionsByIp.get(ip)?.size ?? 0;
    if (ipConnections >= this.config.maxConnectionsPerIp) {
      this.sendErrorAndClose(
        ws,
        "CONNECTION_LIMIT",
        `Maximum connections per IP exceeded (${this.config.maxConnectionsPerIp})`
      );
      return false;
    }

    return true;
  }

  /**
   * Handle connection disconnect
   */
  private handleDisconnect(ws: WS): void {
    const metadata = this.connections.get(ws);
    if (metadata === undefined) {
      return;
    }

    // Clear heartbeat timeout if exists
    if (metadata.heartbeatTimeout !== undefined) {
      clearTimeout(metadata.heartbeatTimeout);
    }

    // Remove from global subscribers
    this.globalSubscribers.delete(ws);

    // Remove from all session subscriptions
    for (const sessionId of metadata.subscriptions) {
      const subscribers = this.sessionSubscribers.get(sessionId);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          this.sessionSubscribers.delete(sessionId);
        }
      }
    }

    // Remove from IP tracking
    const ipConnections = this.connectionsByIp.get(metadata.ip);
    if (ipConnections) {
      ipConnections.delete(ws);
      if (ipConnections.size === 0) {
        this.connectionsByIp.delete(metadata.ip);
      }
    }

    // Remove from connections
    this.connections.delete(ws);

    console.log(
      `[websocket-server] Connection closed from ${metadata.ip} (total: ${this.connections.size})`
    );
  }

  /**
   * Close a connection with optional code and reason
   */
  private closeConnection(ws: WS, code = 1000, reason = ""): Promise<void> {
    return new Promise((resolve) => {
      // WebSocket ready states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.once("close", () => {
          resolve();
        });
        ws.close(code, reason);
      } else {
        resolve();
      }
    });
  }

  /**
   * Extract client IP from request
   */
  private extractIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  // ==========================================================================
  // Private: Message Handling
  // ==========================================================================

  /**
   * Handle incoming message from client
   */
  private handleMessage(ws: WS, data: RawData): void {
    const metadata = this.connections.get(ws);
    if (metadata === undefined) {
      return;
    }

    // Update activity timestamp
    metadata.lastActivity = Date.now();

    // Parse message
    let message: WSClientMessage;
    try {
      // Convert RawData to string safely
      let dataString: string;
      if (typeof data === "string") {
        dataString = data;
      } else if (Buffer.isBuffer(data)) {
        dataString = data.toString("utf8");
      } else if (Array.isArray(data)) {
        // Buffer[] - concatenate all buffers
        dataString = Buffer.concat(data).toString("utf8");
      } else {
        // ArrayBuffer
        dataString = Buffer.from(data).toString("utf8");
      }
      message = JSON.parse(dataString) as WSClientMessage;
    } catch {
      this.sendError(ws, "INVALID_MESSAGE", "Invalid JSON message");
      return;
    }

    // Validate message structure
    if (typeof message.type !== "string") {
      this.sendError(ws, "INVALID_MESSAGE", "Message must have a 'type' field");
      return;
    }

    // Handle message by type
    switch (message.type) {
    case "subscribe": {
      this.handleSubscribe(ws, metadata, message.sessionId);
      break;
    }
    case "unsubscribe": {
      this.handleUnsubscribe(ws, metadata, message.sessionId);
      break;
    }
    case "ping": {
      this.handlePing(ws);
      break;
    }
    case "subscribe_all": {
      this.handleSubscribeAll(ws);
      break;
    }
    case "unsubscribe_all": {
      this.handleUnsubscribeAll(ws);
      break;
    }
    default: {
      this.sendError(ws, "INVALID_MESSAGE", `Unknown message type: ${String(message.type)}`);
    }
    }
  }

  /**
   * Handle subscribe message
   */
  private handleSubscribe(
    ws: WS,
    metadata: ConnectionMetadata,
    sessionId: string | undefined
  ): void {
    // Validate session ID
    if (!sessionId || typeof sessionId !== "string") {
      this.sendError(
        ws,
        "INVALID_SESSION_ID",
        "Session ID is required for subscribe"
      );
      return;
    }

    // Validate session ID format (should be like "session-1234567890")
    if (!this.isValidSessionId(sessionId)) {
      this.sendError(
        ws,
        "INVALID_SESSION_ID",
        `Invalid session ID format: ${sessionId}. Expected: session-{timestamp}`
      );
      return;
    }

    // Check subscription limit
    if (metadata.subscriptions.size >= this.config.maxSubscriptionsPerConnection) {
      this.sendError(
        ws,
        "SUBSCRIPTION_LIMIT",
        `Maximum subscriptions per connection exceeded (${this.config.maxSubscriptionsPerConnection})`
      );
      return;
    }

    // Already subscribed? Just confirm
    if (metadata.subscriptions.has(sessionId)) {
      this.send(ws, { sessionId, timestamp: new Date().toISOString(), type: "subscribed" });
      return;
    }

    // Add subscription
    metadata.subscriptions.add(sessionId);

    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set());
    }
    this.sessionSubscribers.get(sessionId)!.add(ws);

    // Confirm subscription
    this.send(ws, { sessionId, timestamp: new Date().toISOString(), type: "subscribed" });

    console.log(
      `[websocket-server] Client subscribed to session ${sessionId} (subscribers: ${this.sessionSubscribers.get(sessionId)!.size})`
    );
  }

  /**
   * Handle unsubscribe message
   */
  private handleUnsubscribe(
    ws: WS,
    metadata: ConnectionMetadata,
    sessionId: string | undefined
  ): void {
    // Validate session ID
    if (!sessionId || typeof sessionId !== "string") {
      this.sendError(
        ws,
        "INVALID_SESSION_ID",
        "Session ID is required for unsubscribe"
      );
      return;
    }

    // Remove subscription
    metadata.subscriptions.delete(sessionId);

    const subscribers = this.sessionSubscribers.get(sessionId);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.sessionSubscribers.delete(sessionId);
      }
    }

    // Confirm unsubscription
    this.send(ws, { sessionId, timestamp: new Date().toISOString(), type: "unsubscribed" });

    console.log(`[websocket-server] Client unsubscribed from session ${sessionId}`);
  }

  /**
   * Handle ping message
   */
  private handlePing(ws: WS): void {
    this.send(ws, { timestamp: new Date().toISOString(), type: "pong" });
  }

  /**
   * Handle subscribe_all message - subscribe to ALL sessions (global broadcast)
   *
   * Sends recent logs from LiveLogStream cache on initial subscription (AC #7).
   */
  private handleSubscribeAll(ws: WS): void {
    this.globalSubscribers.add(ws);
    this.send(ws, { timestamp: new Date().toISOString(), type: "subscribed_all" });
    console.log(`[websocket-server] Client subscribed to all sessions (global subscribers: ${this.globalSubscribers.size})`);

    // Send recent logs from LiveLogStream cache on initial connection
    // This ensures dashboard shows existing logs immediately, not just new ones
    if (this.liveStream) {
      const recentLogs = this.liveStream.getRecentLogs(100);
      for (const log of recentLogs) {
        this.send(ws, {
          timestamp: new Date().toISOString(),
          type: "log_entry",
          payload: {
            timestamp: log.timestamp,
            projectName: log.projectName ?? log.project,
            sessionNumber: log.sessionNumber ?? 0,
            type: log.type ?? "routing-decision",
            agent: log.agent,
            skill: log.skill,
            agentContext: log.agentContext,
            confidence: log.confidence,
            followed: log.followed,
            recommendationId: log.recommendationId,
            mcpServer: log.mcpServer,
            mcpTool: log.mcpTool,
            // Agent completion fields (for agent_completion type)
            agentType: log.agentType,
            status: log.status,
            totalTokens: log.totalTokens,
            totalDurationMs: log.totalDurationMs,
            totalToolUseCount: log.totalToolUseCount,
            // Session context tokens (cumulative usage for this session)
            sessionContextTokens: log.sessionContextTokens,
          } as LogEntryPayload,
        });
      }
      console.log(`[websocket-server] Sent ${recentLogs.length} recent logs to new subscriber`);
    }

    // Send recent agent completions from AgentCompletionStream cache
    // This ensures dashboard shows existing completions immediately
    if (this.agentCompletionStream) {
      const recentCompletions = this.agentCompletionStream.getRecentCompletions(50);
      for (const completion of recentCompletions) {
        this.send(ws, {
          timestamp: new Date().toISOString(),
          type: "agent_completion",
          payload: {
            timestamp: completion.timestamp,
            projectName: completion.projectName,
            sessionId: completion.sessionId,
            agentId: completion.agentId,
            agentType: completion.agentType,
            status: completion.status,
            totalTokens: completion.totalTokens,
            totalDurationMs: completion.totalDurationMs,
            totalToolUseCount: completion.totalToolUseCount,
            usage: completion.usage,
          },
        });
      }
      console.log(`[websocket-server] Sent ${recentCompletions.length} recent completions to new subscriber`);
    }

    // Send currently active agents from ActiveAgentTrackerService
    // This enables the visualization to seed with in-progress agents immediately
    if (this.activeAgentTracker) {
      const activeAgents = this.activeAgentTracker.getActiveAgents();
      this.send(ws, {
        timestamp: new Date().toISOString(),
        type: "active_agents",
        payload: {
          agents: activeAgents.map((agent: ActiveAgent) => ({
            agentId: agent.agentId,
            agentType: agent.agentType,
            projectName: agent.projectName,
            sessionId: agent.sessionId,
            spawnedAt: agent.spawnedAt,
          })),
        },
      });
      console.log(`[websocket-server] Sent ${activeAgents.length} active agents to new subscriber`);
    }

    // Send current X accounts snapshot for real-time account fleet view
    if (this.xAccountsSnapshotProvider) {
      const snapshot = this.xAccountsSnapshotProvider();
      if (snapshot && snapshot.accounts.length > 0) {
        this.send(ws, {
          timestamp: new Date().toISOString(),
          type: "x_accounts_snapshot",
          payload: snapshot,
        });
        console.log(
          `[websocket-server] Sent ${snapshot.accounts.length} X accounts to new subscriber`
        );
      }
    }

    // Send current email accounts snapshot for real-time email account view
    if (this.emailAccountsSnapshotProvider) {
      const emailSnapshot = this.emailAccountsSnapshotProvider();
      if (emailSnapshot && emailSnapshot.accounts.length > 0) {
        this.send(ws, {
          timestamp: new Date().toISOString(),
          type: "email_accounts_snapshot",
          payload: emailSnapshot,
        });
        console.log(
          `[websocket-server] Sent ${emailSnapshot.accounts.length} email accounts to new subscriber`
        );
      }
    }
  }

  /**
   * Handle unsubscribe_all message
   */
  private handleUnsubscribeAll(ws: WS): void {
    this.globalSubscribers.delete(ws);
    this.send(ws, { timestamp: new Date().toISOString(), type: "unsubscribed_all" });
    console.log("[websocket-server] Client unsubscribed from all sessions");
  }

  /**
   * Validate session ID format
   */
  private isValidSessionId(sessionId: string): boolean {
    // Accept session-{digits} or session-{word}-{digits} format
    return /^session-[\w-]+$/i.test(sessionId);
  }

  // ==========================================================================
  // Private: Sending Messages
  // ==========================================================================

  /**
   * Send a message to a WebSocket client with backpressure handling
   */
  private send(ws: WS, message: WSServerMessage): void {
    if (ws.readyState !== WS_OPEN) {
      return;
    }

    const metadata = this.connections.get(ws);
    if (metadata === undefined) {
      return;
    }

    // Check if we need to buffer (WebSocket is backing up)
    if (ws.bufferedAmount > 0) {
      this.bufferMessage(ws, metadata, message);
      return;
    }

    // Try to send any buffered messages first
    this.drainBuffer(ws, metadata);

    // Send the current message
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("[websocket-server] Send error:", (error as Error).message);
    }
  }

  /**
   * Send a pre-serialized message to a WebSocket client with backpressure handling.
   * Used by broadcast methods to avoid serializing the same message N times for N clients.
   *
   * @param ws - WebSocket client
   * @param serialized - Pre-serialized JSON string
   * @param message - Original message object (for buffering if needed)
   */
  private sendPreSerialized(ws: WS, serialized: string, message: WSServerMessage): void {
    if (ws.readyState !== WS_OPEN) {
      return;
    }

    const metadata = this.connections.get(ws);
    if (metadata === undefined) {
      return;
    }

    // Check if we need to buffer (WebSocket is backing up)
    if (ws.bufferedAmount > 0) {
      // Buffer the original object for later serialization
      this.bufferMessage(ws, metadata, message);
      return;
    }

    // Try to send any buffered messages first
    this.drainBuffer(ws, metadata);

    // Send the pre-serialized message
    try {
      ws.send(serialized);
    } catch (error) {
      console.error("[websocket-server] Send error:", (error as Error).message);
    }
  }

  /**
   * Buffer a message for later delivery
   */
  private bufferMessage(
    ws: WS,
    metadata: ConnectionMetadata,
    message: WSServerMessage
  ): void {
    const buffer = metadata.messageBuffer;
    const maxSize = this.backpressureConfig.bufferSize;
    const warningThreshold = Math.floor(maxSize * this.backpressureConfig.warningThreshold);

    // Check if buffer is at warning threshold
    if (buffer.length >= warningThreshold && !metadata.bufferWarningActive) {
      metadata.bufferWarningActive = true;
      const warningPayload: WarningPayload = {
        code: "BUFFER_NEAR_CAPACITY" satisfies WSWarningCode,
        message: `Message buffer at ${Math.round((buffer.length / maxSize) * 100)}% capacity. Consider reducing subscription scope.`,
      };
      try {
        ws.send(JSON.stringify({
          payload: warningPayload,
          timestamp: new Date().toISOString(),
          type: "warning",
        } satisfies WSServerMessage));
      } catch {
        // Ignore send errors for warning
      }
    }

    // Apply overflow strategy if buffer is full
    if (buffer.length >= maxSize) {
      switch (this.backpressureConfig.overflowStrategy) {
      case "drop-oldest": {
        buffer.shift();
        buffer.push(message);
        break;
      }
      case "drop-newest": {
        // Don't add the new message
        break;
      }
      case "disconnect": {
        this.sendErrorAndClose(
          ws,
          "INTERNAL_ERROR",
          "Message buffer exhausted, connection closed"
        );
        return;
      }
      }
    } else {
      buffer.push(message);
    }
  }

  /**
   * Drain buffered messages to client
   */
  private drainBuffer(ws: WS, metadata: ConnectionMetadata): void {
    if (ws.readyState !== WS_OPEN) {
      return;
    }

    while (metadata.messageBuffer.length > 0 && ws.bufferedAmount === 0) {
      const message = metadata.messageBuffer.shift();
      if (message) {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          // Put message back if send fails
          metadata.messageBuffer.unshift(message);
          break;
        }
      }
    }

    // Reset warning flag if buffer is below threshold
    const warningThreshold = Math.floor(
      this.backpressureConfig.bufferSize * this.backpressureConfig.warningThreshold
    );
    if (metadata.messageBuffer.length < warningThreshold) {
      metadata.bufferWarningActive = false;
    }
  }

  /**
   * Send an error message to client
   */
  private sendError(ws: WS, code: WSErrorCode, message: string): void {
    const payload: ErrorPayload = {
      code,
      message,
      recoverable: code !== "CONNECTION_LIMIT",
    };
    this.send(ws, {
      payload,
      timestamp: new Date().toISOString(),
      type: "error",
    });
  }

  /**
   * Send an error message and close the connection
   */
  private sendErrorAndClose(ws: WS, code: WSErrorCode, message: string): void {
    const payload: ErrorPayload = {
      code,
      message,
      recoverable: false,
    };
    const errorMessage: WSServerMessage = {
      payload,
      timestamp: new Date().toISOString(),
      type: "error",
    };

    try {
      ws.send(JSON.stringify(errorMessage), () => {
        ws.close(1008, message);
      });
    } catch {
      ws.close(1008, message);
    }
  }

  /**
   * Broadcast a message to all subscribers of a session AND global subscribers
   */
  private broadcastToSession(
    sessionId: string,
    type: "log" | "session-update",
    payload: LogEventPayload | SessionUpdatePayload
  ): void {
    const message: WSServerMessage = {
      payload,
      sessionId,
      timestamp: new Date().toISOString(),
      type,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Send to session-specific subscribers
    const subscribers = this.sessionSubscribers.get(sessionId);
    if (subscribers !== undefined) {
      for (const ws of subscribers) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }

    // Send to global subscribers (dashboard live feed)
    for (const ws of this.globalSubscribers) {
      // Don't double-send if also subscribed to specific session
      if (subscribers === undefined || !subscribers.has(ws)) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }
  }

  /**
   * Broadcast a log entry from LiveLogStream to all global subscribers
   *
   * Called by LiveLogStream when new routing log entries are detected.
   * Transforms LiveLogEntry format to WebSocket message format.
   *
   * @param entry - The log entry to broadcast from LiveLogStream
   */
  public broadcastLogEntry(entry: LiveLogEntry): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    // Create log_entry message compatible with frontend expectations
    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "log_entry",
      payload: {
        timestamp: entry.timestamp,
        projectName: entry.projectName ?? entry.project,
        sessionNumber: entry.sessionNumber ?? 0,
        type: entry.type ?? "routing-decision",
        agent: entry.agent,
        skill: entry.skill,
        agentContext: entry.agentContext,
        confidence: entry.confidence,
        followed: entry.followed,
        recommendationId: entry.recommendationId,
        mcpServer: entry.mcpServer,
        mcpTool: entry.mcpTool,
        // Agent completion fields (for agent_completion type)
        agentType: entry.agentType,
        status: entry.status,
        totalTokens: entry.totalTokens,
        totalDurationMs: entry.totalDurationMs,
        totalToolUseCount: entry.totalToolUseCount,
        // Session context tokens (cumulative usage for this session)
        sessionContextTokens: entry.sessionContextTokens,
      } as LogEntryPayload,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }

    // Log broadcast for debugging (remove or reduce verbosity in production)
    console.debug(
      `[websocket-server] Broadcast log_entry from ${entry.project} to ${this.globalSubscribers.size} subscribers`
    );

    // Debug: Log full payload for agent_completion types
    if (entry.type === "agent_completion") {
      console.log("[websocket-server] Agent completion payload:", JSON.stringify(message.payload, null, 2));
    }
  }

  /**
   * Broadcast a Docker log entry to all global subscribers
   *
   * Called by DockerLogStreamService when new container log entries are detected.
   *
   * @param entry - The Docker log entry to broadcast
   */
  public broadcastDockerLog(entry: DockerLogPayload): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    // Create docker_log message compatible with frontend expectations
    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "docker_log",
      payload: entry,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }
  }

  /**
   * Generic broadcast for CLI login and other uses
   *
   * Called by cli-login.ts for broadcasting CLI output and events.
   *
   * @param message - Message to broadcast with type and payload
   */
  public broadcast(message: {
    type: WSServerMessageType;
    payload: unknown;
  }): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      console.log(`[websocket-server] No global subscribers for ${message.type} broadcast`);
      return;
    }

    const wsMessage: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: message.type,
      payload: message.payload as WSServerMessage["payload"],
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(wsMessage);

    // Log broadcast for agent_completion type
    if (message.type === "agent_completion") {
      console.log(`[websocket-server] Broadcasting agent_completion to ${this.globalSubscribers.size} global subscribers`);
    }

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, wsMessage);
      }
    }
  }

  /**
   * Broadcast credential update to all global subscribers
   *
   * Called when CliCredentialWatcher syncs credentials from CLI login.
   * Enables frontend to auto-refresh account list when user logs in via Claude CLI.
   *
   * @param payload - Credential update payload with account details
   */
  public broadcastCredentialUpdate(payload: CredentialUpdatedPayload): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    // Create credentials_updated message compatible with frontend expectations
    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "credentials_updated",
      payload,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }

    console.log(
      `[websocket-server] Broadcast credential update: ${payload.action} account ${payload.email}`
    );
  }

  /**
   * Set the provider function for X accounts snapshot.
   * Called from server.ts after XVaultWatcher is initialized.
   * The provider is invoked during handleSubscribeAll to send initial account state.
   */
  public setXAccountsSnapshotProvider(
    provider: () => XAccountsSnapshotPayload | null
  ): void {
    this.xAccountsSnapshotProvider = provider;
  }

  /**
   * Broadcast an X account state change to all global subscribers.
   * Called by XVaultWatcher (file changes) and API routes (direct mutations).
   *
   * @param payload - The account update payload
   */
  public broadcastXAccountUpdate(payload: XAccountUpdatedPayload): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "x_account_updated",
      payload,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }

    console.log(
      `[websocket-server] Broadcast X account update: ${payload.changeSource} for @${payload.handle}`
    );
  }

  /**
   * Set the provider function for email accounts snapshot.
   * Called from server.ts after EmailVaultWatcher is initialized.
   * The provider is invoked during handleSubscribeAll to send initial account state.
   */
  public setEmailAccountsSnapshotProvider(
    provider: () => EmailAccountsSnapshotPayload | null
  ): void {
    this.emailAccountsSnapshotProvider = provider;
  }

  /**
   * Broadcast an email account state change to all global subscribers.
   * Called by EmailVaultWatcher (file changes) and API routes (direct mutations).
   *
   * @param payload - The email account update payload
   */
  public broadcastEmailAccountUpdate(payload: EmailAccountUpdatedPayload): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "email_account_updated",
      payload,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }

    console.log(
      `[websocket-server] Broadcast email account update: ${payload.changeSource} for ${payload.email}`
    );
  }

  /**
   * Broadcast X operation progress to all global subscribers.
   * Called by the HTTP bridge endpoint (POST /api/x/operations/progress).
   *
   * @param payload - The operation progress payload
   */
  public broadcastXOperationProgress(payload: XOperationProgressPayload): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "x_operation_progress",
      payload,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }
  }

  /**
   * Broadcast API log entry to all global subscribers
   *
   * Called by API logging middleware to stream dashboard API request logs.
   * Enables frontend to show real-time API activity for debugging.
   *
   * @param entry - The API log entry to broadcast
   */
  public broadcastApiLog(entry: ApiLogPayload): void {
    
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    // Create api_log message compatible with frontend expectations
    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "api_log",
      payload: entry,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }
  }

  /**
   * Broadcast system log entry to all global subscribers
   *
   * Called by account management services (AccountManager, UsageMonitor,
   * CredentialSyncService, CliCredentialWatcher) to stream operational logs.
   * Enables frontend to show real-time system activity for debugging.
   *
   * @param entry - The system log entry to broadcast
   */
  public broadcastSystemLog(entry: SystemLogPayload): void {
    // Skip if no subscribers to avoid unnecessary processing
    if (this.globalSubscribers.size === 0) {
      return;
    }

    // Create system_log message compatible with frontend expectations
    const message: WSServerMessage = {
      timestamp: new Date().toISOString(),
      type: "system_log",
      payload: entry,
    };

    // Pre-serialize once for all clients
    const serialized = JSON.stringify(message);

    // Broadcast to all global subscribers
    for (const ws of this.globalSubscribers) {
      if (ws.readyState === WS_OPEN) {
        this.sendPreSerialized(ws, serialized, message);
      }
    }
  }

  // ==========================================================================
  // Private: Heartbeat
  // ==========================================================================

  /**
   * Start heartbeat interval for connection health checking
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeat();
    }, this.config.heartbeatInterval);
  }

  /**
   * Perform heartbeat check on all connections
   */
  private performHeartbeat(): void {
    if (this.isShuttingDown) {
      return;
    }

    for (const [ws, metadata] of this.connections.entries()) {
      if (!metadata.isAlive) {
        // Connection didn't respond to last ping, terminate it
        console.log(`[websocket-server] Terminating unresponsive connection from ${metadata.ip}`);
        ws.terminate();
        this.handleDisconnect(ws);
        continue;
      }

      // Mark as not alive, will be set back to true on pong
      metadata.isAlive = false;

      // Send ping
      if (ws.readyState === WS_OPEN) {
        ws.ping();
      }
    }
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for createLogWebSocketServer factory
 */
export interface LogWebSocketServerResult {
  /** The LogStreamer instance for broadcasting events */
  logStreamer: LogStreamer;
  /**
   * Upgrade handler callback for the centralized dispatcher.
   * Call this when a /ws/logs upgrade request is received.
   */
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a WebSocket server for log streaming WITHOUT registering an upgrade listener.
 *
 * Returns a handleUpgrade callback that the caller (centralized upgrade dispatcher)
 * must invoke for /ws/logs upgrade requests. This follows the ws library's documented
 * pattern for multiple WebSocket servers sharing a single HTTP server.
 *
 * @param logMonitor - RealTimeLogMonitor instance for event streaming
 * @param liveStream - LiveLogStream instance for routing log file watching
 * @param agentCompletionStream - AgentCompletionStream for agent completion events
 * @param activeAgentTracker - ActiveAgentTrackerService for tracking in-progress agents
 * @param config - WebSocket server configuration
 * @returns Object with logStreamer and handleUpgrade callback
 *
 * @example
 * ```typescript
 * const { logStreamer, handleUpgrade } = createLogWebSocketServer(logMonitor);
 *
 * server.on("upgrade", (req, socket, head) => {
 *   const pathname = new URL(req.url ?? "", `http://${req.headers.host}`).pathname;
 *   if (pathname === "/ws/logs") {
 *     handleUpgrade(req, socket, head);
 *   } else {
 *     socket.destroy();
 *   }
 * });
 * ```
 */
export function createLogWebSocketServer(
  logMonitor: RealTimeLogMonitor,
  liveStream: LiveLogStream | undefined = undefined,
  agentCompletionStream: AgentCompletionStream | undefined = undefined,
  activeAgentTracker: ActiveAgentTrackerService | undefined = undefined,
  config: WebSocketServerConfig = {}
): LogWebSocketServerResult {
  const wss = new WsServer({
    noServer: true,
  }) as unknown as WSServer;

  const logStreamer = new LogStreamer(
    wss,
    logMonitor,
    liveStream,
    agentCompletionStream,
    activeAgentTracker,
    config
  );

  return {
    logStreamer,
    handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      wss.handleUpgrade(request, socket, head, (ws: WS) => {
        wss.emit("connection", ws, request);
      });
    },
  };
}

/**
 * Attach WebSocket server to an existing HTTP server.
 *
 * BACKWARD-COMPATIBLE WRAPPER: This function registers its own upgrade handler
 * on the HTTP server. For new code using a centralized upgrade dispatcher,
 * prefer createLogWebSocketServer() instead.
 *
 * @param httpServer - HTTP server instance to attach to
 * @param logMonitor - RealTimeLogMonitor instance for event streaming
 * @param liveStream - LiveLogStream instance for routing log file watching
 * @param agentCompletionStream - AgentCompletionStream for agent completion events
 * @param activeAgentTracker - ActiveAgentTrackerService for tracking in-progress agents
 * @param config - WebSocket server configuration
 * @returns LogStreamer instance
 *
 * @deprecated Use createLogWebSocketServer() with a centralized upgrade handler instead.
 *
 * @example
 * ```typescript
 * import { createServer } from 'http';
 * import { RealTimeLogMonitor } from './analytics/real-time-log-monitor.js';
 * import { attachWebSocketServer } from './dashboard/websocket-server.js';
 *
 * const httpServer = createServer();
 * const logMonitor = new RealTimeLogMonitor();
 *
 * const logStreamer = attachWebSocketServer(httpServer, logMonitor, {
 *   maxConnectionsPerIp: 10,
 *   heartbeatInterval: 30000,
 * });
 *
 * httpServer.listen(3850);
 * ```
 */
export function attachWebSocketServer(
  httpServer: HTTPServer,
  logMonitor: RealTimeLogMonitor,
  liveStream: LiveLogStream | undefined = undefined,
  agentCompletionStream: AgentCompletionStream | undefined = undefined,
  activeAgentTracker: ActiveAgentTrackerService | undefined = undefined,
  config: WebSocketServerConfig = {}
): LogStreamer {
  const { logStreamer, handleUpgrade: upgradeHandler } = createLogWebSocketServer(
    logMonitor,
    liveStream,
    agentCompletionStream,
    activeAgentTracker,
    config
  );

  // Register upgrade handler for /ws/logs path (backward-compatible behavior)
  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "", `http://${request.headers.host}`).pathname;

    if (pathname === "/ws/logs") {
      upgradeHandler(request, socket, head);
    }
    // Let other upgrade handlers process non-matching paths
    // (same behavior as original implementation)
  });

  return logStreamer;
}

/**
 * Create a standalone WebSocket server (for testing)
 *
 * @param port - Port to listen on
 * @param logMonitor - RealTimeLogMonitor instance for event streaming
 * @param config - WebSocket server configuration
 * @returns Object with LogStreamer and close function
 */
export function createStandaloneWebSocketServer(
  port: number,
  logMonitor: RealTimeLogMonitor,
  config: WebSocketServerConfig = {}
): { logStreamer: LogStreamer; close: () => Promise<void> } {

  const wss = new WsServer({ path: "/ws/logs", port }) as unknown as WSServer;

  const logStreamer = new LogStreamer(wss, logMonitor, undefined, undefined, undefined, config);

  return {
    close: () => logStreamer.close(),
    logStreamer,
  };
}

/**
 * Handle WebSocket upgrade request manually (for custom routing)
 *
 * @param wss - WebSocket server instance
 * @param request - HTTP upgrade request
 * @param socket - Duplex socket
 * @param head - Buffer containing first packet
 */
export function handleUpgrade(
  wss: WSServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  wss.handleUpgrade(request, socket, head, (ws: WS) => {
    wss.emit("connection", ws, request);
  });
}