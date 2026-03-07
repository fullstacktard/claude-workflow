/**
 * Template processing utilities for workflow configuration
 *
 * This module handles:
 * - Package.json script filtering based on enabled code quality tools
 * - Package.json dependency filtering based on code quality tool selection
 * - CLAUDE.md processing for project name placeholders
 * - Task template processing for workflow variations
 * - Backlog reference processing for project name customization
 * - Agent file processing to remove references to disabled code quality tools
 *
 * @module templateProcessor
 */

import type { CodeQualityTools, WorkflowConfig } from "../types/workflow-config.js";

/**
 * Get effective code quality tools - combines what was selected with what exists in project
 *
 * A tool is considered "effective" if either:
 * - User selected it for installation, OR
 * - It already exists in the project (detected)
 *
 * This ensures that CLAUDE.md instructions, agent content, etc. are preserved
 * for tools that exist even if user chose not to replace the config.
 *
 * @param config - Workflow configuration
 * @returns Combined code quality tools (selected OR detected)
 */
export function getEffectiveCodeQuality(config: WorkflowConfig): CodeQualityTools {
  const selected = config.tooling.codeQuality;
  const detected = config.tooling.codeQualityDetected;

  // If no detection data, fall back to selection only (backwards compatibility)
  if (!detected) {
    return selected;
  }

  return {
    eslint: (selected.eslint || detected.eslint) ?? false,
    knip: (selected.knip || detected.knip) ?? false,
    stylelint: (selected.stylelint || detected.stylelint) ?? false,
    typescript: (selected.typescript || detected.typescript) ?? false,
  };
}

/**
 * Mapping of code quality tools to their associated scripts
 */
const TOOL_SCRIPTS: Record<keyof CodeQualityTools, string[]> = {
  eslint: ["lint", "lint:fix", "lint:summary", "lint:ai", "lint:any", "lint:bool", "lint:condition", "lint:unsafe", "lint:focus"],
  knip: ["knip"],
  stylelint: ["lint:css", "lint:css:fix"],
  typescript: ["typecheck"],
};

/**
 * Mapping of code quality tools to their associated devDependencies
 */
const TOOL_DEPENDENCIES: Record<keyof CodeQualityTools, string[]> = {
  eslint: [
    "@eslint/compat",
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
    "eslint",
    "eslint-import-resolver-typescript",
    "eslint-plugin-import",
    "eslint-plugin-perfectionist",
    "eslint-plugin-react",
    "eslint-plugin-react-hooks",
    "eslint-plugin-unicorn",
    "eslint-plugin-unused-imports",
    "eslint-plugin-vitest",
    "globals",
    "typescript-eslint",
  ],
  knip: ["knip"],
  stylelint: ["stylelint", "stylelint-config-standard"],
  typescript: ["typescript", "tsx"],
};

/**
 * Compose the validate script based on enabled code quality tools
 *
 * @param codeQuality - Code quality tools configuration
 * @param ci - Whether this is for CI (adds coverage flag)
 * @returns Composed validate script command
 */
export function composeValidateScript(
  codeQuality: CodeQualityTools,
  ci = false
): string {
  const commands: string[] = [];

  if (codeQuality.eslint) {
    commands.push("npm run lint");
  }
  if (codeQuality.stylelint) {
    commands.push("npm run lint:css");
  }
  if (codeQuality.typescript) {
    commands.push("npm run typecheck");
  }

  // Always include tests
  if (ci) {
    commands.push("npm run test -- --coverage");
  } else {
    commands.push("npm test");
  }

  return commands.join(" && ");
}

/**
 * Filter package.json devDependencies based on code quality tool selection
 *
 * @param deps - Original devDependencies object from package.json
 * @param codeQuality - Code quality tools configuration
 * @returns Filtered devDependencies object
 */
export function filterPackageDeps(
  deps: Record<string, string>,
  codeQuality: CodeQualityTools
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [name, version] of Object.entries(deps)) {
    let shouldInclude = true;

    // Check if this dependency belongs to a disabled tool
    for (const [tool, toolDeps] of Object.entries(TOOL_DEPENDENCIES)) {
      if (toolDeps.includes(name) && !codeQuality[tool as keyof CodeQualityTools]) {
        shouldInclude = false;
        break;
      }
    }

    if (shouldInclude) {
      filtered[name] = version;
    }
  }

  return filtered;
}


/**
 * Filter package.json scripts based on code quality tool selection
 *
 * @param scripts - Original scripts object from package.json
 * @param codeQuality - Code quality tools configuration
 * @returns Filtered scripts object
 */
export function filterPackageScripts(
  scripts: Record<string, string>,
  codeQuality: CodeQualityTools
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [name, command] of Object.entries(scripts)) {
    let shouldInclude = true;

    // Check if this script belongs to a disabled tool
    for (const [tool, toolScripts] of Object.entries(TOOL_SCRIPTS)) {
      if (toolScripts.includes(name) && !codeQuality[tool as keyof CodeQualityTools]) {
        shouldInclude = false;
        break;
      }
    }

    if (shouldInclude) {
      filtered[name] = command;
    }
  }

  // Rebuild validate script based on enabled tools
  if (filtered.validate !== undefined) {
    filtered.validate = composeValidateScript(codeQuality);
  }
  if (filtered["validate:ci"] !== undefined) {
    filtered["validate:ci"] = composeValidateScript(codeQuality, true);
  }

  return filtered;
}

/**
 * Process agent file content by removing conditional template markers based on code quality tool configuration
 *
 * Handles these conditional markers:
 * - `<IF_ESLINT>...</IF_ESLINT>` - Content shown only when ESLint is enabled
 * - `<IF_TYPESCRIPT>...</IF_TYPESCRIPT>` - Content shown only when TypeScript is enabled
 * - `<IF_KNIP>...</IF_KNIP>` - Content shown only when Knip is enabled
 *
 * When a tool is enabled, markers are removed and content is preserved.
 * When a tool is disabled, the entire block (markers + content) is removed.
 *
 * @param content - Raw agent file content with conditional markers
 * @param codeQuality - Code quality tools configuration
 * @returns Processed content with markers evaluated
 *
 * @example
 * // Tool enabled - markers removed, content preserved
 * ```typescript
 * const content = `Before
 * <IF_ESLINT>
 * Run npm run lint
 * </IF_ESLINT>
 * After`;
 *
 * const result = processAgentContent(content, {
 *   eslint: true,
 *   typescript: true,
 *   knip: true
 * });
 * // Result: "Before\nRun npm run lint\nAfter"
 * ```
 *
 * @example
 * // Tool disabled - entire block removed
 * ```typescript
 * const content = `Before
 * <IF_ESLINT>
 * Run npm run lint
 * </IF_ESLINT>
 * After`;
 *
 * const result = processAgentContent(content, {
 *   eslint: false,
 *   typescript: true,
 *   knip: true
 * });
 * // Result: "Before\nAfter" (ESLint block completely removed)
 * ```
 *
 * @example
 * // Mixed tool states
 * ```typescript
 * const content = `
 * <IF_ESLINT>Check lint errors</IF_ESLINT>
 * <IF_TYPESCRIPT>Check type errors</IF_TYPESCRIPT>
 * <IF_KNIP>Check unused exports</IF_KNIP>
 * `;
 *
 * const result = processAgentContent(content, {
 *   eslint: true,
 *   typescript: false,
 *   knip: true
 * });
 * // Result: "\nCheck lint errors\n\nCheck unused exports\n"
 * // TypeScript block removed, ESLint and Knip markers removed but content kept
 * ```
 */
export function processAgentContent(content: string, codeQuality: CodeQualityTools): string {
  let processed = content;

  // Process ESLint markers
  if (codeQuality.eslint) {
    // Remove markers but keep content
    processed = processed.replaceAll(/<IF_ESLINT>\s*/g, "");
    processed = processed.replaceAll(/\s*<\/IF_ESLINT>/g, "");
  } else {
    // Remove markers AND content
    processed = processed.replaceAll(/<IF_ESLINT>[\s\S]*?<\/IF_ESLINT>/g, "");
  }

  // Process TypeScript markers
  if (codeQuality.typescript) {
    processed = processed.replaceAll(/<IF_TYPESCRIPT>\s*/g, "");
    processed = processed.replaceAll(/\s*<\/IF_TYPESCRIPT>/g, "");
  } else {
    processed = processed.replaceAll(/<IF_TYPESCRIPT>[\s\S]*?<\/IF_TYPESCRIPT>/g, "");
  }

  // Process Knip markers
  if (codeQuality.knip) {
    processed = processed.replaceAll(/<IF_KNIP>\s*/g, "");
    processed = processed.replaceAll(/\s*<\/IF_KNIP>/g, "");
  } else {
    processed = processed.replaceAll(/<IF_KNIP>[\s\S]*?<\/IF_KNIP>/g, "");
  }

  // Process Stylelint markers
  if (codeQuality.stylelint) {
    processed = processed.replaceAll(/<IF_STYLELINT>\s*/g, "");
    processed = processed.replaceAll(/\s*<\/IF_STYLELINT>/g, "");
  } else {
    processed = processed.replaceAll(/<IF_STYLELINT>[\s\S]*?<\/IF_STYLELINT>/g, "");
  }

  return processed;
}

/**
 * Process backlog-reference.md based on workflow configuration
 * Replaces project name placeholders
 *
 * @param content - Original backlog-reference.md content
 * @param config - Workflow configuration
 * @param projectName - Project name for placeholder replacement
 * @returns Processed backlog-reference.md content
 */
export function processBacklogReference(
  content: string,
  _config: WorkflowConfig,
  projectName: string
): string {
  let processed = content;

  // Replace all project name placeholders
  processed = processed.replaceAll("[your-project-name]", projectName);
  processed = processed.replaceAll("myproject", projectName);

  return processed;
}

/**
 * Process CLAUDE.md template based on workflow configuration
 * Replaces project name placeholders
 *
 * @param content - Original CLAUDE.md content
 * @param config - Workflow configuration
 * @param projectName - Project name for placeholder replacement
 * @returns Processed CLAUDE.md content
 */
export function processCLAUDEmd(
  content: string,
  config: WorkflowConfig,
  projectName: string
): string {
  let processed = content;

  // Replace project name placeholders
  processed = processed.replaceAll("myproject", projectName);
  processed = processed.replaceAll("[your-project-name]", projectName);

  // Process conditional markers based on effective code quality (selected OR detected)
  processed = processAgentContent(processed, getEffectiveCodeQuality(config));

  return processed;
}

/**
 * Process task-template.md based on workflow configuration
 *
 * @param content - Original task-template.md content
 * @param config - Workflow configuration
 * @returns Processed task-template.md content
 */
export function processTaskTemplate(content: string): string {
  // No special processing needed - template is already clean
  return content;
}

/**
 * Main entry point for template processing
 * Routes to specific processor based on file path
 *
 * @param content - Original template content
 * @param destPath - Destination file path (used for routing)
 * @param config - Workflow configuration
 * @param projectName - Project name for placeholder replacement
 * @returns Processed template content
 */
export function processTemplateContent(
  content: string,
  destPath: string,
  config: WorkflowConfig,
  projectName: string
): string {
  // Route based on destination file path
  if (destPath.includes("CLAUDE.template.md")) {
    return processCLAUDEmd(content, config, projectName);
  } else if (destPath.includes("task-template.md")) {
    return processTaskTemplate(content);
  } else if (destPath.includes("backlog-reference.md")) {
    return processBacklogReference(content, config, projectName);
  }

  // Return unmodified content for files that don't need processing
  return content;
}

/**
 * Markers for user customization section in CLAUDE.md
 */
const USER_CUSTOMIZATIONS_START = "<!-- USER_CUSTOMIZATIONS_START -->";
const USER_CUSTOMIZATIONS_END = "<!-- USER_CUSTOMIZATIONS_END -->";

/**
 * Extract user customizations from existing CLAUDE.md content
 *
 * Looks for content between USER_CUSTOMIZATIONS_START and USER_CUSTOMIZATIONS_END markers.
 * Returns null if markers are not found (indicates old format or new file).
 *
 * @param existingContent - Current CLAUDE.md content
 * @returns User customization section content (including markers), or null if not found
 */
export function extractUserCustomizations(existingContent: string): string | null {
  const startIndex = existingContent.indexOf(USER_CUSTOMIZATIONS_START);
  const endIndex = existingContent.indexOf(USER_CUSTOMIZATIONS_END);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  // Include the end marker in the extraction
  return existingContent.slice(startIndex, endIndex + USER_CUSTOMIZATIONS_END.length);
}

/**
 * Merge user customizations with new template content
 *
 * If the existing file has user customizations, they are preserved.
 * Otherwise, the default user section from the template is used.
 *
 * @param templateContent - New template content with default user section
 * @param existingContent - Existing CLAUDE.md content (or null for new files)
 * @returns Merged content with user customizations preserved
 */
export function mergeUserCustomizations(
  templateContent: string,
  existingContent: string | null
): string {
  // If no existing content, return template as-is
  if (!existingContent) {
    return templateContent;
  }

  // Extract user customizations from existing file
  const userSection = extractUserCustomizations(existingContent);

  // If no user section found in existing file (old format), return template as-is
  if (!userSection) {
    return templateContent;
  }

  // Replace the default user section in template with the preserved one
  const defaultSection = extractUserCustomizations(templateContent);
  if (!defaultSection) {
    // Template doesn't have markers - shouldn't happen but handle gracefully
    return templateContent;
  }

  return templateContent.replace(defaultSection, userSection);
}

/**
 * Renumber acceptance criteria sequentially
 * Finds all "- [ ] #N" patterns and renumbers them 1, 2, 3...
 *
 * @param content - Content with acceptance criteria
 * @returns Content with renumbered acceptance criteria
 */
export function renumberAcceptanceCriteria(content: string): string {
  let num = 1;
  return content.replaceAll(/- \[ \] #\d+/g, () => {
    const current = num;
    num += 1;
    return `- [ ] #${String(current)}`;
  });
}

/**
 * Renumber items in a specific section
 * Uses regex to find numbered items and renumber them sequentially
 *
 * @param content - Original content
 * @param sectionName - Name of section to renumber
 * @param itemRegex - Regex pattern to match items (must capture leading number)
 * @returns Content with renumbered section items
 */
export function renumberSection(
  content: string,
  sectionName: string,
  itemRegex: RegExp
): string {
  // Find the section - match from heading to next heading or end of string
  // Don't use 'm' flag because $ in multiline mode matches end of line, not end of string
  const sectionRegex = new RegExp(String.raw`## ${sectionName}[\s\S]*?(?=\n##|$)`);
  const match = content.match(sectionRegex);

  if (!match) {
    return content; // Section not found, return unchanged
  }

  const sectionContent = match[0];

  // Create global version of regex if not already global
  const globalRegex = itemRegex.global
    ? itemRegex
    : new RegExp(itemRegex.source, itemRegex.flags.replaceAll("g", "") + "g");

  // Renumber items in the section
  let num = 1;
  const renumbered = sectionContent.replace(globalRegex, () => {
    const current = num;
    num += 1;
    return `${String(current)}. **`;
  });

  // Replace the section in the original content
  return content.replace(sectionRegex, renumbered);
}
