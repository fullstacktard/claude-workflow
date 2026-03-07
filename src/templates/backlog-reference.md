# Backlog CLI Reference Guide

This guide provides all the backlog.md CLI commands needed for task management.

## 🎯 Quick Command Reference

### Viewing Tasks
```bash
# View a specific task (always use --plain for AI mode)
backlog task view <id> --plain
# Or shorthand:
backlog task <id> --plain

# List all tasks
backlog task list --plain

# List tasks by status
backlog task list --status "To Do" --plain
backlog task list --status "In Progress" --plain
backlog task list --status "Done" --plain

# Search for tasks
backlog task list --plain | grep -i "[keyword]"
```

### Creating Tasks

**⚠️ MANDATORY: Always use the template file!**

**CORRECT Method (Using Template):**
```bash
# 1. First, copy the template
cp backlog/templates/task-template.md backlog/tasks/task-XX-title.md

# 2. Edit the file to fill in ALL sections
# 3. Ensure all 9 mandatory ACs are included
# 4. Fill in Implementation Plan, Documentation Plan, etc.

# 5. For draft tasks (ideas needing refinement), mark with --draft
# 6. ONLY use CLI for simple updates after creating from template
```

**For Draft Tasks:**
```bash
# Mark a task as draft when it needs refinement before implementation
backlog task edit <id> --draft

# Promote draft to ready status when complete
backlog task edit <id> --promote
```

**❌ AVOID: Simple CLI creation misses critical sections:**
```bash
# This creates incomplete tasks without mandatory sections:
backlog task create "Title"  # DON'T USE - missing template structure
backlog task create --draft "Title"  # DON'T USE - still missing template structure
```

### Updating Tasks
```bash
# Update status (Valid values: "To Do", "In Progress", "Done")
# Note: Use -s flag (short for --status). Use "Done" not "complete"
backlog task edit <id> -s "To Do"       # Change to To Do
backlog task edit <id> -s "In Progress" # Mark as in progress
backlog task edit <id> -s "Done"        # Mark as completed

# Check acceptance criteria
backlog task edit <id> --check-ac 1  # Check AC #1 as complete
backlog task edit <id> --check-ac 2  # Check AC #2 as complete

# Update title or description
backlog task edit <id> -t "New title"
backlog task edit <id> -d "New description"

# Add acceptance criteria
backlog task edit <id> --ac "New acceptance criteria"

# Add implementation plan
backlog task edit <id> --plan "1. Step one\n2. Step two\n3. Step three"

# Add or append notes
backlog task edit <id> --notes "Implementation notes or blockers"  # Replace notes
backlog task edit <id> --append-notes "Additional note"  # Append to existing

# Set priority
backlog task edit <id> --priority high
backlog task edit <id> --priority medium
backlog task edit <id> --priority low
```

### Managing Task Status
```bash
# Mark task as completed
backlog task edit <id> -s "Done"

# Archive a task
backlog task archive <id>

# Demote task back to drafts
backlog task demote <id>

# Move completed task to completed folder manually
mv backlog/tasks/task-<id>-*.md backlog/completed/

# Or use cleanup for batch operation (prompts for age selection)
backlog cleanup  # Moves old "Done" tasks to completed folder
```

## 🚫 Bypassing Enforcement (When Necessary)

**Agent recommendation enforcement automatically activates when semantic routing is highly confident (>85%).**

This prevents accidental tool misuse by ensuring you use the recommended agent when Claude is very certain about the match. However, sometimes you need to bypass this for valid reasons.

### When to Bypass

- **Quick experimentation or exploration** - Testing different approaches
- **Working around routing edge cases** - Router doesn't understand your specific intent
- **Debugging or development tasks** - Working on the workflow system itself
- **Personal preference overrides** - You know better than the router for this specific case

### How to Bypass

**Method 1: Environment Variable (Session-wide)**
```bash
# Set before starting Claude Code session
export CLAUDE_WORKFLOW_BYPASS_HOOKS=1

# Verify it's set
echo $CLAUDE_WORKFLOW_BYPASS_HOOKS  # Should output: 1

# Start Claude Code
claude-code
```

**To make permanent:**
```bash
# Add to ~/.bashrc or ~/.zshrc
echo 'export CLAUDE_WORKFLOW_BYPASS_HOOKS=1' >> ~/.bashrc
source ~/.bashrc
```

**Method 2: Task File (Task-specific)**

Add this comment to the task file frontmatter:
```markdown
---
id: task-042
title: Implement authentication feature
<!-- bypass-enforcement: true -->
---
```

**Effect:** Enforcement disabled only when working on this specific task.

**Method 3: User Message (One-time)**

Include bypass phrase in your message to Claude:
```
bypass enforcement and let me use the Read tool to explore the codebase
```

**Keywords that trigger bypass:**
- "bypass enforcement"
- "skip recommendation"
- "ignore agent suggestion"

### Audit Logging

**Note:** All bypasses are logged to `.claude/logs/compliance.jsonl` for audit purposes.

```jsonl
{
  "type": "BYPASS",
  "method": "environment_variable",
  "reason": "CLAUDE_WORKFLOW_BYPASS_HOOKS=1",
  "timestamp": "2025-12-05T12:30:00.000Z",
  "sessionId": "2218290"
}
```

For more details on agent recommendation enforcement, see the [Agent Recommendation Enforcement documentation](../docs/agent-recommendation-enforcement.md).

## 📋 Task Workflow

### Starting a New Task OR Continuing Existing Task

1. **Mark task as in progress:**
   ```bash
   backlog task edit <id> -s "In Progress"
   ```

2. **Check first AC:**
   ```bash
   backlog task edit <id> --check-ac 1
   ```

### During Implementation

- **Update Progress Log after EACH significant change:**
  - Progress logs are stored directly in the task file: `backlog/tasks/task-<id>.md`
  - Use the Edit tool to add entries to the "## Progress Log" section
  - This is MANDATORY for session continuity
  - Example entries:
    - "YYYY-MM-DD HH:MM - Implemented user authentication module"
    - "YYYY-MM-DD HH:MM - Files modified: src/auth.js, tests/auth.test.js"
    - "YYYY-MM-DD HH:MM - Blocked: Missing API credentials"

- **Check ACs immediately when completed:**
  ```bash
  backlog task edit <id> --check-ac 2  # After completing AC #2
  backlog task edit <id> --check-ac 3  # After completing AC #3
  ```

- **Document blockers immediately:**
  ```bash
  backlog task edit <id> --notes "Blocked: Missing API key for service X"
  ```

### Completing a Task

1. **Ensure all tests pass:**
   ```bash
   npm test
   ```

2. **Push to remote:**
   ```bash
   git push origin feature/task-<id>-<description>
   ```

3. **Ask user:** "Task is complete. Would you like to merge to main?"

4. **Return to main branch and merge directly (NO PR)**

5. **From main branch, after merge:**
   ```bash
   git checkout main
   git pull origin main
   git merge feature/task-<id>-<description> --no-ff -m "Merge task <id>: <description>"
   git push origin main
   backlog task edit <id> -s "Done"
   mv backlog/tasks/task-<id>-*.md backlog/completed/
   ```

## 📝 Task Structure Requirements

**⚠️ CRITICAL: Tasks created without the template are INCOMPLETE!**

Every task MUST be created from `backlog/templates/task-template.md` and include:

### Mandatory Sections (from template):
- **Description** - Clear explanation of WHAT and WHY
- **Acceptance Criteria** - 9+ mandatory ACs (see below)
- **Implementation Plan** - Step-by-step technical approach
- **Git Workflow** - Feature branch workflow
- **Documentation Plan** - What docs will be updated
- **Test Structure Requirements** - Test organization rules
- **Dependencies** - Related tasks
- **Progress Log** - For session continuity
- **Clarification Log** - User Q&A tracking
- **Notes** - Additional context

### Mandatory Acceptance Criteria (first 9 ALWAYS required):
1. Documentation updated/created for this change
2. All unclear requirements have been clarified with user
3. Development done on feature branch with proper git workflow
4. All tests pass completely (`npm test`)
5. No lint errors (`npm run lint`)
6. No TypeScript errors (`npm run typecheck` for TS projects)
7. Implementation Summary section filled out completely
8. Pull request created with task file as body (never merge directly to main)
9. External integrations verified working (e.g., notifications received, not just sent)

## 💡 Tips

- **Always use `--plain` flag** for AI-readable output
- **Check ACs in real-time** - don't batch them
- **Never edit task files directly** (exception: Progress Log entries) - use CLI for all other updates
- **Update status immediately** when starting work
- **Document blockers** the moment they occur