/**
 * Socket-aware tmux client for the dashboard Docker container.
 *
 * Wraps tmux CLI commands with the `-S` socket flag for accessing the host
 * tmux server via the mounted Unix domain socket. When `TMUX_SOCKET` is not
 * set, falls back to the default tmux socket (for local development).
 *
 * Mirrors the tmux-client.ts and session-actions.ts APIs from the
 * tmux-manager package but adds the socket path injection.
 *
 * @see docs/research/tmux-manager-code-reuse-api-design.md Finding 5
 */

import { execSync } from "node:child_process";

import {
  type ActionResult,
  type TmuxSession,
  sanitizeTmuxSessionName,
  upsertManifestEntry,
  removeManifestEntry,
  renameManifestEntry,
} from "tmux-manager/data";

/**
 * Format string for tmux list-sessions.
 *
 * Uses `|||` as field separator since shell single quotes prevent
 * `\t` from being interpreted as a tab character by tmux.
 * Triple pipe is safe because it cannot appear in session names or paths.
 */
const SESSION_FORMAT = [
  "#{session_id}",
  "#{session_name}",
  "#{session_path}",
  "#{session_created}",
  "#{session_attached}",
  "#{session_windows}",
].join("|||");

/** Field separator used in SESSION_FORMAT output. */
const FIELD_SEP = "|||";

/**
 * Socket-aware tmux client for the dashboard Docker container.
 *
 * When constructed with a socket path (or via the `TMUX_SOCKET` environment
 * variable), all tmux commands include the `-S <path>` flag. When no socket
 * path is set, commands execute against the default tmux server.
 *
 * All methods are synchronous and never throw -- failures are returned as
 * typed result objects or empty arrays.
 */
export class TmuxDockerClient {
  private readonly socketPath: string | undefined;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? process.env.TMUX_SOCKET;
  }

  /**
   * Execute a tmux command with optional socket flag and shell-escaped arguments.
   * Returns trimmed stdout. Throws on non-zero exit code.
   */
  private exec(args: string[]): string {
    const socketArgs = this.socketPath !== undefined && this.socketPath !== ""
      ? ["-S", this.socketPath]
      : [];
    const fullArgs = [...socketArgs, ...args];
    return execSync(`tmux ${fullArgs.map((arg) => shellEscape(arg)).join(" ")}`, {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 5000,
    }).trim();
  }

  /**
   * Check if the tmux server is accessible.
   *
   * @returns `true` if the tmux server responds, `false` otherwise
   */
  isAvailable(): boolean {
    try {
      this.exec(["list-sessions"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all active tmux sessions.
   *
   * @returns Array of tmux sessions (empty if tmux server is not running)
   */
  listSessions(): TmuxSession[] {
    try {
      const stdout = this.exec([
        "list-sessions",
        "-F",
        SESSION_FORMAT,
      ]);
      if (stdout === "") return [];
      return stdout.split("\n").filter(Boolean).map((line) => parseSessionLine(line));
    } catch {
      return [];
    }
  }

  /**
   * Check if a session with the given name exists.
   *
   * @param name - Session name to check
   * @returns `true` if the session exists, `false` otherwise
   */
  hasSession(name: string): boolean {
    try {
      this.exec(["has-session", "-t", name]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new detached tmux session.
   *
   * The session name is sanitized (dots and colons replaced with hyphens)
   * before creation. Checks for duplicate names before executing.
   *
   * @param rawName - User-provided session name (will be sanitized)
   * @param projectDir - Working directory for the new session
   * @returns ActionResult with success/error status
   */
  createSession(rawName: string, projectDir: string): ActionResult {
    const name = sanitizeTmuxSessionName(rawName);
    if (name === "") return { success: false, error: "Name is empty after sanitization" };

    try {
      if (this.hasSession(name)) {
        return { success: false, error: `Session "${name}" already exists` };
      }
      this.exec(["new-session", "-d", "-s", name, "-c", projectDir]);
      try { upsertManifestEntry({ name, projectDir, lastUpdated: new Date().toISOString() }); } catch { /* non-critical */ }
      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Create failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Kill (delete) a tmux session.
   *
   * @param name - Name of the session to kill
   * @returns ActionResult with success/error status
   */
  killSession(name: string): ActionResult {
    try {
      this.exec(["kill-session", "-t", name]);
      try { removeManifestEntry(name); } catch { /* non-critical */ }
      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Kill failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Rename a tmux session.
   *
   * The new name is sanitized (dots and colons replaced with hyphens).
   * Validates that the new name is different and doesn't already exist.
   *
   * @param oldName - Current session name
   * @param rawNewName - New session name (will be sanitized)
   * @returns ActionResult with success/error status
   */
  renameSession(oldName: string, rawNewName: string): ActionResult {
    const newName = sanitizeTmuxSessionName(rawNewName);
    if (newName === "") return { success: false, error: "New name is empty after sanitization" };
    if (newName === oldName) return { success: false, error: "Name unchanged" };

    try {
      if (this.hasSession(newName)) {
        return { success: false, error: `Session "${newName}" already exists` };
      }
      this.exec(["rename-session", "-t", oldName, newName]);
      try { renameManifestEntry(oldName, newName); } catch { /* non-critical */ }
      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Rename failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Shell-escape a value using single quotes.
 *
 * Handles embedded single quotes via the standard break-and-escape pattern:
 * `'hello'world'` becomes `'hello'\''world'`.
 *
 * @param s - Value to escape
 * @returns Shell-safe string wrapped in single quotes
 */
function shellEscape(s: string): string {
  return `'${s.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Parse a single line of tmux list-sessions format output.
 *
 * Expects 6 `|||`-separated fields matching SESSION_FORMAT:
 * session_id, session_name, session_path, session_created,
 * session_attached, session_windows.
 *
 * @param line - Raw output line from tmux list-sessions
 * @returns Parsed TmuxSession object
 */
function parseSessionLine(line: string): TmuxSession {
  const parts = line.split(FIELD_SEP);
  const [
    id = "",
    name = "",
    sessionPath = "",
    createdStr = "0",
    attachedStr = "0",
    windowsStr = "0",
  ] = parts;

  return {
    id,
    name,
    path: sessionPath,
    created: new Date((Number.parseInt(createdStr, 10) || 0) * 1000),
    attached: Number.parseInt(attachedStr, 10) || 0,
    windows: Number.parseInt(windowsStr, 10) || 0,
  };
}
