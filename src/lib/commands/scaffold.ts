
import type { PermissionPreset } from "../utils/permissions.js";
import { execFile, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../file-operations.js";

/**
 * Security constants for command execution
 */
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const COMMAND_TIMEOUT = 60_000; // 60 seconds default timeout
const INSTALL_TIMEOUT = 300_000; // 5 minutes for package installations
const MAX_BUFFER_SIZE = BYTES_PER_KB * KB_PER_MB; // 1MB max output

/**
 * Docker setup context - tracks what needs to be done after clack finishes
 */
interface DockerSetupContext {
  cwd: string;
  deployedServices?: Array<{ name: string; port: number; url?: string }>;
  mcpProxyEnabled: boolean;
}

interface PackageJson {
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  type?: string;
}

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

interface ScaffoldOptions {
  /** Feature groups to enable (e.g. ["core", "qa", "lint"]) */
  features?: string[];
  /** Permission preset: yolo, supervised (default), strict */
  permissions?: PermissionPreset;
  /** Enable Tailwind CSS v4 mode with design token enforcement */
  tailwind?: boolean;
  withMcpProxy?: boolean;
}

/**
 * Custom error class for secure command execution
 */
class SecureCommandError extends Error {
  constructor(message: string, public readonly exitCode?: number, public readonly signal?: string) {
    super(message);
    this.name = "SecureCommandError";
  }
}

/**
 * Initialize claude-workflow in the current directory.
 * Creates .claude directory structure with configuration and template files.
 *
 * CI Mode Detection:
 * - Detects CI environment via process.env.CI === "true" or NODE_ENV === "test"
 * - In CI mode: Skips all interactive prompts and uses default configuration
 * - In interactive mode: Prompts for workflow configuration options
 *
 * @param options - Scaffold configuration options
 */
export async function scaffold(options: ScaffoldOptions = {}): Promise<void> {
  // Check for updates BEFORE showing header
  const updateInfo = checkForUpdates();
  if (updateInfo.needsUpdate) {
    // Show "Updating..." in red

    process.stdout.write(chalk.red("Updating...\n"));
    performUpdate();
    // Clear the line
    
    process.stdout.write("\u001B[1A\u001B[2K");
  }

  await showHeader();

  const cwd = process.cwd();
  let hasPackageJson = existsSync(path.join(cwd, "package.json"));
  let hasGit = existsSync(path.join(cwd, ".git"));

  // Auto-initialize package.json if not found
  if (!hasPackageJson) {
    console.log(chalk.yellow("No package.json found, initializing..."));
    try {
      await executeCommand("npm", ["init", "-y"], { cwd, timeout: 30_000 });
      hasPackageJson = true;
      console.log(chalk.green("Created package.json"));
    } catch {
      showBox(
        "Initialization Failed",
        "Could not create package.json.\n\n" +
          "Please create it manually:\n" +
          chalk.red("  npm init -y") +
          "\n\n" +
          "Then run this command again.",
        "error"
      );
      process.exit(1);
    }
  }

  // Auto-initialize git if not found
  if (!hasGit) {
    console.log(chalk.yellow("No git repository found, initializing..."));
    try {
      await executeCommand("git", ["init"], { cwd, timeout: 30_000 });
      hasGit = true;
      console.log(chalk.green("Initialized git repository"));
    } catch {
      // Git init failed - continue without git (pre-commit hooks will be skipped)
      console.log(chalk.dim("Git not available, skipping git initialization"));
    }
  }

  // Find the git root (for monorepo detection)
  const gitRoot = findGitRoot(cwd);

  // MONOREPO DETECTION: Warn if running from a subdirectory (only if git is initialized)
  // This helps prevent hooks being installed in wrong location
  const isMonorepoSubdir = hasGit && gitRoot !== undefined && gitRoot !== cwd;
  const isCiMode = process.env.CI === "true" || process.env.NODE_ENV === "test";

  if (isMonorepoSubdir && !isCiMode) {
    const continueFromSubdir = await clackYesNo(
      "You're in a subdirectory of a git repo.\n" +
      `  Current:  ${chalk.yellow(cwd)}\n` +
      `  Git root: ${chalk.green(gitRoot)}\n\n` +
      "Claude Code hooks work best when installed at the git root.\n" +
      "Continue installing here anyway?",
      false
    );

    if (!continueFromSubdir) {
      showBox(
        "Installation Cancelled",
        "Please run this command from the git root:\n\n" +
        chalk.cyan(`  cd ${gitRoot}\n  claude-workflow init`),
        "info"
      );
      process.exit(0);
    }
  }

  // Detect if we should skip services (CI/test mode or explicit options)
  // --with-mcp-proxy can override CI mode defaults
  const isTestOrCI = process.env.CI === "true" || process.env.NODE_ENV === "test";
  const skipMcpProxy = (isTestOrCI && options.withMcpProxy !== true) || options.withMcpProxy === false;

  // docker-compose.yml for mcp-proxy and dashboard
  // Placed in .claude/ to avoid conflicts with user's existing docker-compose.yml
  const claudeDir = path.join(cwd, ".claude");
  const composeFilePath = path.join(claudeDir, "docker-compose.yml");
  if (!existsSync(composeFilePath) && !skipMcpProxy) {
    try {
      // Ensure .claude directory exists
      if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }
      const composeContent = fetchFile("dist/templates/.claude/docker-compose.yml");
      writeFileSync(composeFilePath, composeContent);
      // Add convenience scripts to package.json
      injectDockerScripts(cwd);
    } catch (error) {
      console.warn(
        chalk.yellow(`Warning: Could not create docker-compose.yml: ${error instanceof Error ? error.message : String(error)}`)
      );
      console.warn(chalk.gray("Docker services will not be available. Run 'claude-workflow update' after reinstalling to retry."));
    }
  }

  // Dashboard Dockerfile and dist files - always copy if docker-compose.yml exists
  // Dashboard is part of the docker-compose setup when mcp-proxy is enabled
  if (!skipMcpProxy) {
    const dashboardDockerfilePath = path.join(cwd, ".claude/docker/dashboard/Dockerfile");
    if (!existsSync(dashboardDockerfilePath)) {
      try {
        const dockerDir = path.join(cwd, ".claude/docker/dashboard");
        if (!existsSync(dockerDir)) {
          mkdirSync(dockerDir, { recursive: true });
        }
        const dockerfileContent = fetchFile("dist/templates/.claude/docker/dashboard/Dockerfile");
        writeFileSync(dashboardDockerfilePath, dockerfileContent);
      } catch (error) {
        // Non-fatal - dashboard is optional
        console.warn(
          `Warning: Failed to create dashboard Dockerfile: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Copy lib dist files for Docker build (uses local files, not npm registry)
    // Dashboard imports from ../utils/, ../registry/, etc. so we need the full lib structure
    // Always copy with cleanFirst to avoid stale files from previous builds
    try {
      await downloadDirectory("dist/lib", ".claude/lib", { cleanFirst: true, forceUpdate: true, silent: true });
    } catch (error) {
      console.warn(
        `Warning: Failed to copy lib files: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Copy claude-workflow tarball for Docker global install
    // This allows the dashboard to run `claude-workflow update` in project directories
    try {
      const { execSync } = await import("node:child_process");
      const { copyFileSync, readdirSync } = await import("node:fs");

      // Get the installed package location (3 levels up from dist/lib/commands/)
      const packageRoot = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "../../../"
      );

      // Check if a tarball already exists in the package root
      const existingTarballs = readdirSync(packageRoot)
        .filter(f => f.startsWith("claude-workflow-") && f.endsWith(".tgz"));

      let tarballPath: string;
      if (existingTarballs.length > 0 && existingTarballs[0] !== undefined) {
        // Use existing tarball
        tarballPath = path.join(packageRoot, existingTarballs[0]);
      } else {
        // Create tarball using npm pack
        const packOutput = execSync("npm pack --pack-destination=/tmp", {
          cwd: packageRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        }).trim();
        tarballPath = path.join("/tmp", packOutput);
      }

      // Verify tarball exists and copy to .claude/
      if (existsSync(tarballPath)) {
        const tarballName = path.basename(tarballPath);
        const destPath = path.join(cwd, ".claude", tarballName);

        // Remove old tarballs first
        const claudeDir = path.join(cwd, ".claude");
        if (existsSync(claudeDir)) {
          for (const file of readdirSync(claudeDir)) {
            if (file.startsWith("claude-workflow-") && file.endsWith(".tgz")) {
              unlinkSync(path.join(claudeDir, file));
            }
          }
        }

        copyFileSync(tarballPath, destPath);
      }
    } catch {
      // Silent fail - tarball is only needed for Docker builds
    }
  }

  // mcp-proxy Dockerfile setup (container build/start moved to end of flow)
  if (!skipMcpProxy) {
    const mcpProxyDockerfilePath = path.join(cwd, ".claude/docker/mcp-proxy/Dockerfile");
    if (!existsSync(mcpProxyDockerfilePath)) {
      try {
        // Ensure docker directory exists in .claude/
        const dockerDir = path.join(cwd, ".claude/docker/mcp-proxy");
        if (!existsSync(dockerDir)) {
          mkdirSync(dockerDir, { recursive: true });
        }

        const dockerfileContent = fetchFile("dist/templates/.claude/docker/mcp-proxy/Dockerfile");
        writeFileSync(mcpProxyDockerfilePath, dockerfileContent);
      } catch (error) {
        // Non-fatal - mcp-proxy Dockerfile is optional (can be created later with 'claude-workflow update')
        console.warn(
          chalk.yellow(`Warning: Could not create mcp-proxy Dockerfile: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    }
  }

  // Get project name from package.json
  let projectName = "my-project";
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name?: string };
    projectName = pkg.name ?? path.basename(cwd);
  } catch {
    projectName = path.basename(cwd);
  }

  const skipDependencies = process.env.CI === "true" || process.env.NODE_ENV === "test";
  const skipPrompts = skipDependencies; // Skip all interactive prompts in CI/test environments

  // Interactive configuration - check for existing config first
  let config: WorkflowConfig;
  let replaceExistingConfig = false; // Track if user chose to replace existing config

  if (skipPrompts) {
    // CI/test environment - use default config without prompts
    // Allow override via environment variables for testing
    // Tailwind defaults to false in CI for backward compatibility (use TAILWIND=true to enable)
    const tailwindMode = process.env.TAILWIND === "true" || options.tailwind === true;
    const installAllComponents = process.env.INSTALL_ALL_COMPONENTS === "true";

    config = {
      components: {
        agents: installAllComponents ? availableAgents.map(a => a.id) : [], // install all agents if INSTALL_ALL_COMPONENTS=true
        docs: installAllComponents,
        hooks: {
          compliance: true,
          integrations: true,
          orchestration: true,
          proactive: true,
          quality: true,
          recovery: true,
          taskWorkflow: true,
          tracking: true,
          videoWorkflow: true,
        },
        scripts: installAllComponents,
        skills: installAllComponents ? availableSkills.map(s => s.id) : []
      },
      created: new Date().toISOString(),
      mcpServers: {
        localServers: [],
        useProxy: false
      },
      tooling: {
        codeQuality: {
          eslint: true,
          knip: true,
          stylelint: !tailwindMode, // Stylelint only in semantic CSS mode
          typescript: true,
        },
        tailwind: tailwindMode,
        gitHooks: {
          enabled: true,
          eslint: true,
          stylelint: !tailwindMode,
          tailwind: tailwindMode,
          typescript: true,
        }
      },
      updated: new Date().toISOString(),
      version: "1.0",
      packageVersion: getPackageVersion(),
      workflow: {}
    };
  } else if (configExists()) {
    // Interactive mode - check for existing config
    const useExisting = await clackYesNo(
      "Use existing config?",
      true
    );

    if (useExisting) {
      const existingConfig = loadConfig();
      if (existingConfig) {
        config = existingConfig;
        config.updated = new Date().toISOString();
        config.packageVersion = getPackageVersion();
      } else {
        // Config exists but failed to load - reconfigure
        config = await promptWorkflowConfig();
        replaceExistingConfig = true;
      }
    } else {
      config = await promptWorkflowConfig();
      replaceExistingConfig = true; // User chose to replace existing config
    }
  } else {
    config = await promptWorkflowConfig();
  }

  // Docker detection: automatically detect host path for hook paths in settings.json
  // This ensures Claude Code on the host can find hooks at correct paths
  if (isRunningInDocker()) {
    // Priority: 1) HOST_PROJECT_ROOT env var, 2) auto-detection
    const envHostRoot = process.env.HOST_PROJECT_ROOT;
    if (envHostRoot && isValidHostPath(envHostRoot)) {
      config._hostProjectRoot = envHostRoot;
      showInfo(`Docker detected, using HOST_PROJECT_ROOT: ${envHostRoot}`);
    } else {
      const autoDetected = tryAutoDetectHostPath(cwd);
      if (autoDetected) {
        config._hostProjectRoot = autoDetected;
        showInfo(`Docker detected, auto-mapped host path: ${autoDetected}`);
      } else {
        // Could not auto-detect - warn user they may need to configure manually
        const mountPattern = detectDockerMountPattern();
        showInfo(`Docker detected${mountPattern ? `: ${mountPattern.description}` : ""}`);
        showInfo("Could not auto-detect host path. Run 'claude-workflow config' to set it manually if hooks fail.");
      }
    }
  }

  // Apply feature-based component selection if --features was specified
  if (options.features && options.features.length > 0) {
    // Validate feature IDs
    const invalid = options.features.filter((f) => !isValidFeature(f));
    if (invalid.length > 0) {
      showBox(
        "Invalid Features",
        `Unknown feature(s): ${invalid.join(", ")}\n\nRun 'claude-workflow features list' to see available features.`,
        "error"
      );
      process.exit(1);
    }

    const resolved = resolveFeatures(options.features);
    const components = getComponentsForFeatures(resolved);
    config.features = resolved;
    config.components.agents = components.agents;
    config.components.skills = components.skills;
  } else if ((!config.features || config.features.length === 0) && // First-time init without --features: use defaults
    // Only set if features haven't been configured yet (preserves existing config)
    !configExists()) {
    const defaults = getDefaultFeatures();
    const resolved = resolveFeatures(defaults);
    const components = getComponentsForFeatures(resolved);
    config.features = resolved;
    config.components.agents = components.agents;
    config.components.skills = components.skills;
  }

  // Save config BEFORE downloading any files
  mkdirSync(".claude", { recursive: true });
  saveConfig(config);

  // Create global ~/.claude-workflow/ directory and migrate accounts
  // This also creates claude-proxy-config.yaml for proxy routing settings
  ensureGlobalWorkflowFolder();
  migrateAccountsToGlobalFolder();

  // Copy claude-proxy Python files from npm package to ~/.claude-proxy/python/
  // This enables docker-compose to build the proxy image from a consistent location
  ensureFstProxyPythonFiles();

  // Extract workflow settings for backward compatibility with rest of scaffold
  const selectedMcpServers = config.mcpServers;

  // Calculate total steps for unified progress
  const dirs = [
    ".claude",
    ".claude/logs", // Session logs - created with proper ownership during init
    ".claude/logos", // Logo files generated by logo-designer agent
    ".claude/banners", // Banner files generated by banner-designer agent
    "src",
    "tests",
    "data",
    "docs",
    "backlog/tasks",
    "backlog/completed",
    "backlog/drafts",
    "backlog/specs",
    "backlog/templates",
    "backlog/workflows",
    "scripts",
  ];

  // Add .claude/workflows directory (always included for examples)
  // Add .claude/architecture directory for CTO architect templates
  dirs.push(".claude/workflows", ".claude/architecture");

  // Get code quality settings for conditional file deployment
  const codeQuality = config.tooling.codeQuality;
  const isTailwindMode = config.tooling.tailwind === true;

  const files: {
    dest: string;
    icon: string;
    replaceProjectName?: boolean;
    skipIfExists?: boolean;
    src: string;
  }[] = [
    { dest: "CLAUDE.md", icon: "•", src: "dist/templates/CLAUDE.template.md" },
    { dest: ".claude/testing-setup.md", icon: "•", src: "dist/templates/testing-setup.md" },
    { dest: ".claude/backlog-reference.md", icon: "•", replaceProjectName: true, src: "dist/templates/backlog-reference.md" },
    { dest: "backlog/templates/task-template.md", icon: "•", src: "dist/templates/backlog/templates/task-template.md" },
    { dest: ".gitignore", icon: "•", skipIfExists: true, src: "dist/templates/.gitignore.template" },
    // Note: .env template removed - users should manage their own .env files
    { dest: ".claude/settings.json", icon: "•", skipIfExists: !replaceExistingConfig, src: "dist/templates/.claude/settings.template.json" },
    { dest: "vitest.config.ts", icon: "•", skipIfExists: true, src: "dist/templates/vitest.config.template.ts" },
    // Note: docker-compose.yml is created earlier in the scaffold flow (in .claude/)
    // Conditionally include code quality tool configs
    // ESLint: Use Tailwind-specific config if in Tailwind mode, otherwise standard config
    ...(codeQuality.eslint && isTailwindMode ? [
      { dest: "eslint.config.mjs", icon: "•", src: "dist/templates/eslint/tailwind.eslint.config.mjs" }
    ] : []),
    ...(codeQuality.eslint && !isTailwindMode ? [
      { dest: "eslint.config.ts", icon: "•", src: "dist/templates/eslint.config.template.ts" }
    ] : []),
    ...(codeQuality.typescript ? [{ dest: "tsconfig.json", icon: "•", src: "dist/templates/tsconfig.template.json" }] : []),
    ...(codeQuality.knip ? [{ dest: "knip.config.ts", icon: "•", src: "dist/templates/knip.config.template.ts" }] : []),
    // Stylelint: Only in semantic CSS mode (not Tailwind)
    ...(codeQuality.stylelint && !isTailwindMode ? [
      { dest: ".stylelintrc.json", icon: "•", skipIfExists: true, src: "dist/templates/.stylelintrc.template.json" }
    ] : []),
    // Tailwind v4 mode: Copy theme CSS and Prettier config
    ...(isTailwindMode ? [
      { dest: "src/styles/theme.css", icon: "•", skipIfExists: true, src: "dist/templates/tailwind/theme.css" },
      { dest: ".prettierrc.json", icon: "•", skipIfExists: true, src: "dist/templates/prettier/tailwind.prettierrc.json" },
    ] : []),
    // Logo gallery templates (always included)
    { dest: ".claude/logos/gallery.html", icon: "•", src: "dist/templates/.claude/logos/gallery.html" },
    { dest: ".claude/logos/manifest.json", icon: "•", skipIfExists: true, src: "dist/templates/.claude/logos/manifest.json" },
    // Banner gallery templates (always included)
    { dest: ".claude/banners/gallery.html", icon: "•", src: "dist/templates/.claude/banners/gallery.html" },
    { dest: ".claude/banners/manifest.json", icon: "•", skipIfExists: true, src: "dist/templates/.claude/banners/manifest.json" },
    // Video gallery templates (always included)
    { dest: ".claude/video/gallery.html", icon: "•", src: "dist/templates/.claude/video/gallery.html" },
    { dest: ".claude/video/manifest.json", icon: "•", skipIfExists: true, src: "dist/templates/.claude/video/manifest.json" },
  ];

  // Execute scaffold tasks with clack native spinners
  await p.tasks([
    {
      task: () => {
        // Git hooks (only if git is initialized and enabled in config)
        if (hasGit && config.tooling.gitHooks?.enabled !== false) {
          try {
            // Build detection object for dynamic hook generation
            const packageManager = detectPackageManager(cwd);

            // Read package.json scripts to detect available npm scripts
            const pkgPath = path.join(cwd, "package.json");
            let scripts: { lint?: string; test?: string; typecheck?: string } = {};
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
              scripts = {
                lint: pkg.scripts?.lint,
                test: pkg.scripts?.test,
                typecheck: pkg.scripts?.typecheck,
              };
            }

            // Use detected config or check for existing files
            const hasTypescript = config.tooling.codeQualityDetected?.typescript ??
              existsSync(path.join(cwd, "tsconfig.json"));
            const hasEslint = config.tooling.codeQualityDetected?.eslint ?? (
              existsSync(path.join(cwd, "eslint.config.ts")) ||
              existsSync(path.join(cwd, "eslint.config.js")) ||
              existsSync(path.join(cwd, ".eslintrc.json"))
            );
            const hasStylelint = config.tooling.codeQualityDetected?.stylelint ?? (
              existsSync(path.join(cwd, ".stylelintrc.json")) ||
              existsSync(path.join(cwd, ".stylelintrc.js")) ||
              existsSync(path.join(cwd, "stylelint.config.js")) ||
              existsSync(path.join(cwd, "stylelint.config.mjs"))
            );

            const detection = {
              eslint: { hasESLint: hasEslint },
              packageManager,
              scripts,
              stylelint: { hasStylelint },
              typescript: { hasTypeScript: hasTypescript },
            };

            // Generate dynamic pre-commit hook content
            const hookContent = generatePreCommitHook({
              detection,
              gitHooks: config.tooling.gitHooks,
            });

            mkdirSync(".git/hooks", { recursive: true });
            writeFileSync(".git/hooks/pre-commit", hookContent);
            makeExecutable(".git/hooks/pre-commit");
          } catch {
            // Silent fail for hooks
          }
        }

        // Directories
        for (const dir of dirs) {
          mkdirSync(dir, { recursive: true });
        }
      },
      title: "Creating project structure"
    },
    {
      task: async (message) => {
        message("Processing Claude configuration...");
        await downloadClaudeFolderSelective(config, { silent: true });

        // Process agent files to remove conditional content
        // Uses effective code quality (selected OR detected) to preserve lint instructions
        // when tools exist even if user chose not to replace configs
        await processAgentFiles(cwd, config);

        message("Setting up backlog system...");
        await downloadDirectory("dist/templates/backlog", "backlog", { silent: true });

        message("Installing scripts...");
        await downloadDirectory("dist/templates/scripts", "scripts", { silent: true });

        message("Installing architecture templates...");
        await downloadDirectory("dist/templates/architecture", ".claude/architecture", { silent: true });

        // Install CSS validation scripts only in semantic CSS mode (not Tailwind)
        if (!isTailwindMode) {
          message("Installing CSS validation scripts...");
          await downloadDirectory("dist/templates/.claude/scripts", ".claude/scripts", { silent: true });
        }

        // Install core hooks (always required)
        message("Installing core hooks...");
        await downloadDirectory("dist/templates/.claude/hooks/core", ".claude/hooks/core", { silent: true });

        // Install enabled hook categories based on config
        const hookMap: Record<string, string> = {
          compliance: "compliance",
          integrations: "integrations",
          orchestration: "orchestration",
          proactive: "proactive",
          quality: "quality",
          recovery: "recovery",
          taskWorkflow: "task-workflow",
          tracking: "tracking",
          videoWorkflow: "video-workflow",
        };

        for (const [key, dir] of Object.entries(hookMap)) {
          if (config.components.hooks[key as keyof typeof config.components.hooks]) {
            const hookSourcePath = path.join(PACKAGE_ROOT, `dist/templates/.claude/hooks/${dir}`);
            // Skip if hook category doesn't exist in dist (pro-only hooks downloaded separately)
            if (!existsSync(hookSourcePath)) continue;
            try {
              await downloadDirectory(
                `dist/templates/.claude/hooks/${dir}`,
                `.claude/hooks/${dir}`,
                { silent: true }
              );
            } catch {
              // Silent fail for optional hooks
            }
          }
        }

        // Process config.yml
        const configPath = "backlog/config.yml";
        if (existsSync(configPath)) {
          let configContent = readFileSync(configPath, "utf8");
          configContent = configContent.replace("{{PROJECT_NAME}}", projectName);
          writeFileSync(configPath, configContent);
        }
      },
      title: "Downloading workflow templates"
    },
    {
      task: () => {
        for (const file of files) {
          try {
            if ((file.skipIfExists ?? false) && existsSync(file.dest)) {
              continue;
            }
            let content = fetchFile(file.src);

            if (file.dest === "CLAUDE.md" || file.dest === "backlog/templates/task-template.md" || file.dest === ".claude/backlog-reference.md") {
              content = processTemplateContent(content, file.src, config, projectName);
            } else if (file.replaceProjectName ?? false) {
              content = content.replaceAll("myproject", projectName);
            }

            // For CLAUDE.md, preserve user customizations from existing file
            if (file.dest === "CLAUDE.md" && existsSync(file.dest)) {
              const existingContent = readFileSync(file.dest, "utf8");
              content = mergeUserCustomizations(content, existingContent);
            }

            // For settings.json, process hooks to absolute paths and filter by config
            if (file.dest === ".claude/settings.json") {
              const templateSettings = JSON.parse(content) as { hooks?: HooksObject };
              if (templateSettings.hooks !== undefined) {
                // Convert relative hook paths to absolute paths
                // Use host project root for hook paths when running in Docker
                const hostPathForHooks = config._hostProjectRoot ?? cwd;
                templateSettings.hooks = convertHooksToAbsolutePaths(templateSettings.hooks, cwd, hostPathForHooks);
                // Filter hooks based on enabled hook categories in config
                templateSettings.hooks = filterHooksByConfig(templateSettings.hooks, config);
              }

              content = JSON.stringify(templateSettings, undefined, 2);
            }

            const dir = path.dirname(file.dest);
            if (dir !== ".") {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(file.dest, content);
          } catch {
            // Silent fail
          }
        }

        // Apply permission preset to settings.json (runs even when file was skipped above)
        const settingsPath = ".claude/settings.json";
        if (existsSync(settingsPath)) {
          try {
            const settingsContent = readFileSync(settingsPath, "utf8");
            const settingsObj = JSON.parse(settingsContent) as Record<string, unknown>;
            const preset: PermissionPreset = options.permissions ?? (config.permissions as PermissionPreset | undefined) ?? "supervised";
            applyPermissionPreset(settingsObj, preset);
            writeFileSync(settingsPath, JSON.stringify(settingsObj, undefined, 2));
          } catch {
            // Silent fail — settings.json may be malformed
          }
        }
      },
      title: "Installing essential files"
    },
    {
      task: () => {
        try {
          if (!existsSync("package.json")) {
            throw new Error("package.json not found");
          }

          let currentPackage: PackageJson;
          try {
            const packageContent = readFileSync("package.json", "utf8");
            currentPackage = JSON.parse(packageContent) as PackageJson;
          } catch (parseError) {
            throw new Error(`Failed to parse package.json: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          }

          let templatePackage: PackageJson;
          try {
            templatePackage = JSON.parse(fetchFile("dist/templates/package.template.json")) as PackageJson;
          } catch (parseError) {
            throw new Error(`Failed to parse package template: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          }

          const filteredScripts = filterPackageScripts(templatePackage.scripts ?? {}, codeQuality);
          const filteredDeps = filterPackageDeps(templatePackage.devDependencies ?? {}, codeQuality);

          currentPackage.scripts = { ...currentPackage.scripts, ...filteredScripts };

          currentPackage.devDependencies ??= {};
          currentPackage.devDependencies = { ...currentPackage.devDependencies, ...filteredDeps };

          // Add Tailwind v4 dependencies when enabled
          if (isTailwindMode) {
            const tailwindDevDeps: Record<string, string> = {
              "tailwindcss": "^4.0.0",
              "@tailwindcss/vite": "^4.0.0",
              "eslint-plugin-tailwindcss": "^4.0.0-beta.0",
              "prettier-plugin-tailwindcss": "^0.6.12",
            };
            for (const [pkg, version] of Object.entries(tailwindDevDeps)) {
              currentPackage.devDependencies[pkg] ??= version;
            }

            // Add Tailwind-specific scripts
            currentPackage.scripts ??= {};
            currentPackage.scripts["lint:tailwind"] ??= "eslint --ext .js,.jsx,.ts,.tsx,.vue .";
          }

          // Stylelint dependencies only in semantic CSS mode (not Tailwind)
          if (codeQuality.stylelint && !isTailwindMode) {
            const stylelintDevDeps: Record<string, string> = {
              "stylelint": "^16.0.0",
              "stylelint-config-standard": "^36.0.0",
              "stylelint-order": "^6.0.0",
            };
            for (const [pkg, version] of Object.entries(stylelintDevDeps)) {
              currentPackage.devDependencies[pkg] ??= version;
            }

            currentPackage.scripts ??= {};
            currentPackage.scripts["lint:css"] ??= "stylelint 'src/**/*.css'";
            currentPackage.scripts["lint:css:fix"] ??= "stylelint 'src/**/*.css' --fix";
          }

          // Add typescript-language-server for Serena LSP support
          // Serena auto-installs LSP servers but can fail with version managers (asdf/nvm)
          // Having it as a dev dependency ensures it's always available
          if (selectedMcpServers.localServers.includes("serena")) {
            const detectedLangs = detectProjectLanguages(cwd);
            if (detectedLangs.includes("typescript") || detectedLangs.includes("javascript")) {
              currentPackage.devDependencies["typescript-language-server"] ??= "^4.3.3";
            }
          }

          if (templatePackage.type !== undefined) {
            currentPackage.type = templatePackage.type;
          }

          const JSON_INDENT_SPACES = 2;
          writeFileSync("package.json", JSON.stringify(currentPackage, undefined, JSON_INDENT_SPACES));
        } catch (error) {
          console.warn(`Warning: Failed to update package.json: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      title: "Configuring package.json"
    },
    {
      enabled: !skipDependencies,
      task: async (message) => {
        const packageManager = detectPackageManager(cwd);
        message(`Running ${packageManager} install...`);
        await executePackageManagerInstall(packageManager, cwd);

        message("Installing backlog CLI...");
        try {
          await executeGlobalNpmInstall("backlog.md", cwd);
          const platform = process.platform;
          const arch = process.arch;
          if (platform === "darwin" && arch === "arm64") {
            try {
              await executeGlobalNpmInstall("backlog.md-darwin-arm64", cwd);
            } catch {
              try {
                await executeGlobalNpmInstall("backlog.md-darwin-x64", cwd);
              } catch {
                // Silent fail
              }
            }
          }
        } catch {
          // Silent fail
        }
      },
      title: "Installing dependencies"
    },
    {
      task: async () => {
        try {
          await generateMcpJson(selectedMcpServers);
        } catch {
          // Silent fail
        }
      },
      title: "Generating MCP configuration"
    },
    {
      enabled: selectedMcpServers.localServers.includes("serena"),
      task: () => {
        try {
          // Create .serena directory
          const serenaDir = path.join(cwd, ".serena");
          if (!existsSync(serenaDir)) {
            mkdirSync(serenaDir, { recursive: true });
          }

          // Detect project languages for LSP support
          const detectedLanguages = detectProjectLanguages(cwd);
          const languagesSection =
            detectedLanguages.length > 0
              ? `# Programming language(s) for LSP support
languages:
${detectedLanguages.map((lang) => `  - ${lang}`).join("\n")}

`
              : "";

          const configPath = path.join(serenaDir, "project.yml");

          // Check if project.yml already exists and user wants to keep it
          if (existsSync(configPath) && replaceExistingConfig) {
            // Preserve existing config, but ensure languages are defined
            const existingConfig = readFileSync(configPath, "utf8");
            if (!existingConfig.includes("languages:") && detectedLanguages.length > 0) {
              // Prepend languages section to existing config
              const updatedConfig = `# Programming language(s) for LSP support
languages:
${detectedLanguages.map((lang) => `  - ${lang}`).join("\n")}

${existingConfig}`;
              writeFileSync(configPath, updatedConfig);
            }
            // If languages already defined or no languages detected, keep existing config
          } else {
            // Write new project.yml with languages and excluded tools
            // Note: activate_project is kept enabled for monorepo support
            const serenaConfig = `# Serena project configuration
${languagesSection}# These tools are excluded to reduce context overhead in Claude Code
# Note: activate_project is kept enabled for monorepo project switching

excluded_tools:
  # Manual fallback tool - already injected via system prompt
  - initial_instructions

  # Onboarding tools - not needed after initial setup
  - check_onboarding_performed
  - onboarding

  # Thinking/reflection tools - add prompting overhead without benefit
  - think_about_collected_information
  - think_about_task_adherence
  - think_about_whether_you_are_done

  # Memory tools - Claude Code sessions are stateless, use CLAUDE.md instead
  - write_memory
  - read_memory
  - list_memories
  - delete_memory
  - edit_memory
`;
            writeFileSync(configPath, serenaConfig);
          }
        } catch {
          // Silent fail - Serena will work without this config
        }
      },
      title: "Configuring Serena MCP"
    }
  ]);

  // Interactive API key collection (after progress bar)
  if (!skipDependencies && selectedMcpServers.localServers.some((s: string) =>
    availableServers.some((opt: McpServerOption) => opt.name === s && (opt.requiresKey ?? false))
  )) {
    console.log("");
    showInfo("Some selected servers require API keys:");
    await collectRequiredKeys(selectedMcpServers.localServers);
  }

  // Register project in global registry
  try {
    const { getProjectRegistry } = await import("../services/project-registry.js");
    const { readFileSync } = await import("node:fs");
    const registry = getProjectRegistry();

    // Get installed version from this package's package.json
    let installedVersion = "unknown";
    try {
      // Path from dist/lib/commands/scaffold.js to package.json is 3 levels up
      const packagePath = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "../../../package.json"
      );
      const packageContent = readFileSync(packagePath, "utf8");
      const pkg = JSON.parse(packageContent) as { version?: string };
      installedVersion = pkg.version ?? "unknown";
    } catch {
      // Use default version if package.json can't be read
    }

    // Use HOST_PATH_FOR_SETTINGS when running in Docker to register with host path
    // This ensures the project registry uses paths that work on the host system
    const hostProjectPath = process.env.HOST_PATH_FOR_SETTINGS ?? path.resolve(cwd);
    registry.register({
      installedVersion,
      name: projectName,
      pwd: hostProjectPath,
    });
  } catch {
    // Non-fatal - registry is optional for backward compatibility
  }

  // Docker container setup - runs AFTER clack prompts have finished
  // This is the final step to avoid interrupting the interactive configuration flow
  let dockerContext: DockerSetupContext | undefined;
  if (!skipMcpProxy) {
    dockerContext = {
      cwd,
      mcpProxyEnabled: !skipMcpProxy,
    };
    await setupDockerContainers(dockerContext);
  }

  // Success message with service URLs
  console.log();

  // Build service summary if Docker containers were deployed
  if (dockerContext?.deployedServices !== undefined && dockerContext.deployedServices.length > 0) {
    console.log(chalk.bold("Services available:"));
    for (const service of dockerContext.deployedServices) {
      const url = service.url ?? `http://localhost:${String(service.port)}`;
      console.log(`  ${chalk.green("*")} ${service.name}: ${chalk.cyan(url)}`);
    }
    console.log();
  }

  console.log(chalk.hex("#dc2626")("You are ready to start cooking.\n"));
}


/**
 * Detect the package manager used in the project based on lockfiles
 * Priority: bun > pnpm > yarn > npm (most specific lockfile wins)
 *
 * @param projectPath - Path to the project root
 * @returns The detected package manager
 */
function detectPackageManager(projectPath: string): PackageManager {
  // Check for lockfiles in order of specificity
  if (existsSync(path.join(projectPath, "bun.lockb")) || existsSync(path.join(projectPath, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(path.join(projectPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(projectPath, "yarn.lock"))) {
    return "yarn";
  }
  // Default to npm
  return "npm";
}

/**
 * Detect programming languages used in the project based on config files.
 * Scans root and immediate subdirectories to support monorepos.
 * Returns array of Serena-compatible language identifiers.
 */
function detectProjectLanguages(projectPath: string): string[] {
  const languages = new Set<string>();

  // Config files that indicate language
  const configChecks: [string, string][] = [
    ["tsconfig.json", "typescript"],
    ["jsconfig.json", "javascript"],
    ["package.json", "typescript"], // Assume TS for Node projects, will be overridden if no .ts files
    ["pyproject.toml", "python"],
    ["setup.py", "python"],
    ["requirements.txt", "python"],
    ["Pipfile", "python"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "java"],
    ["Gemfile", "ruby"],
    ["composer.json", "php"],
    ["deno.json", "typescript"],
    ["Anchor.toml", "rust"], // Solana Anchor projects
  ];

  // Directories to skip when scanning (sorted alphabetically)
  const excludedDirs = new Set([
    ".git",
    ".next",
    ".nuxt",
    ".nx",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "venv",
  ]);

  // Helper to check a directory for language config files
  const checkDirectory = (dirPath: string): void => {
    for (const [configFile, lang] of configChecks) {
      if (existsSync(path.join(dirPath, configFile))) {
        languages.add(lang);
      }
    }
  };

  // Check root directory
  checkDirectory(projectPath);

  // Check immediate subdirectories (catches contracts/, api/, packages/*, etc.)
  try {
    const entries = readdirSync(projectPath);
    for (const entry of entries) {
      if (excludedDirs.has(entry) || entry.startsWith(".")) {
        continue;
      }
      const subdir = path.join(projectPath, entry);
      try {
        if (statSync(subdir).isDirectory()) {
          checkDirectory(subdir);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch {
    // Skip if we can't read directory
  }

  // If we detected package.json but no tsconfig anywhere, check for actual .ts files
  if (languages.has("typescript") && !existsSync(path.join(projectPath, "tsconfig.json"))) {
    // Check src/ for .ts files
    const srcDir = path.join(projectPath, "src");
    if (existsSync(srcDir)) {
      try {
        const files = readdirSync(srcDir);
        const hasTsFiles = files.some((f: string) => f.endsWith(".ts") || f.endsWith(".tsx"));
        if (!hasTsFiles) {
          languages.delete("typescript");
          languages.add("javascript");
        }
      } catch {
        // Keep typescript assumption
      }
    } else {
      // No src dir and no tsconfig, likely JS
      languages.delete("typescript");
      languages.add("javascript");
    }
  }

  return [...languages];
}

/**
 * Create global ~/.claude-workflow/ directory and copy claude-proxy config.
 * This is the new consolidated config location replacing ~/.ccproxy/.
 * Only copies config on init if it doesn't exist - never overwrites on update.
 */
function ensureGlobalWorkflowFolder(): void {
  const globalWorkflowDir = path.join(os.homedir(), ".claude-workflow");

  try {
    // Create ~/.claude-workflow/ directory if needed
    if (!existsSync(globalWorkflowDir)) {
      mkdirSync(globalWorkflowDir, { recursive: true });
    }

    // Copy claude-proxy-config.yaml to global folder (only on init, never overwrite)
    const globalConfigPath = path.join(globalWorkflowDir, "claude-proxy-config.yaml");
    if (!existsSync(globalConfigPath)) {
      try {
        const configTemplate = fetchFile("dist/templates/claude-proxy-config.yaml");
        writeFileSync(globalConfigPath, configTemplate);
      } catch {
        // Template might not exist yet during development - create minimal config
        const minimalConfig = `# claude-proxy configuration
version: 1
routing:
  agent_routing: true
  model_routing: false
fallback:
  default_model: "claude-sonnet-4-20250514"
  timeout_ms: 120000
  retry_attempts: 3
  retry_delay_ms: 1000
accounts:
  file: "claude-accounts.json"
  default: null
`;
        writeFileSync(globalConfigPath, minimalConfig);
      }
    }
  } catch (error) {
    // Non-fatal - just log warning
    console.warn(
      `Could not create global workflow folder: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Resolve claude-proxy Python source directory from various locations.
 * Handles npm workspace symlinks, monorepo development paths, and fallbacks.
 *
 * @param packageRoot - Root directory of the claude-workflow package
 * @returns Resolved Python source directory path, or undefined if not found
 */
function resolveFstProxyPythonPath(packageRoot: string): string | undefined {

  // Priority order for finding Python files:
  // 1. Scoped package in node_modules (resolves symlinks for file: dependencies)
  // 2. Direct packages/ directory for monorepo development
  // 3. Legacy unscoped package name

  const pathsToCheck = [
    // Scoped package @fullstacktard/claude-proxy
    path.join(packageRoot, "node_modules", "@fullstacktard", "claude-proxy", "python"),
    // Monorepo development - direct packages path
    path.join(packageRoot, "packages", "claude-proxy", "python"),
    // Legacy unscoped package
    path.join(packageRoot, "node_modules", "claude-proxy", "python"),
  ];

  for (const pythonPath of pathsToCheck) {
    try {
      // Try to resolve the path (handles symlinks created by file: dependencies)
      const resolvedPath = realpathSync(pythonPath);
      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }
    } catch {
      // Path doesn't exist or can't be resolved - try next
      if (existsSync(pythonPath)) {
        return pythonPath;
      }
    }
  }

  return undefined;
}

/**
 * Copy claude-proxy Python source files from npm package to ~/.claude-proxy/python/
 * This allows docker-compose to build the proxy image from a consistent location.
 *
 * The Python files come from the claude-proxy npm package which is a dependency
 * of claude-workflow. On init/update, we copy them to the global location.
 *
 * For npm workspace setups with file: dependencies, this function:
 * 1. Resolves symlinks to find the actual package location
 * 2. Falls back to running npm install if the package is not found
 */
function ensureFstProxyPythonFiles(): void {
  const fstProxyDir = path.join(os.homedir(), ".claude-proxy");
  const pythonTargetDir = path.join(fstProxyDir, "python");

  try {
    // Get the package root (3 levels up from dist/lib/commands/)
    const packageRoot = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../"
    );

    // Try to find the Python source directory
    let pythonSourceDir = resolveFstProxyPythonPath(packageRoot);

    // If not found, try running npm install to resolve workspace dependencies
    if (!pythonSourceDir) {
      try {
        // Check if we're in a workspace setup (package.json has workspaces or file: dependencies)
        const packageJsonPath = path.join(packageRoot, "package.json");
        if (existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            workspaces?: string[];
          };

          const hasFstProxyDep =
            packageJson.dependencies?.["@fullstacktard/claude-proxy"]?.startsWith("file:") ||
            packageJson.devDependencies?.["@fullstacktard/claude-proxy"]?.startsWith("file:");

          const hasWorkspaces = Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0;

          if (hasFstProxyDep || hasWorkspaces) {
            // Run npm install to resolve workspace dependencies
            console.log(chalk.gray("Installing workspace dependencies..."));
            execSync("npm install --ignore-scripts --prefer-offline", {
              cwd: packageRoot,
              encoding: "utf8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: INSTALL_TIMEOUT
            });

            // Retry finding the Python source directory
            pythonSourceDir = resolveFstProxyPythonPath(packageRoot);
          }
        }
      } catch (installError) {
        // npm install failed - log but continue to check if files are available anyway
        console.warn(
          chalk.yellow(`Warning: Could not install workspace dependencies: ${installError instanceof Error ? installError.message : String(installError)}`)
        );
      }
    }

    if (!pythonSourceDir) {
      // Silent fail - proxy Python files are optional for many use cases
      // Only users who need the claude-proxy Docker container will be affected
      return;
    }

    // Ensure target directories exist
    if (!existsSync(fstProxyDir)) {
      mkdirSync(fstProxyDir, { recursive: true });
    }

    // Copy Python files recursively
    copyDirectoryRecursive(pythonSourceDir, pythonTargetDir);

    // Also copy default config files if they don't exist
    const configFiles = ["litellm_config.yaml", "routing_config.yaml"];
    for (const configFile of configFiles) {
      const targetPath = path.join(fstProxyDir, configFile);
      if (!existsSync(targetPath)) {
        const sourcePath = path.join(pythonSourceDir, configFile);
        if (existsSync(sourcePath)) {
          const content = readFileSync(sourcePath, "utf8");
          writeFileSync(targetPath, content);
        }
      }
    }

    // Copy agent_hashes.json if it doesn't exist
    const hashesTarget = path.join(fstProxyDir, "agent_hashes.json");
    if (!existsSync(hashesTarget)) {
      const hashesSource = path.join(pythonSourceDir, "fst_claude_proxy", "registry", "agent_hashes.json");
      if (existsSync(hashesSource)) {
        const content = readFileSync(hashesSource, "utf8");
        writeFileSync(hashesTarget, content);
      }
    }

  } catch (error) {
    console.warn(
      `Could not copy claude-proxy Python files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Recursively copy a directory and its contents.
 */
function copyDirectoryRecursive(source: string, target: string): void {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  const entries = readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      // Skip __pycache__ and other generated directories
      if (entry.name === "__pycache__" || entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      // Skip .pyc files
      if (entry.name.endsWith(".pyc")) {
        continue;
      }
      const content = readFileSync(sourcePath);
      writeFileSync(targetPath, content);
    }
  }
}

/**
 * Migrate account data from ~/.ccproxy/ to ~/.claude-workflow/
 * Preserves existing data and maintains backward compatibility.
 * Only migrates if old file exists and new file doesn't.
 */
function migrateAccountsToGlobalFolder(): void {
  const oldAccountsPath = path.join(os.homedir(), ".ccproxy", "accounts.json");
  const newAccountsPath = path.join(os.homedir(), ".claude-workflow", "claude-accounts.json");

  // Skip if new file already exists (don't overwrite)
  if (existsSync(newAccountsPath)) {
    return;
  }

  // Migrate if old file exists
  if (existsSync(oldAccountsPath)) {
    // Use unique temp file name to prevent race conditions
    const tempPath = `${newAccountsPath}.tmp.${Date.now()}.${process.pid}`;
    try {
      const oldContent = readFileSync(oldAccountsPath, "utf8");
      const oldData = JSON.parse(oldContent) as Record<string, unknown>;

      // Ensure target directory exists
      const targetDir = path.dirname(newAccountsPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      // Write to new location with atomic pattern
      writeFileSync(tempPath, JSON.stringify(oldData, null, 2), { mode: 0o600 });
      renameSync(tempPath, newAccountsPath);

      console.log(chalk.green("Migrated accounts from ~/.ccproxy/ to ~/.claude-workflow/"));
    } catch (error) {
      // Always attempt cleanup and log failures
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        console.warn(
          `Warning: Could not clean up temp file ${tempPath}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
      console.warn(
        `Account migration warning: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Execute a command securely using execFile with proper validation and timeout
 */
async function executeCommand(command: string, args: string[] = [], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sanitize?: boolean;
  timeout?: number;
} = {}): Promise<{ stderr: string; stdout: string; }> {
  const {
    cwd = process.cwd(),
    env = process.env,
    sanitize = true,
    timeout = COMMAND_TIMEOUT
  } = options;

  try {
    // Basic command validation
    if (!command || typeof command !== "string") {
      throw new SecureCommandError("Command must be a non-empty string");
    }

    // Sanitize command and arguments if requested
    if (sanitize) {
      // Only allow specific safe commands
      const allowedCommands = ["git", "npm", "node", "npx", "pnpm", "yarn", "bun"];
      const commandName = command.split(" ")[0];

      if (commandName !== undefined && !allowedCommands.includes(commandName)) {
        throw new SecureCommandError(`Command not allowed: ${commandName}`);
      }

      // Validate arguments for dangerous patterns
      for (const arg of args) {
        if (typeof arg === "string") {
          // Prevent command injection through arguments
          if (arg.includes("&&") || arg.includes("||") || arg.includes("|") || arg.includes(";")) {
            throw new SecureCommandError(`Dangerous characters in argument: ${arg}`);
          }

          // Prevent directory traversal
          if (arg.includes("../") || arg.includes("..\\")) {
            throw new SecureCommandError(`Directory traversal not allowed: ${arg}`);
          }
        }
      }
    }

    return await new Promise<{ stderr: string; stdout: string }>((resolve, reject) => {
      const child = execFile(command, args, {
        cwd,
        encoding: "utf8",
        env,
        maxBuffer: MAX_BUFFER_SIZE,
        timeout
      }, (error, stdout, stderr) => {
        if (error) {
          const execError = error as Error & { code?: number; exitCode?: number; signal?: string };
          reject(new SecureCommandError(
            `Command failed: ${command} ${args.join(" ")} - ${error.message}`,
            execError.exitCode ?? execError.code,
            execError.signal
          ));
        } else {
          resolve({ stderr: stderr || "", stdout: stdout || "" });
        }
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new SecureCommandError(`Command timeout after ${String(timeout)}ms`));
      }, timeout);

      child.on("close", () => {
        clearTimeout(timeoutId);
      });
    });
  } catch (error) {
    if (error instanceof SecureCommandError) {
      throw error;
    }
    throw new SecureCommandError(
      `Unexpected error executing command: ${command}`,
      undefined,
      undefined
    );
  }
}

/**
 * Execute global npm install securely
 */
async function executeGlobalNpmInstall(packageName: string, cwd: string = process.cwd()): Promise<void> {
  try {
    await executeCommand("npm", ["install", "-g", packageName], {
      cwd,
      sanitize: false, // global npm installs are considered safe in this context
      timeout: INSTALL_TIMEOUT
    });
  } catch (error) {
    console.warn(`Failed to install ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
    // Don't throw - package installation failure should not stop the scaffold process
  }
}

import * as p from "@clack/prompts";
import chalk from "chalk";

import type { WorkflowConfig } from "../types/workflow-config.js";

import { availableAgents, availableSkills } from "../component-registry.js";
import {
  getComponentsForFeatures,
  getDefaultFeatures,
  isValidFeature,
  resolveFeatures,
} from "../feature-registry.js";
import {
  downloadClaudeFolderSelective,
  downloadDirectory,
  fetchFile,
  makeExecutable,
} from "../file-operations.js";
import { generatePreCommitHook } from "../hook-generator.js";
import {
  convertHooksToAbsolutePaths,
  filterHooksByConfig,
  type HooksObject,
} from "./update.js";
import {
  clackYesNo,
  showBox,
  showHeader,
  showInfo,
} from "../ui.js";
import { checkForUpdates, performUpdate } from "../update-manager.js";
import { configExists, getPackageVersion, loadConfig, saveConfig } from "../utils/config-manager.js";
import { promptWorkflowConfig } from "../utils/configPrompts.js";
import { applyPermissionPreset } from "../utils/permissions.js";
import {
  detectDockerMountPattern,
  isRunningInDocker,
  isValidHostPath,
  tryAutoDetectHostPath,
} from "../utils/docker-utils.js";
import {
  availableServers,
  collectRequiredKeys,
  generateMcpJson,
  type McpServerOption
} from "../utils/mcp-selection.js";
import {
  filterPackageDeps,
  filterPackageScripts,
  getEffectiveCodeQuality,
  mergeUserCustomizations,
  processAgentContent,
  processTemplateContent,
} from "../utils/template-processor.js";


/**
 * Execute install command for the detected package manager
 *
 * @param packageManager - The package manager to use
 * @param cwd - Working directory
 */
async function executePackageManagerInstall(packageManager: PackageManager, cwd: string): Promise<void> {
  try {
    await executeCommand(packageManager, ["install"], {
      cwd,
      sanitize: false,
      timeout: INSTALL_TIMEOUT
    });
  } catch (error) {
    console.warn(`${packageManager} install failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Find the git root directory by traversing up from the given path
 * Returns null if no .git directory is found
 *
 * @param startPath - Directory to start searching from
 * @returns Absolute path to git root, or null if not found
 */
function findGitRoot(startPath: string): string | undefined {
  let currentDir = path.resolve(startPath);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    if (existsSync(path.join(currentDir, ".git"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory as well
  if (existsSync(path.join(root, ".git"))) {
    return root;
  }

  return undefined;
}




/**
 * Inject docker convenience scripts into package.json
 * Adds scripts for Docker services (mcp-proxy, dashboard, claude-proxy)
 */
function injectDockerScripts(cwd: string): void {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
    const scripts = pkg.scripts ?? {};

    // Docker scripts to inject (only if not already present)
    // PROJECT_PATH defaults to $HOME if not set - allows dashboard to scan for projects
    // DOCKER_GID is auto-detected for Docker socket access in dashboard container
    const dockerScripts: Record<string, string> = {
      "claude-workflow:docker:up": "PROJECT_PATH=${PROJECT_PATH:-$HOME} DOCKER_GID=$(getent group docker | cut -d: -f3) docker compose -f .claude/docker-compose.yml up -d",
      "claude-workflow:docker:down": "docker compose -f .claude/docker-compose.yml down",
      "claude-workflow:docker:logs": "docker compose -f .claude/docker-compose.yml logs -f",
      "claude-workflow:docker:restart": "PROJECT_PATH=${PROJECT_PATH:-$HOME} DOCKER_GID=$(getent group docker | cut -d: -f3) docker compose -f .claude/docker-compose.yml down && PROJECT_PATH=${PROJECT_PATH:-$HOME} DOCKER_GID=$(getent group docker | cut -d: -f3) docker compose -f .claude/docker-compose.yml up -d",
      "claude-workflow:docker:build": "PROJECT_PATH=${PROJECT_PATH:-$HOME} DOCKER_GID=$(getent group docker | cut -d: -f3) docker compose -f .claude/docker-compose.yml build",
      "claude-workflow:docker:ps": "docker compose -f .claude/docker-compose.yml ps",
    };

    let modified = false;
    for (const [name, command] of Object.entries(dockerScripts)) {
      if (scripts[name] === undefined) {
        scripts[name] = command;
        modified = true;
      }
    }

    if (modified) {
      pkg.scripts = scripts;
      const JSON_INDENT_SPACES = 2;
      writeFileSync(packageJsonPath, JSON.stringify(pkg, undefined, JSON_INDENT_SPACES) + "\n");
    }
  } catch {
    // Non-fatal - skip if package.json can't be modified
  }
}

/**
 * Process agent markdown files to remove conditional content
 * based on effective code quality (selected OR detected in project)
 *
 * @param targetDir - Target project directory
 * @param config - Workflow configuration (uses effective code quality)
 */
async function processAgentFiles(targetDir: string, config: WorkflowConfig): Promise<void> {
  try {
    const { glob } = await import("glob");

    // Use effective code quality (selected OR detected in project)
    const effectiveCodeQuality = getEffectiveCodeQuality(config);

    // Find all agent markdown files
    const agentFiles = await glob(`${targetDir}/.claude/agents/**/*.md`);

    for (const filePath of agentFiles) {
      try {
        const content = readFileSync(filePath, "utf8");
        const processed = processAgentContent(content, effectiveCodeQuality);

        // Only write if content changed
        if (processed !== content) {
          writeFileSync(filePath, processed);
        }
      } catch {
        // Skip files that can't be read/written (silently)
        continue;
      }
    }
  } catch {
    // Silent fail - don't break scaffold if agent processing fails
    // This is intentional to prevent scaffold failure on edge cases
  }
}

/**
 * Setup Docker containers for mcp-proxy and dashboard.
 * This runs AFTER clack prompts have finished to avoid interrupting the interactive flow.
 * Uses a single spinner for clean UX - no individual prompts or build logs shown.
 * Populates context.deployedServices for final summary display.
 */
async function setupDockerContainers(context: DockerSetupContext): Promise<void> {
  const { mcpProxyEnabled } = context;

  // Track which services were set up for final summary
  const services: Array<{ name: string; port: number; url?: string }> = [];

  // Early exit if nothing to do
  if (!mcpProxyEnabled) {
    return;
  }

  // Validate Docker is available before starting
  try {
    execSync("docker ps", { stdio: "ignore", timeout: 3000 });
  } catch {
    showBox(
      "Docker Required",
      "Docker is required for container services.\n\n" +
        "Install Docker Desktop:\n" +
        chalk.red("  https://docs.docker.com/get-docker/") +
        "\n\nThen run this command again.",
      "error"
    );
    process.exit(1);
  }

  // Single spinner for all Docker operations
  const dockerSpinner = p.spinner();
  dockerSpinner.start("Building and deploying containers...");

  try {
    // mcp-proxy setup
    if (mcpProxyEnabled) {
      const { McpProxyManager } = await import("../mcpproxy/manager.js");
      const mcpProxyManager = new McpProxyManager();
      const installStatus = mcpProxyManager.detectInstallation();

      // Check if already running - skip build/start
      const mcpProxyStatus = await mcpProxyManager.getStatus();
      if (mcpProxyStatus.running) {
        services.push({ name: "mcp-proxy", port: 3847 });
      } else {
        // Build image if needed (silent mode)
        if (!installStatus.imageExists) {
          mcpProxyManager.build({ silent: true });
        }

        // Start container
        await mcpProxyManager.start();
        services.push({ name: "mcp-proxy", port: 3847 });
      }
    }

    // claude-proxy and Dashboard are part of docker-compose and start with other services
    services.push(
      { name: "claude-proxy", port: 4000, url: "http://localhost:4000" },
      { name: "Dashboard", port: 3850, url: "http://localhost:3850" }
    );

    dockerSpinner.stop("Containers deployed successfully");

  } catch (error) {
    dockerSpinner.stop("Container deployment failed");

    const errorMessage = error instanceof Error ? error.message : String(error);

    showBox(
      "Docker Deployment Failed",
      `Failed to deploy containers: ${errorMessage}\n\n` +
        "Troubleshooting:\n" +
        "1. Check Docker is running: docker ps\n" +
        "2. Check container logs: docker compose -f .claude/docker-compose.yml logs\n" +
        "3. Try manual build:\n" +
        "   docker compose -f .claude/docker-compose.yml build\n" +
        "4. Try manual start:\n" +
        "   docker compose -f .claude/docker-compose.yml up -d",
      "error"
    );
    process.exit(1);
  }

  // Store services for final summary (used by caller)
  context.deployedServices = services;
}