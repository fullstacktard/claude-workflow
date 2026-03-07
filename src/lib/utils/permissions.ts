/**
 * Permission presets for Claude Code settings.json
 * Controls the allow/ask permission blocks during scaffold
 */

export type PermissionPreset = "yolo" | "supervised" | "strict";

/** Read-only tools that never mutate files or run commands */
const READ_ONLY_TOOLS = [
  "Read",
  "WebFetch",
  "WebSearch",
  "Glob",
  "Grep",
  "Task",
  "ExitPlanMode",
  "Skill",
  "BashOutput",
  "KillShell",
  "mcp__mcp-proxy__*",
  "mcp__chrome-devtools__*",
  "mcp__playwright__*",
  "mcp__sequential-thinking__*",
  "mcp__serena__*",
];

/** Tools that mutate files */
const MUTATION_TOOLS = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
];

/** Destructive bash patterns that strict mode gates */
const DESTRUCTIVE_BASH_PATTERNS = [
  "Bash(git push:*)",
  "Bash(git commit:*)",
  "Bash(git reset:*)",
  "Bash(git rebase:*)",
  "Bash(git merge:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(git clean:*)",
  "Bash(git stash drop:*)",
  "Bash(git stash pop:*)",
  "Bash(git worktree add:*)",
  "Bash(git worktree remove:*)",
  "Bash(docker *)",
  "Bash(npm run docker*)",
  "Bash(gh:*)",
  "Bash(npm publish:*)",
  "Bash(npm version:*)",
  "Bash(rm:*)",
  "Bash(rm -r:*)",
  "Bash(rm -rf:*)",
];

interface PermissionsBlock {
  allow: string[];
  ask: string[];
  deny: string[];
}

/**
 * Apply a permission preset to a parsed settings.json object.
 *
 * - `supervised` (default): leaves the template as-is (current behavior)
 * - `yolo`: moves everything to allow, clears ask
 * - `strict`: only read-only tools in allow; Write/Edit/Bash/NotebookEdit go to ask
 *
 * @param settings - Parsed settings.json object (mutated in place and returned)
 * @param preset - Permission preset to apply
 * @returns The mutated settings object
 */
export function applyPermissionPreset(
  settings: Record<string, unknown>,
  preset: PermissionPreset,
): Record<string, unknown> {
  // supervised = template default, no changes needed
  if (preset === "supervised") {
    return settings;
  }

  const permissions = (settings.permissions ?? {}) as PermissionsBlock;

  if (preset === "yolo") {
    // Merge everything into allow, clear ask
    const allTools = new Set([
      ...(permissions.allow ?? []),
      ...(permissions.ask ?? []),
    ]);

    // Remove pattern-based entries from ask (they're not real tool names)
    // and add the base tools they reference
    const cleanAllow: string[] = [];
    for (const entry of allTools) {
      if (entry.startsWith("Bash(")) {
        // Skip bash patterns — we'll add bare "Bash" below
        continue;
      }
      cleanAllow.push(entry);
    }

    // Ensure Bash is in allow (covers all bash patterns)
    if (!cleanAllow.includes("Bash")) {
      cleanAllow.push("Bash");
    }

    permissions.allow = cleanAllow;
    permissions.ask = [];
    permissions.deny = permissions.deny ?? [];
  }

  if (preset === "strict") {
    // Allow: read-only tools only
    // Ask: mutation tools + Bash (all patterns) + TodoWrite
    permissions.allow = [...READ_ONLY_TOOLS];
    permissions.ask = [
      ...MUTATION_TOOLS,
      "TodoWrite",
      "Bash(*)",
      ...DESTRUCTIVE_BASH_PATTERNS,
    ];
    permissions.deny = permissions.deny ?? [];
  }

  settings.permissions = permissions;
  return settings;
}
