# claude-workflow

Automated Claude Code configuration setup for existing projects with comprehensive task management, git worktree workflows, and testing infrastructure.

<p align="center">
  <img src="https://vhs.charm.sh/vhs-4fMecGcxwsMvgn4ixWkX0K.gif" alt="Demo" />
</p>

## Recent Changes

### v1.0.5 (Latest)
- **Worktree Configuration**: Added optional worktree workflow - choose during init or use `--worktrees`/`--no-worktrees` flags
- **Simplified Workflows**: For non-worktree users, all worktree references are removed from templates

### v1.0.3
- **Init Flow Improvement**: Update check now runs before header display

[View full changelog →](https://github.com/fullstacktard/claude-workflow/blob/main/CHANGELOG.md)

## Requirements

- **Node.js 18+** (ESM support required)
- **Git** (must be installed and configured)
- **npm** or **yarn** package manager
- Existing project with `package.json`
- Git initialized (`git init`)
- Git remote configured (`git remote add origin <url>`)

## Installation

```bash
npm install -g claude-workflow
```

## Quick Start

### Add Claude Code configuration to an existing project

```bash
# Navigate to your existing project
cd your-project

# Run the init command
claude-workflow init
```

### What happens during init:

The CLI will:

1. **Prompt for workflow preferences:**
   - Use Git worktrees for task isolation? (default: yes)
   - Git sync before each task? (default: yes, only if using worktrees)
   - Use pull requests instead of direct merges? (default: yes, only if using worktrees)

2. **Create complete project structure:**
   - `src/`, `tests/`, `docs/`, `data/`, `scripts/` directories
   - Complete backlog system with `tasks/`, `completed/`, `drafts/`, `templates/`

3. **Install Claude Code configuration:**
   - `.claude/settings.json` with permissions
   - `.claude/worktree-setup.md` with git worktree workflows
   - `.claude/backlog-reference.md` with task management guide
   - `.claude/testing-setup.md` with testing standards
   - Notification scripts (`notify.sh`, `enhanced-notify.sh`)

4. **Set up development files:**
   - `CLAUDE.md` - Base AI instructions (auto-managed, don't edit!)
   - `CLAUDE_PROJECT.md` - Your project-specific customizations
   - `vitest.config.js` - Testing configuration
   - `.gitignore` - Sensible defaults (only if missing)
   - `.env` - Environment template (only if missing)
   - `main.js` - Entry point template

5. **Configure package.json:**
   - Add Vitest and testing scripts
   - Set `"type": "module"` for ESM support
   - Preserve all existing scripts and dependencies

6. **Install git hooks:**
   - Pre-commit hook for task validation

7. **Install backlog CLI:**
   - Automatically installs `backlog.md` CLI globally
   - Configured with your project name

## Typical Workflows

### Basic Development Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Run init                                                 │
│    claude-workflow init                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Customize CLAUDE_PROJECT.md                              │
│    Add your API endpoints, DB schema, deployment info       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Tell Claude what to build                                │
│    Claude reads your context and creates structured tasks   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Claude works on tasks                                    │
│    Creates worktrees, implements features, runs tests       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Review and merge                                         │
│    Claude creates PRs, you review, merge to main            │
└─────────────────────────────────────────────────────────────┘
```

### Multi-Project Setup

```
Project A (crypto-trading-bot)
    │
    ├─ claude-workflow init
    ├─ Edit CLAUDE_PROJECT.md (add trading API details)
    └─ Claude builds features

Project B (nft-marketplace)
    │
    ├─ claude-workflow init
    ├─ Edit CLAUDE_PROJECT.md (add blockchain config)
    └─ Claude builds features

Same Claude behavior, different project context!
```

## Use Case Examples

### Example 1: Solo Crypto Developer

**Scenario:** Building 3 different Solana DeFi projects simultaneously.

**Before this package:**
- Copy-paste CLAUDE.md between projects
- Re-explain git workflow every session
- Context limits hit constantly
- Inconsistent task structure

**After this package:**
```bash
# Project 1: Token swap
cd token-swap && claude-workflow init
# Edit CLAUDE_PROJECT.md with Solana program details

# Project 2: NFT staking
cd nft-staking && claude-workflow init
# Edit CLAUDE_PROJECT.md with staking logic

# Project 3: DAO governance
cd dao-governance && claude-workflow init
# Edit CLAUDE_PROJECT.md with governance rules
```

**Result:** Same consistent Claude behavior across all 3 projects. Context stays lean. Task isolation via worktrees means no conflicts.

---

### Example 2: Small Development Team

**Scenario:** 2-person team building a fullstack app. Want Claude to help both developers consistently.

**Setup:**
```bash
# Team lead runs once
claude-workflow init

# Answer prompts:
# Git sync? Yes
# Pull requests? Yes

# Edit CLAUDE_PROJECT.md with:
# - API endpoints
# - Database schema
# - Testing requirements
# - Code review process

# Commit everything to git
git add .
git commit -m "Add Claude configuration"
git push
```

**Other team member:**
```bash
# Clone and get instant Claude setup
git clone <repo>
cd <repo>

# Claude immediately understands:
# - Project structure
# - Task workflow
# - Testing standards
# - PR requirements
```

**Result:** Both developers get identical Claude behavior. No setup discussions needed.

---

### Example 3: Rapid Prototyping

**Scenario:** Need to validate 5 different startup ideas quickly.

**Traditional approach:** Spend 2 hours per project configuring Claude, writing docs, setting up workflows.

**With this package:**
```bash
# Idea 1: 5 minutes to full Claude setup
mkdir idea-1 && cd idea-1
npm init -y && git init && git remote add origin <url>
claude-workflow init
# Tell Claude what to build

# Idea 2: 5 minutes to full Claude setup
mkdir idea-2 && cd idea-2
npm init -y && git init && git remote add origin <url>
claude-workflow init
# Tell Claude what to build

# ... repeat for ideas 3-5
```

**Result:** Go from idea to working prototype in hours, not days. Spend time building, not configuring.

## Best Practices

### DO:

- **Run init in existing projects only** - Requires package.json and git
- **Edit CLAUDE_PROJECT.md for customizations** - This file is yours to modify
- **Let Claude handle task workflows** - The system guides Claude through the workflow
- **Use the backlog system** - Structured tasks keep Claude focused
- **Commit configuration files** - Share setup with your team via git
- **One init per project** - Each project gets its own configuration

### DON'T:

- **Edit CLAUDE.md directly** - Auto-managed, will be overwritten on updates
- **Run init without package.json** - Won't work without an existing project
- **Run init without git** - Git is required for the workflow system
- **Ignore the task template** - Standardized format helps Claude understand requirements
- **Skip CLAUDE_PROJECT.md** - Add project-specific context so Claude knows your setup
- **Run init in this package's source directory** - Only for consuming projects

### COMMON USES:

**For solo developers:**
- Maintain consistent Claude behavior across multiple projects
- Skip manual Claude Code configuration for each project
- Get opinionated defaults that work
- Ship faster without configuration overhead

**For teams:**
- Share Claude configuration via git
- Standardize task structure across the team
- Consistent AI assistance for all team members
- Onboard new developers instantly

**For rapid prototyping:**
- Spin up new projects with full Claude integration in minutes
- Focus on building, not configuration
- Lean context management for faster iterations
- Validate ideas quickly

**For agencies/consultants:**
- Consistent setup across client projects
- Professional workflows out of the box
- Easy handoff (configuration is documented)
- Faster project delivery

## What's Included

### Core Files

- **CLAUDE.md** - Comprehensive AI instructions (auto-managed from npm package, never edit!)
- **CLAUDE_PROJECT.md** - Your project-specific customizations (edit this!)
- **.claude/** - Complete Claude Code configuration directory
- **backlog/** - Full task management system
- **scripts/** - Task validation and utility scripts

### Key Features

- **Backlog Task Management** - Complete task workflow system
- **Git Worktree Workflows** - Isolated development environments
- **Smart Configuration** - Conditional workflows based on preferences
- **Testing Infrastructure** - Vitest setup with ESM support
- **Task Templates** - Standardized task structure
- **Validation Scripts** - Enforce task quality
- **Standard Structure** - Consistent project organization
- **Workflow Flexibility** - Choose PR-based or direct merge workflows

## Project Structure After Init

```
your-project/
├── CLAUDE.md                      # Base AI instructions (auto-managed, DON'T EDIT)
├── CLAUDE_PROJECT.md              # Your custom rules (EDIT THIS)
├── .env                           # Environment variables (created if missing)
├── .gitignore                     # Git exclusions (created if missing)
├── main.js                        # Entry point
├── package.json                   # Updated with test scripts
├── vitest.config.js               # Test configuration
├── .claude/
│   ├── settings.json              # Claude permissions & hooks
│   ├── worktree-setup.md          # Git worktree workflows
│   ├── backlog-reference.md       # Task management guide
│   ├── testing-setup.md           # Testing standards
│   ├── notify.sh                  # Basic notifications
│   └── enhanced-notify.sh         # Enhanced notifications
├── backlog/
│   ├── tasks/                     # Active tasks
│   ├── completed/                 # Archived tasks
│   ├── drafts/                    # Draft tasks
│   ├── templates/
│   │   └── task-template.md       # Task structure template
│   └── config.yml                 # Backlog configuration
├── scripts/
│   ├── validate-task.js           # Task validation
│   └── update-project-structure.js # Project file sync
├── src/                           # Source code
├── tests/                         # Test files
├── docs/                          # Documentation
└── data/                          # Data files (git-ignored)
```

## Workflow Customization

### Interactive Prompts

When you run `init`, you'll be asked:

1. **"Use Git worktrees for task isolation?"**
   - **Yes (default):** Full worktree workflow with isolated task environments
   - **No:** Simple feature branch workflow

2. **"Sync with main before starting each task?"** *(only if using worktrees)*
   - **Yes (default):** Adds mandatory git sync instructions
   - **No:** Skips sync requirements in workflows

3. **"Use pull requests instead of direct merges?"** *(only if using worktrees)*
   - **Yes (default):** Enforces PR-based workflow
   - **No:** Allows direct merges to main

### CLI Flags

Skip the interactive prompts with command-line flags:

```bash
# Disable worktree workflow (use simple feature branches instead)
claude-workflow init --no-worktrees

# Disable git sync requirement (only applies with worktrees)
claude-workflow init --no-git-sync

# Disable pull request requirement (only applies with worktrees)
claude-workflow init --no-pull-requests

# Combine flags for fully customized setup
claude-workflow init --worktrees --no-git-sync --no-pull-requests
```

### Effect on Templates

Your choices modify the generated templates:

**If worktrees are disabled:**
- `worktree-setup.md` - **NOT created**
- `CLAUDE.md` - Removes worktree requirements and safety sections
- `backlog-reference.md` - Removes worktree workflow steps
- `task-template.md` - Updates ACs for simple branch workflow
- `CLAUDE_PROJECT.md` - Changes merge strategy reference

**If git sync is disabled (with worktrees):**
- `CLAUDE.md` - Removes "MANDATORY GIT SYNC" section
- `worktree-setup.md` - Removes sync instructions
- `backlog-reference.md` - Removes sync steps

**If PRs are disabled (with worktrees):**
- `CLAUDE.md` - Changes to "Direct merges allowed"
- `task-template.md` - Updates acceptance criteria
- Workflow instructions use direct merge instead of `gh pr create`

## Configuration

### Project Customization

**NEVER edit `CLAUDE.md` directly!** It's auto-managed from the npm package.

Instead, edit `CLAUDE_PROJECT.md` to add:

- Project-specific API endpoints
- Custom commands and scripts
- Domain-specific rules
- External service configurations
- Team conventions
- Database schemas
- Deployment procedures

Example:

```markdown
# Project-Specific Configuration

## API Endpoints

- Production: https://api.myproject.com
- Staging: https://staging.myproject.com

## Database

- Schema: PostgreSQL 15
- Migration tool: `npm run migrate`
- Seed data: `npm run seed`

## Deployment

- Production: `npm run deploy:prod`
- Requires: AWS_ACCESS_KEY, AWS_SECRET_KEY

## Restrictions

- Never modify `/legacy` directory
- Always use custom logger at `src/utils/logger.js`
- All API calls must go through `src/api/client.js`
```

### .gitignore Setup

The package creates a `.gitignore` file (if missing) with:

```gitignore
node_modules/
.env
.env.local
.env.*.local
data/
```

**Note:** `CLAUDE.md` and `.claude/` are tracked in git so team members get the configuration.

## How It Works

### Task Management System

The setup includes a complete backlog.md integration that structures how Claude works with tasks:

**What Claude gets:**
- `.claude/backlog-reference.md` - Complete guide on task workflows
- `backlog/templates/task-template.md` - Standardized task format
- `scripts/validate-task.js` - Automated task validation

**How Claude uses it:**
- Reads task files to understand requirements
- Follows structured format (Description, Acceptance Criteria, Implementation Plan)
- Tracks progress in the task file's Progress Log
- Validates tasks before marking complete

**Task structure includes:**
- Description (what and why)
- Implementation Summary (filled after completion)
- Acceptance Criteria (checkboxes for validation)
- Implementation Plan (step-by-step approach)
- Git Workflow (branch and merge strategy)
- Progress Log (real-time updates)

Claude doesn't need manual instructions - the task template guides the entire workflow.

### Git Worktree Integration

The system provides Claude with comprehensive worktree workflows:

**What Claude gets:**
- `.claude/worktree-setup.md` - Complete worktree guide with examples
- Pre-configured commands and workflows
- Isolation strategy for parallel task work

**Benefits:**
- Work on multiple tasks simultaneously without conflicts
- Isolated dependencies per task
- No branch switching disruption
- Clean separation of concerns

**How it's organized:**
```
your-project/                    # Main repository
../your-project-worktrees/
  ├── task-42/                   # Worktree for task 42
  ├── task-43/                   # Worktree for task 43
  └── task-44/                   # Worktree for task 44
```

**Claude understands:**
- When to create worktrees (new task started)
- Where to create them (outside main repo)
- How to work within them (isolated development)
- When to merge back (task completed)

No manual explanation needed - Claude reads the workflow guide and follows it.

## Testing Infrastructure

### Vitest Configuration

The package includes `vitest.config.js` with:

- ESM support out of the box
- Test file patterns (`**/*.test.js`, `**/*.spec.js`)
- Coverage configuration
- 10-second default timeout

### Test Commands (added to package.json)

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

### Writing Tests

```javascript
import { describe, it, expect } from 'vitest';

describe('User Authentication', () => {
  it('should validate credentials', () => {
    expect(validateUser('user', 'pass')).toBe(true);
  });
});
```

See `.claude/testing-setup.md` for standards.

## Automatically Installed

When running `init`:

- **backlog.md CLI** - Task management (installed globally via npm)
- **Vitest** - Test framework (installed as dev dependency)

### Manual Installation Recommended

**GitHub CLI** (for PR workflows):
```bash
# macOS
brew install gh

# Authenticate
gh auth login
```

## Troubleshooting

### "No Project Detected"

```bash
# Ensure package.json exists
npm init -y

# Then run init
claude-workflow init
```

### "Git Not Initialized"

```bash
# Initialize git
git init

# Then run init
claude-workflow init
```

### "Git Remote Not Configured"

```bash
# Add remote
git remote add origin https://github.com/user/repo.git

# Or create with GitHub CLI
gh repo create

# Then run init
claude-workflow init
```

### Task Validation Errors

```bash
# Manually validate task
node scripts/validate-task.js backlog/tasks/task-42-*.md
```

### Permission Issues

```bash
# Install globally with appropriate permissions
sudo npm install -g claude-workflow
```

## Updating the Package

### For Users

```bash
# Update to latest version
npm update -g claude-workflow
```

### What Gets Updated

When you reinstall or update:

- Latest templates downloaded
- New CLI features available
- Bug fixes applied

**Your customizations are safe:**
- `CLAUDE_PROJECT.md` is never touched
- `.gitignore` is only created if missing
- `.env` is only created if missing
- Existing configs preserved

## Philosophy

### The Three-File System

1. **CLAUDE.md** (Base) - Managed by npm package, never edit
2. **CLAUDE_PROJECT.md** (Custom) - Your project rules, always preserved
3. **.claude/*** (Reference) - Detailed guides and workflows

### Task-Driven Development

- Every feature is a task
- Tasks have clear acceptance criteria
- Validation before implementation
- Documentation before completion
- Progress tracking in real-time

### Git Worktree First

- One task = one worktree
- Isolated environments
- Parallel development
- Clean branch management

## License

MIT © fullstacktard

## Links

- **Repository:** https://github.com/fullstacktard/claude-workflow
- **Issues:** https://github.com/fullstacktard/claude-workflow/issues
- **npm Package:** https://www.npmjs.com/package/claude-workflow
