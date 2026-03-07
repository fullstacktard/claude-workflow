/**
 * TypeScript type definitions for Session Management
 * Used by SessionDataService and session-related widgets
 */

/**
 * Session data change event
 */
export interface SessionDataUpdate {
  /** Session ID affected */
  sessionId: string;
  /** New/updated session info (not present for 'removed' events) */
  sessionInfo?: SessionInfo;
  /** Type of change */
  type: "added" | "removed" | "updated";
}

/**
 * Event handler function signature for session events
 */
export type SessionEventHandler = (sessionId: string) => void;

/**
 * Complete session information
 */
export interface SessionInfo {
  /** Human-readable elapsed time (e.g., "2h 15m") */
  elapsedTime: string;
  /** Unique session identifier (e.g., session-1234567890-abc) */
  id: string;
  /** Absolute path to session log directory */
  logPath: string;
  /** Project name derived from project path */
  projectName: string;
  /** Absolute path to project directory */
  projectPath: string;
  /** Session start timestamp */
  startTime: Date;
  /** Current session status */
  status: SessionStatus;
}

/**
 * Simplified session data for list display
 */
export interface SessionListItem {
  /** Human-readable elapsed time */
  elapsedTime: string;
  /** Unique session identifier */
  id: string;
  /** Project name */
  projectName: string;
  /** Current session status */
  status: SessionStatus;
}

/**
 * Session status enumeration
 */
export type SessionStatus = "active" | "error" | "paused";
