/**
 * Claude Process Detector
 * Detects running Claude Code instances by parsing `ps aux` output
 * and mapping them to discovered projects via working directory
 *
 * @module dashboard/services/claude-process-detector
 *
 * Platform Support:
 * - Linux/WSL: Full support via /proc/{pid}/cwd symlink
 * - macOS: Similar approach (use `ps -p <pid> -o cwd`)
 * - Windows: Not applicable (Claude Code runs in WSL)
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

import * as fs from "node:fs/promises";

const execAsync = promisify(exec);

/**
 * Active Claude process information
 */
export interface ActiveClaudeProcess {
  /** Process ID */
  pid: number;
  /** Parent Process ID - used to detect agent subprocesses */
  ppid: number;
  /** Working directory of the process */
  workingDirectory?: string;
  /** Process command line (for filtering) */
  command: string;
}

/**
 * Mapping of process to project
 */
export interface ProcessProjectMapping {
  /** Project path */
  projectPath: string;
  /** List of active PIDs for this project */
  activePids: number[];
}

/**
 * Parse ps -eo output line
 *
 * Expected format: USER PID PPID COMM ARGS...
 * (from ps -eo user,pid,ppid,comm,args)
 *
 * @param line - Single line from ps output
 * @returns Process info with PID, PPID, and command, or undefined if invalid
 */
function parsePsLine(line: string): { pid: number; ppid: number; command: string } | undefined {
  const trimmed = line.trim();
  if (trimmed === "") {
    return undefined;
  }

  // Skip header lines
  if (trimmed.startsWith("USER") || trimmed.startsWith("PID") || trimmed.startsWith("COMMAND")) {
    return undefined;
  }

  const parts = trimmed.split(/\s+/);

  // Expected format: USER PID PPID COMM ARGS...
  // Minimum 5 parts: USER, PID, PPID, COMM, at least one ARGS element
  if (parts.length < 5) {
    return undefined;
  }

  const pid = Number.parseInt(parts[1], 10);
  const ppid = Number.parseInt(parts[2], 10);

  if (Number.isNaN(pid) || Number.isNaN(ppid)) {
    return undefined;
  }

  // Command is everything from index 4 (ARGS) to the end
  // COMM is just the process name, ARGS is the full command line
  const command = parts.slice(4).join(" ");
  return { pid, ppid, command };
}

/**
 * Detect if /host/proc is available (Docker with mounted host /proc)
 */
async function hasHostProc(): Promise<boolean> {
  try {
    await fs.access("/host/proc");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Claude processes by scanning /host/proc directly
 * Used in Docker when host /proc is mounted to /host/proc
 *
 * Scans /host/proc/{pid}/comm for processes named "claude" or "node" (for MCP servers)
 * Returns PIDs, PPIDs (from /host/proc/{pid}/stat), and command lines for processes matching "claude"
 */
async function getClaudeProcessesFromHostProc(): Promise<Array<{ pid: number; ppid: number; command: string }>> {
  const processes: Array<{ pid: number; ppid: number; command: string }> = [];

  try {
    const entries = await fs.readdir("/host/proc");

    for (const entry of entries) {
      // Only process numeric directories (PIDs)
      const pid = Number.parseInt(entry, 10);
      if (Number.isNaN(pid)) continue;

      try {
        // Read process name from comm
        const commPath = `/host/proc/${pid}/comm`;
        const commRaw = await fs.readFile(commPath, "utf8");
        const comm = commRaw.trim();

        // Check if this is a Claude-related process
        if (comm === "claude" || comm === "node") {
          // Read full command line to verify it's Claude-related
          const cmdlinePath = `/host/proc/${pid}/cmdline`;
          const cmdlineRaw = await fs.readFile(cmdlinePath, "utf8");
          // cmdline is null-separated, convert to space-separated
          const cmdline = cmdlineRaw.replaceAll("\0", " ").trim();

          // Filter for claude processes (skip container processes, grep, etc.)
          if (cmdline.includes("claude") && !cmdline.includes("grep")) {
            // Read PPID from /host/proc/{pid}/stat
            // Format: pid (comm) state ppid ...
            const statPath = `/host/proc/${pid}/stat`;
            const statContent = await fs.readFile(statPath, "utf8");
            // Match: pid (comm with possible spaces) state ppid
            const statMatch = statContent.match(/^\d+\s+\([^)]+\)\s+\w+\s+(\d+)/);
            const ppid = statMatch ? Number.parseInt(statMatch[1], 10) : 0;

            processes.push({ pid, ppid, command: cmdline });
          }
        }
      } catch {
        // Process may have exited, skip
        continue;
      }
    }

    console.log("[claude-process-detector] Found", processes.length, "Claude processes via /host/proc");
    return processes;
  } catch (error) {
    console.error("[claude-process-detector] Error scanning /host/proc:", error);
    return [];
  }
}

/**
 * Get list of all running Claude processes
 *
 * When running in Docker with /host/proc mounted, scans host processes directly.
 * Otherwise uses `ps -eo user,pid,ppid,comm,args | grep claude` to find processes.
 *
 * @returns Array of Claude processes with PID, PPID, and command
 */
async function getClaudeProcesses(): Promise<Array<{ pid: number; ppid: number; command: string }>> {
  try {
    const isDocker = await isRunningInDocker();

    // In Docker, check if /host/proc is mounted for host process access
    if (isDocker) {
      const hostProcAvailable = await hasHostProc();
      if (hostProcAvailable) {
        console.log("[claude-process-detector] Docker with /host/proc mounted - scanning host processes");
        return getClaudeProcessesFromHostProc();
      }
      // No /host/proc mount - can't detect host processes
      console.log("[claude-process-detector] Docker without /host/proc - cannot detect host processes");
      return [];
    }

    // Not in Docker - use ps -eo to get USER, PID, PPID, COMM, ARGS
    const { stdout } = await execAsync("ps -eo user,pid,ppid,comm,args | grep claude");
    const lines = stdout.trim().split("\n");

    const processes: Array<{ pid: number; ppid: number; command: string }> = [];

    for (const line of lines) {
      // Skip the grep process itself
      if (line.includes("grep claude")) {
        continue;
      }

      // DO NOT skip uvx/serena processes - they have valid CWD and represent Claude sessions
      // The actual 'claude' CLI process often shows no CWD in ps aux
      // uvx/serena MCP server processes DO have CWD and run in project directories

      const parsed = parsePsLine(line);
      if (parsed) {
        processes.push(parsed);
      }
    }

    console.log("[claude-process-detector] Found", processes.length, "Claude processes via ps -eo");
    return processes;
  } catch (error) {
    // Only log error if not in Docker environment
    // In Docker, ps failures are expected and should be silent
    const isDocker = await isRunningInDocker().catch(() => false);
    if (!isDocker) {
      console.error("[claude-process-detector] Error running ps command:", error);
    }
    return [];
  }
}

/**
 * Check if running inside a Docker container
 *
 * Detects Docker by checking for /.dockerenv file or cgroup indicators
 */
async function isRunningInDocker(): Promise<boolean> {
  try {
    // Check for /.dockerenv file (created by Docker)
    await fs.access("/.dockerenv");
    return true;
  } catch {
    // Fall back to checking cgroup
    try {
      const cgroup = await fs.readFile("/proc/1/cgroup", "utf8");
      return cgroup.includes("docker") || cgroup.includes("containerd");
    } catch {
      return false;
    }
  }
}

/**
 * Get process working directory from /proc filesystem (Linux/WSL)
 *
 * On Linux systems, /proc/{pid}/cwd is a symlink pointing to the
 * current working directory of the process. We use fs.readlink() to resolve it.
 *
 * When running in Docker with /host/proc mounted, uses /host/proc instead.
 *
 * @param pid - Process ID
 * @returns Working directory path, or undefined if not readable
 */
async function getProcessCwd(pid: number): Promise<string | undefined> {
  try {
    // Check if we should use /host/proc (Docker with mounted host proc)
    const useHostProc = await hasHostProc();
    const procBase = useHostProc ? "/host/proc" : "/proc";

    const cwdPath = `${procBase}/${pid}/cwd`;
    const cwd = await fs.readlink(cwdPath);
    console.log(`[claude-process-detector] PID ${pid} CWD: ${cwd}`);
    return cwd;
  } catch (error) {
    // Process may have exited between checking and reading CWD
    // Or /proc is not available (non-Linux platform)
    console.log(`[claude-process-detector] Could not read CWD for PID ${pid}:`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

/**
 * Get all active Claude processes by:
 * 1. Running `ps -eo user,pid,ppid,comm,args | grep claude` to find Claude processes
 * 2. Reading /proc/{pid}/cwd to get working directories
 *
 * Filters out:
 * - grep process itself
 * - uvx/serena MCP server processes (not actual Claude sessions)
 *
 * @returns Array of active Claude processes with working directories and PPID
 */
export async function getActiveClaudeProcesses(): Promise<ActiveClaudeProcess[]> {
  console.log("[claude-process-detector] Scanning for active Claude processes...");

  // Get all Claude processes via ps
  const psProcesses = await getClaudeProcesses();

  const activeProcesses: ActiveClaudeProcess[] = [];

  // Get working directory for each process
  for (const { pid, ppid, command } of psProcesses) {
    const workingDirectory = await getProcessCwd(pid);

    activeProcesses.push({
      pid,
      ppid,
      workingDirectory,
      command,
    });
  }

  console.log("[claude-process-detector] Found", activeProcesses.length, "active Claude processes");
  return activeProcesses;
}

/**
 * Normalize a path by extracting relative path from home directory
 *
 * Handles Docker mounts where /host-home maps to actual home dir.
 * Also handles paths like /home/username/...
 *
 * Returns a consistent relative path from home for comparison.
 *
 * @param p - Path to normalize
 * @returns Relative path from home directory, or original if no match
 */
function normalizeHomePath(p: string): string {
  // Remove /host-home prefix (Docker mount of host home)
  if (p.startsWith("/host-home/")) {
    return p.slice("/host-home/".length);
  }
  if (p === "/host-home") {
    return "";
  }

  // Remove Docker SCAN_ROOT prefix (container mount of host home)
  // This handles /app/projects/... which maps to host's home directory
  const scanRoot = process.env.SCAN_ROOT;
  if (scanRoot && p.startsWith(scanRoot + "/")) {
    return p.slice(scanRoot.length + 1);
  }
  if (scanRoot && p === scanRoot) {
    return "";
  }

  // Remove /home/username prefix - extract the relative path after home
  const homeMatch = p.match(/^\/home\/[^/]+\/(.*)/);
  if (homeMatch) {
    return homeMatch[1];
  }

  // Handle just /home/username with no trailing content
  const homeExactMatch = p.match(/^\/home\/[^/]+$/);
  if (homeExactMatch) {
    return "";
  }

  // Remove ~ prefix
  if (p.startsWith("~/")) {
    return p.slice(2);
  }

  return p;
}

/**
 * Check if two paths match after normalizing home directory prefixes
 *
 * Compares paths after stripping home directory prefixes.
 * Does NOT use path.resolve() to avoid issues with container working directories.
 *
 * @param path1 - First path (typically process CWD)
 * @param path2 - Second path (typically project path)
 * @returns true if paths are equivalent, false otherwise
 */
function pathsMatch(path1: string, path2: string): boolean {
  const norm1 = normalizeHomePath(path1).replace(/\/+$/, ""); // Remove trailing slashes
  const norm2 = normalizeHomePath(path2).replace(/\/+$/, "");

  // Empty string matches home directory
  if (norm1 === "" || norm2 === "") {
    // Only match if both are empty (both are home dir)
    // Otherwise one is home and the other is a subdirectory
    return norm1 === norm2;
  }

  // Exact match
  if (norm1 === norm2) {
    return true;
  }

  // Process CWD is a subdirectory of project path
  // e.g., CWD: development/projects/foo/.claude -> project: development/projects/foo
  if (norm1.startsWith(norm2 + "/")) {
    return true;
  }

  // Project path is a subdirectory of process CWD (less common)
  // e.g., CWD: development/projects -> project: development/projects/foo
  // This would mean the process is running in a parent directory, not typically matching
  // We'll skip this case to avoid false positives

  return false;
}

/**
 * Session counts for a project - distinguishes main sessions from agents
 */
export interface SessionCounts {
  /** Number of main Claude sessions (parent is not a Claude process) */
  sessions: number;
  /** Number of agent subprocesses (parent is a Claude process) */
  agents: number;
}

/**
 * Classify processes into main sessions vs agent subprocesses
 *
 * A main session is a Claude process whose parent is NOT also a Claude process.
 * An agent subprocess is a Claude process whose parent IS also a Claude process.
 *
 * @param processes - Array of active Claude processes with PPIDs
 * @returns Object with arrays of main sessions and agents
 */
export function classifyProcesses(processes: ActiveClaudeProcess[]): {
  mainSessions: ActiveClaudeProcess[];
  agents: ActiveClaudeProcess[];
} {
  // Build a set of all Claude PIDs for quick lookup
  const claudePidSet = new Set(processes.map(p => p.pid));

  const mainSessions: ActiveClaudeProcess[] = [];
  const agents: ActiveClaudeProcess[] = [];

  for (const proc of processes) {
    if (claudePidSet.has(proc.ppid)) {
      // Parent is also a Claude process -> this is an agent subprocess
      agents.push(proc);
    } else {
      // Parent is not a Claude process -> this is a main session
      mainSessions.push(proc);
    }
  }

  console.log(
    "[claude-process-detector] Classified",
    processes.length,
    "processes:",
    mainSessions.length,
    "main sessions,",
    agents.length,
    "agents"
  );

  return { mainSessions, agents };
}

/**
 * Map active Claude processes to discovered project paths
 *
 * Returns a Map where keys are project paths and values are
 * SessionCounts (sessions and agents counts).
 *
 * Mapping logic:
 * - Exact match: Process CWD equals project path (after normalization)
 * - Subdirectory match: Process CWD is a subdirectory of project path
 * - Unmatched processes are ignored (not part of any discovered project)
 *
 * Classification logic:
 * - Main session: Parent PID is NOT a Claude process
 * - Agent: Parent PID IS a Claude process
 *
 * Path normalization handles Docker mounts (e.g., /host-home -> /home/user)
 *
 * @param processes - Array of active Claude processes
 * @param projectPaths - Array of discovered project paths
 * @returns Map of project paths to SessionCounts (sessions and agents)
 */
export function mapProcessesToProjects(
  processes: ActiveClaudeProcess[],
  projectPaths: string[]
): Map<string, SessionCounts> {
  const projectSessionCounts = new Map<string, SessionCounts>();

  console.log(
    "[claude-process-detector] Mapping",
    processes.length,
    "processes to",
    projectPaths.length,
    "projects"
  );

  // Initialize all projects with 0 sessions and 0 agents
  for (const projectPath of projectPaths) {
    projectSessionCounts.set(projectPath, { sessions: 0, agents: 0 });
  }

  // Classify processes first
  const { mainSessions, agents } = classifyProcesses(processes);

  // Sort project paths by length (longest first) to match most specific project
  const sortedProjectPaths = [...projectPaths].sort((a, b) => b.length - a.length);

  // Map main sessions to projects
  for (const proc of mainSessions) {
    if (!proc.workingDirectory) {
      console.log("[claude-process-detector] Main session PID", proc.pid, "has no CWD, skipping");
      continue;
    }

    let matched = false;

    // Find which project this process belongs to (most specific first)
    for (const projectPath of sortedProjectPaths) {
      if (pathsMatch(proc.workingDirectory, projectPath)) {
        const current = projectSessionCounts.get(projectPath) ?? { sessions: 0, agents: 0 };
        projectSessionCounts.set(projectPath, { ...current, sessions: current.sessions + 1 });
        console.log(
          "[claude-process-detector] Matched main session PID",
          proc.pid,
          "to project",
          projectPath,
          "(CWD:",
          proc.workingDirectory,
          ")"
        );
        matched = true;
        break;
      }
    }

    if (!matched) {
      console.log(
        "[claude-process-detector] Main session PID",
        proc.pid,
        "CWD",
        proc.workingDirectory,
        "did not match any project"
      );
    }
  }

  // Map agent subprocesses to projects
  for (const proc of agents) {
    if (!proc.workingDirectory) {
      console.log("[claude-process-detector] Agent PID", proc.pid, "has no CWD, skipping");
      continue;
    }

    let matched = false;

    // Find which project this process belongs to (most specific first)
    for (const projectPath of sortedProjectPaths) {
      if (pathsMatch(proc.workingDirectory, projectPath)) {
        const current = projectSessionCounts.get(projectPath) ?? { sessions: 0, agents: 0 };
        projectSessionCounts.set(projectPath, { ...current, agents: current.agents + 1 });
        console.log(
          "[claude-process-detector] Matched agent PID",
          proc.pid,
          "to project",
          projectPath,
          "(CWD:",
          proc.workingDirectory,
          ")"
        );
        matched = true;
        break;
      }
    }

    if (!matched) {
      console.log(
        "[claude-process-detector] Agent PID",
        proc.pid,
        "CWD",
        proc.workingDirectory,
        "did not match any project"
      );
    }
  }

  console.log("[claude-process-detector] Final session counts:");
  for (const [projectPath, counts] of projectSessionCounts.entries()) {
    console.log(`  ${projectPath}: ${counts.sessions} sessions, ${counts.agents} agents`);
  }

  return projectSessionCounts;
}

/**
 * Get active session counts for a specific project using process detection
 *
 * This is a convenience function that combines process detection
 * with project mapping for a single project.
 *
 * @param projectPath - Path to project directory
 * @param allProjectPaths - All discovered project paths (for mapping)
 * @returns SessionCounts with main sessions and agents for this project
 */
export async function getActiveSessionsForProject(
  projectPath: string,
  allProjectPaths: string[]
): Promise<SessionCounts> {
  const processes = await getActiveClaudeProcesses();
  const mapping = mapProcessesToProjects(processes, allProjectPaths);
  return mapping.get(projectPath) ?? { sessions: 0, agents: 0 };
}
