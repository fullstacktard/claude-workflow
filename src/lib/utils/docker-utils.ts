/**
 * Docker environment detection and path mapping utilities
 *
 * When claude-workflow runs inside Docker, paths like /app/projects/...
 * don't exist on the host system. This module detects Docker environments
 * and maps container paths to host paths for use in settings.json hooks.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Common Docker volume mount patterns
 * Maps container paths to host path environment variables or defaults
 */
interface DockerMountPattern {
  /** Container path prefix to detect */
  containerPrefix: string;
  /** Environment variable that may contain host path */
  hostEnvVar?: string;
  /** Description for user prompts */
  description: string;
}

const KNOWN_MOUNT_PATTERNS: DockerMountPattern[] = [
  {
    containerPrefix: "/app/projects",
    hostEnvVar: "HOST_PROJECTS_PATH",
    description: "Docker projects volume mounted at /app/projects",
  },
  {
    containerPrefix: "/workspace",
    hostEnvVar: "HOST_WORKSPACE_PATH",
    description: "Docker workspace volume mounted at /workspace",
  },
  {
    containerPrefix: "/home/node/app",
    hostEnvVar: "HOST_APP_PATH",
    description: "Node Docker container app directory",
  },
];

/**
 * Check if currently running inside a Docker container
 *
 * Detection methods:
 * 1. Check for /.dockerenv file
 * 2. Check for docker in /proc/1/cgroup
 * 3. Check for known Docker-specific paths
 */
export function isRunningInDocker(): boolean {
  // Method 1: /.dockerenv file exists
  if (fs.existsSync("/.dockerenv")) {
    return true;
  }

  // Method 2: Check cgroup for docker
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) {
      return true;
    }
  } catch {
    // File doesn't exist or not readable - not Linux or not in container
  }

  // Method 3: Check for known Docker mount points
  for (const pattern of KNOWN_MOUNT_PATTERNS) {
    if (process.cwd().startsWith(pattern.containerPrefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect the Docker mount pattern being used
 *
 * @returns Matching mount pattern or undefined if not in a known Docker setup
 */
export function detectDockerMountPattern(): DockerMountPattern | undefined {
  const cwd = process.cwd();

  for (const pattern of KNOWN_MOUNT_PATTERNS) {
    if (cwd.startsWith(pattern.containerPrefix)) {
      return pattern;
    }
  }

  return undefined;
}

/**
 * Parse /proc/self/mountinfo to find volume mount mappings
 * Returns a map of container mount point -> host source path
 */
function parseMountInfo(): Map<string, string> {
  const mounts = new Map<string, string>();

  try {
    const mountInfo = fs.readFileSync("/proc/self/mountinfo", "utf8");
    const lines = mountInfo.trim().split("\n");

    for (const line of lines) {
      // Format: id parent major:minor root mount_point options optional_fields - fs_type source super_options
      // The root field (4th) contains the host source path for bind mounts
      // The mount_point field (5th) contains the container path
      const parts = line.split(" ");
      if (parts.length < 5) continue;

      const root = parts[3];      // Host source path
      const mountPoint = parts[4]; // Container mount point

      // Skip non-bind mounts (root filesystem, proc, sys, etc.)
      // Bind mounts from host typically have paths starting with /home, /Users, /mnt, etc.
      if (root && mountPoint &&
          (root.startsWith("/home/") ||
           root.startsWith("/Users/") ||
           root.startsWith("/mnt/") ||
           root.startsWith("/root/") ||
           /^\/[a-z]\//.test(root))) { // WSL paths like /c/Users
        mounts.set(mountPoint, root);
      }
    }
  } catch {
    // Can't read mountinfo - not Linux or permission denied
  }

  return mounts;
}

/**
 * Try to auto-detect host path by reading mount information
 *
 * Detection priority:
 * 1. Read /proc/self/mountinfo to find actual volume mount source
 * 2. Fall back to environment variables (HOST_PROJECTS_PATH, etc.)
 *
 * @param containerPath - The path inside the container
 * @returns Host path if detectable, undefined otherwise
 */
export function tryAutoDetectHostPath(containerPath: string): string | undefined {
  // Method 1: Parse /proc/self/mountinfo to find the actual mount mapping
  const mounts = parseMountInfo();

  // Find the longest matching mount point for this path
  let bestMatch: { mountPoint: string; hostPath: string } | undefined;
  for (const [mountPoint, hostPath] of mounts) {
    if (containerPath.startsWith(mountPoint) && (!bestMatch || mountPoint.length > bestMatch.mountPoint.length)) {
      bestMatch = { mountPoint, hostPath };
    }
  }

  if (bestMatch) {
    // Replace container mount point with host path
    const relativePath = containerPath.slice(bestMatch.mountPoint.length);
    return path.join(bestMatch.hostPath, relativePath);
  }

  // Method 2: Fall back to environment variables
  const mountPattern = detectDockerMountPattern();
  if (mountPattern?.hostEnvVar) {
    const hostBase = process.env[mountPattern.hostEnvVar];
    if (hostBase) {
      const relativePath = containerPath.slice(mountPattern.containerPrefix.length);
      return path.join(hostBase, relativePath);
    }
  }

  return undefined;
}

/**
 * Convert a container path to host path using the provided mapping
 *
 * @param containerPath - Path inside the container (e.g., /app/projects/myproject)
 * @param hostProjectRoot - The host system path to the project root
 * @returns The corresponding host path
 */
export function containerPathToHostPath(
  containerPath: string,
  hostProjectRoot: string
): string {
  // If the path doesn't look like a container path, return as-is
  const mountPattern = KNOWN_MOUNT_PATTERNS.find((p) =>
    containerPath.startsWith(p.containerPrefix)
  );

  if (!mountPattern) {
    return containerPath;
  }

  // Extract the project-relative portion
  // e.g., /app/projects/myproject/.claude/hooks/foo.js -> .claude/hooks/foo.js
  const projectRoot = process.cwd(); // Current container project path
  if (containerPath.startsWith(projectRoot)) {
    const relativePath = containerPath.slice(projectRoot.length);
    // Remove leading slash if present
    const cleanRelative = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    return path.join(hostProjectRoot, cleanRelative);
  }

  // If not relative to current project, just replace the mount prefix
  const relativePath = containerPath.slice(mountPattern.containerPrefix.length);
  return path.join(hostProjectRoot, relativePath);
}

/**
 * Get the effective project path for hook configurations
 *
 * When in Docker with a configured host path, returns the host path.
 * Otherwise returns the current project path.
 *
 * @param currentProjectPath - The current project path (may be container path)
 * @param hostProjectRoot - Optional configured host project root
 * @returns The path to use for hook configurations
 */
export function getEffectivePathForHooks(
  currentProjectPath: string,
  hostProjectRoot?: string
): string {
  // If host path is configured, use it
  if (hostProjectRoot) {
    return hostProjectRoot;
  }

  // If in Docker without host path config, return current path with warning
  if (isRunningInDocker()) {
    const mountPattern = detectDockerMountPattern();
    if (mountPattern) {
      console.warn(
        `[docker-utils] Running in Docker (${mountPattern.description}) without host path configured.`
      );
      console.warn(
        "[docker-utils] Hook paths will use container paths which won't work on host."
      );
      console.warn(
        "[docker-utils] Run 'claude-workflow config --set-host-path /your/host/path' to fix."
      );
    }
  }

  return currentProjectPath;
}

/**
 * Validate that a host path looks reasonable
 *
 * @param hostPath - The proposed host path
 * @returns true if the path looks valid
 */
export function isValidHostPath(hostPath: string): boolean {
  // Must be absolute
  if (!path.isAbsolute(hostPath)) {
    return false;
  }

  // Must not be a Docker container path
  for (const pattern of KNOWN_MOUNT_PATTERNS) {
    if (hostPath.startsWith(pattern.containerPrefix)) {
      return false;
    }
  }

  // Should look like a Unix or Windows path
  // Unix: /home/user/project or /Users/user/project
  // Windows: C:\Users\user\project or /mnt/c/Users/user/project (WSL)
  const looksLikeHostPath =
    hostPath.startsWith("/home/") ||
    hostPath.startsWith("/Users/") ||
    hostPath.startsWith("/mnt/") ||
    /^[A-Z]:[/\\]/.test(hostPath) || // Windows drive letter
    hostPath.startsWith("/root/");

  return looksLikeHostPath;
}

export default {
  containerPathToHostPath,
  detectDockerMountPattern,
  getEffectivePathForHooks,
  isRunningInDocker,
  isValidHostPath,
  tryAutoDetectHostPath,
};
