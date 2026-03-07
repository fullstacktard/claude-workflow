# claude-workflow

Multi-agent orchestration CLI for [Claude Code](https://claude.ai/code). Define workflows in YAML, spawn 54 specialized AI agents, and monitor everything in real time.

**[Website](https://claudeworkflow.com)** | **[GitHub](https://github.com/fullstacktard/claude-workflow)**

## Install

```bash
npm install -g claude-workflow
```

Requires Node.js >= 18.

## What You Get

- **54 specialized agents** -- frontend, backend, DevOps, QA, design, 3D, and more
- **YAML workflows** -- define multi-step pipelines that chain agents together
- **Real-time dashboard** -- monitor agents, logs, and tasks in a web UI
- **MCP proxy** -- unified access to MCP tool servers (3 free, 15+ pro, 25+ all) through one connection
- **Auto-spawning** -- agents automatically decompose tasks and spawn sub-agents in parallel
- **Pro module system** -- unlock additional agents, workflows, and capabilities

## Quick Start

```bash
# 1. Install globally
npm install -g claude-workflow

# 2. Scaffold a project
claude-workflow init

# 3. Start Docker services (dashboard, proxy, MCP)
docker compose -f .claude/docker-compose.yml up -d

# 4. Create a workflow brief
claude-workflow draft "user authentication"

# 5. Hand the brief to Claude Code
# Paste @backlog/workflows/user-authentication/brief.md in Claude Code
```

## Commands

### Project Setup

```bash
claude-workflow init                    # Scaffold .claude/, Docker, agents, workflows
claude-workflow init --tailwind         # Enable Tailwind CSS v4 mode
claude-workflow update                  # Update templates without overwriting CLAUDE.md
claude-workflow update --force          # Force overwrite existing files
claude-workflow uninstall               # Remove from project registry
```

### Workflows

```bash
claude-workflow draft "my feature"           # Create a feature brief
claude-workflow draft "nav" --type ui        # UI generation brief
claude-workflow draft "api" --type qa        # QA testing brief
claude-workflow draft "cleanup" --type lint  # Lint fix brief
claude-workflow draft "walkthrough" --type demo  # Demo video brief
```

Brief types: `feature` (default), `qa`, `ui`, `lint`, `demo`, `surreal`, `redesign`, `setup`.

### Pro License

```bash
claude-workflow activate <key>          # Activate a license key
claude-workflow activate --refresh      # Refresh license JWT
claude-workflow activate --sync         # Download/update pro modules
claude-workflow activate --deactivate   # Remove license, revert to free
claude-workflow activate --status       # Show license status

claude-workflow pro status              # Detailed pro tier info
claude-workflow pro update              # Check for pro module updates
claude-workflow features list           # List all features by tier
```

### Utilities

```bash
claude-workflow generate-agent-hashes   # Regenerate agent hash registry
```

## Project Structure

```
your-project/
  .claude/
    agents/          # Agent definitions (markdown)
    hooks/           # Pre/post tool-use hooks
    skills/          # Reusable skill modules
    schemas/         # JSON schemas for validation
    workflows/       # YAML workflow definitions
    commands/        # CLI slash commands
    docker-compose.yml
  backlog/           # Task management
  CLAUDE.md          # Project instructions for Claude Code
```

## Docker Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3850 | Real-time agent visualization, logs, account management |
| Claude Proxy | 4000 | LiteLLM-based model routing and account rotation |
| MCP Proxy | 3100 | Multiplexes 50+ MCP tool servers behind one endpoint |

## Pricing

| | Free | Pro | All |
|---|---|---|---|
| **Price** | $0 | $20/mo | $29/mo |
| **Agents** | 12 core agents | 48 agents | 54 agents |
| **Workflows** | Core workflow | All workflows | All workflows |
| **Dashboard** | -- | Real-time dashboard | Real-time dashboard |
| **Claude Proxy** | -- | Model routing | Model routing |
| **MCP Proxy** | Included | Included | Included |
| **X/Twitter Automation** | -- | -- | 6 agents |
| **3D Rigging/Animation** | -- | -- | 3 agents |

**[Subscribe](https://polar.sh/claude-workflow)** to unlock Pro or All.

## How Workflows Work

1. **Draft** a brief: `claude-workflow draft "my feature"`
2. **Fill in** the generated brief template
3. **Hand it to Claude**: reference `@backlog/workflows/<slug>/brief.md` in Claude Code
4. Claude reads the brief, picks agents, and executes the workflow automatically

## License

MIT
