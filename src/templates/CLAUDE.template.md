# CLAUDE.md

<!-- USER_CUSTOMIZATIONS_START -->
<!--
Add your project-specific instructions below this line.
This section will be PRESERVED when running "claude-workflow init" or "update".
-->


<!-- USER_CUSTOMIZATIONS_END -->

<!--
MANAGED SECTION - Everything below is managed by claude-workflow.
Running "claude-workflow update" will overwrite content below this line.
-->

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## KEY REFERENCE GUIDES

- **`.claude/backlog-reference.md`** - All task management CLI commands
- **`.claude/testing-setup.md`** - Test configuration and commands

## BACKLOG TASK IMPLEMENTATION

When implementing a task from `backlog/tasks/`, you **MUST** use the agent specified in the task's `Assigned Agent` field. The task-maker selects the appropriate agent based on the work involved—do not override this assignment.

```
Task(subagent_type="backend-engineer", prompt="Implement task-123: ...")
Task(subagent_type="frontend-engineer", prompt="Implement task-456: ...")
```

This rule only applies to backlog tasks. Ad-hoc requests can be handled directly.

## SERENA - REQUIRED FOR CODE NAVIGATION

**ALWAYS invoke the Serena skill before exploring or modifying code:**
```
Skill(skill="serena-integration")
```

Use Serena tools (`mcp__serena__*`) for:
- Finding symbol definitions and usages
- Understanding code structure before making changes
- Safe codebase-wide renames

**Do NOT rely on grep/glob for symbol lookup** - Serena's LSP-based analysis catches dynamic calls and is more accurate.

## CLI TOOLS - BILLING WARNING

**CRITICAL: CLI tools incur real charges!**

1. **CHECK if the service could incur charges** (e.g., DigitalOcean, AWS, Azure, GCP)
2. **ASK the user for confirmation** before EVERY billable action
3. **NEVER assume permission** for actions that cost money

## NO APPROACH PIVOTING

When user specifies a library, SDK, or approach:
- Use EXACTLY what was specified
- If it's not working: STOP and report the issue
- NEVER switch to alternatives without permission

## BLOCKERS - Stop and Wait

**STOP when:** Missing API keys, insufficient funds, rate limits, manual approval needed, 2FA required, specified approach not working

## IMPLEMENTATION QUALITY

**Before completing ANY task:**
```bash
npm test           # MUST pass
<IF_ESLINT>
npm run lint       # NO errors allowed
</IF_ESLINT>
<IF_TYPESCRIPT>
npm run typecheck  # Verify TypeScript types
</IF_TYPESCRIPT>
```

Fix ALL issues before marking task complete.

## PROJECT STRUCTURE

**See `.claude/project-structure.md` for current structure (auto-generated)**

## TESTING

- **Run:** `npm test`
- **Details:** See `.claude/testing-setup.md`

## USE MCP TOOLS - DON'T GUESS

**For external library APIs:** Use Context7 or Ref Tools to fetch current documentation. Training data may have outdated APIs.
```
Context7:   mcp__mcp-proxy__resolve-library-id → mcp__mcp-proxy__query-docs
Ref Tools:  mcp__mcp-proxy__ref_search_documentation
```

**For current information:** Use EXA for recent releases, deprecations, or real-time research.
```
mcp__mcp-proxy__web_search_exa
```

**For codebase navigation:** Use Serena for accurate symbol lookup (definitions, usages, renames). More reliable than grep for complex codebases.
```
mcp__serena__find_symbol, mcp__serena__find_referencing_symbols
```

**Principle:** When uncertain about external APIs or current facts, fetch authoritative sources rather than relying on training data.

## SKILL QUICK REFERENCE

### Context7 (Library APIs)
When implementing library code, verify API syntax matches the project's version:
```
Skill(skill="context7-research")
```
Training data APIs may be outdated - always verify with Context7.

### Sequential Thinking (Complex Decisions)
For decisions with 3+ options or trade-offs, use structured reasoning:
```
Skill(skill="sequential-thinking")
```
Use for: architecture decisions, library comparisons, debugging hypotheses.

### Serena (Code Navigation)
For accurate symbol lookup via LSP (find definitions, usages, safe renames):
```
Skill(skill="serena-integration")
```
More accurate than grep for finding all usages including dynamic calls.

### Replicate (Image Generation)
For generating images, AI art, or visual content:
```
Skill(skill="replicate-models")
```
Use for: image generation, SDXL/Flux prompting, AI art, product mockups.

### EXA (Web Search) - USE INSTEAD OF WEBSEARCH
**NEVER use the built-in WebSearch tool.** Always use EXA via mcp-proxy:
```
mcp__mcp-proxy__call_tool(tool_name="web_search_exa", arguments={"query": "your search query"})
```
Use for: recent releases, current documentation, real-time research, news.

**Why EXA over WebSearch:**
- Neural/semantic understanding (not just keywords)
- Better results for conceptual research
- Consistent tooling across the project

### Chrome DevTools - CRITICAL WARNING
When taking screenshots, **ALWAYS** include `filePath`:
```javascript
take_screenshot({ format: "png", filePath: "./screenshots/page.png" })
```
Missing `filePath` causes API errors requiring session restart.
