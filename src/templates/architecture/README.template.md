# Architecture Documentation

**Project:** {{PROJECT_NAME}}
**Version:** {{VERSION}}
**Last Updated:** {{DATE}}
**Maintainer:** {{MAINTAINER}}

## Overview

This directory contains the practical architecture documentation for {{PROJECT_NAME}}. These documents are designed to be **code-first**, **actionable**, and **easy to navigate**.

## When to Read Each File

Use this decision tree to find the information you need:

### Starting a New Feature?
1. **Read first:** `folder-structure.md` - Understand where code goes
2. **Read second:** `patterns.md` - See how similar features are implemented
3. **Read third:** `tech-stack.md` - Learn which libraries to use
4. **If working with data:** Also read `data-model.md`

### Fixing a Bug?
1. **Read first:** `patterns.md` - Understand error handling and logging patterns
2. **If data-related:** Also read `data-model.md` for schema information

### Writing Tests?
1. **Read first:** `testing.md` - See test patterns and structure
2. **Read second:** `folder-structure.md` - Understand test file placement

### Joining the Project?
**Read in this order:**
1. `README.md` (you are here)
2. `folder-structure.md` - Learn the codebase layout
3. `patterns.md` - Understand coding conventions
4. `tech-stack.md` - Get familiar with technologies
5. `testing.md` - Learn how to run and write tests
6. `data-model.md` (if applicable) - Understand data structures

## Documentation Files

### Core Documentation

#### 📁 [`folder-structure.md`](./folder-structure.md)
**Purpose:** Understand where code lives and how it's organized

**Contains:**
- **/src enforcement rule** - All application code must be in `/src`
- Module boundaries and responsibilities
- Package organization (for monorepos)
- Where to place new features

**When to read:**
- Before starting any implementation
- When creating new modules or components
- When organizing code structure

---

#### 🔧 [`patterns.md`](./patterns.md)
**Purpose:** Learn how to implement common functionality correctly

**Contains:**
- Error handling patterns (try-catch, error boundaries)
- Validation patterns (schema validation, input sanitization)
- Logging patterns (structured logging, log levels)
- Authentication/authorization patterns
- API design patterns
- **All patterns include working code examples**

**When to read:**
- Before implementing error handling
- When adding validation
- When working with authentication
- When designing new APIs

---

#### 🗄️ [`data-model.md`](./data-model.md) *(Optional - for data-driven projects)*
**Purpose:** Understand data structures and relationships

**Contains:**
- Entity definitions (TypeScript interfaces)
- ER diagrams (visual representation)
- Database schema
- Relationships and foreign keys
- Query patterns with examples
- Migration strategies

**When to read:**
- Before creating new database tables
- When writing queries
- When understanding data relationships
- Before implementing features that touch data

---

#### 📚 [`tech-stack.md`](./tech-stack.md)
**Purpose:** Know which libraries to use and how

**Contains:**
- Backend technologies and versions
- Frontend frameworks and libraries
- Infrastructure tools
- Development tools
- **Installation commands and basic usage for each**

**When to read:**
- Before adding a new library
- When setting up development environment
- When working with unfamiliar tech
- When upgrading dependencies

---

#### ✅ [`testing.md`](./testing.md)
**Purpose:** Write consistent, maintainable tests

**Contains:**
- Test file structure and organization
- Testing patterns (unit, integration, e2e)
- Mocking strategies with examples
- Test data setup
- CI/CD integration
- **All with working code examples**

**When to read:**
- Before writing tests
- When setting up test infrastructure
- When debugging failing tests
- When adding new test coverage

---

### Architecture Decisions

#### 📝 [`decisions/`](./decisions/)
**Purpose:** Understand why architectural choices were made

**Contains:**
- Architecture Decision Records (ADRs)
- Technology selection rationale
- Pattern adoption decisions
- Historical context for major changes

**When to read:**
- When questioning why something was done a certain way
- Before proposing major changes
- When evaluating alternatives
- For historical context

---

## Quick Reference

### Most Common Questions

**Q: Where do I put new code?**
A: See [`folder-structure.md`](./folder-structure.md) - All application code goes in `/src`

**Q: How do I handle errors?**
A: See [`patterns.md`](./patterns.md#error-handling) - Use structured error handling patterns

**Q: What libraries can I use?**
A: See [`tech-stack.md`](./tech-stack.md) - Approved libraries with usage examples

**Q: How do I write tests?**
A: See [`testing.md`](./testing.md) - Test patterns and structure

**Q: Where is the database schema?**
A: See [`data-model.md`](./data-model.md) - Entity definitions and ER diagrams

**Q: Why was technology X chosen?**
A: See [`decisions/`](./decisions/) - ADRs document major decisions

---

## Configuration Management

### Protected Configuration Files

The following files define code quality standards and are **protected from AI modification**:

- `eslint.config.ts` / `eslint.config.js` - Linting rules and code quality standards
- `tsconfig.json` - TypeScript compiler options and strictness settings
- `knip.ts` / `knip.json` - Unused code detection configuration

**Why protected:**
AI agents might weaken rules to avoid fixing underlying code issues. These files represent architectural decisions about code quality and require human approval to change.

**What's protected:**
- Direct edits that modify rule configurations
- Changes to strictness settings (strict mode, noImplicitAny, etc.)
- Disabling or downgrading linting rules
- Modifications via Write/Edit tools or Bash commands

**To change these files:**
1. Use the `cto-architect` agent to review and recommend changes
2. Review the generated recommendations report
3. Manually edit the files based on approved recommendations
4. Document changes in an ADR (Architecture Decision Record)

**Review process:**
```bash
# Use cto-architect agent to review config files
# Agent will read files, analyze against 2025 best practices,
# and generate a recommendations report in docs/architecture/decisions/

# Example prompts:
# "Review eslint.config.ts for 2025 best practices"
# "Analyze tsconfig.json strictness settings"
# "Check if knip.ts is configured optimally"
```

**Bypass mechanism (Advanced users):**
For emergency situations or advanced users who understand the risks:
```bash
export CLAUDE_WORKFLOW_ALLOW_CONFIG_EDITS=1
```

⚠️ **Warning:** All config edits are logged to `.claude/logs/config-changes.jsonl`

---

## Version History

### Version {{VERSION}} ({{DATE}})
- Initial architecture documentation
- Established /src folder structure
- Defined core patterns and conventions
- {{ADDITIONAL_NOTES}}

---

## Contributing to This Documentation

### When to Update

Update these docs when:
- Adding new architectural patterns
- Changing code organization
- Adding new libraries or technologies
- Making significant technical decisions
- Discovering better approaches

### How to Update

1. **Update the relevant file** (folder-structure.md, patterns.md, etc.)
2. **Add working code examples** - No pseudocode!
3. **Create an ADR** if it's a significant decision
4. **Update this README** if you add new sections
5. **Increment version** in this file

### Documentation Quality Standards

- ✅ Include working code examples (copy-paste ready)
- ✅ Explain the "why" not just the "what"
- ✅ Keep examples realistic and production-ready
- ✅ Update version history
- ❌ No pseudocode or placeholder text
- ❌ No vague descriptions without examples
- ❌ Don't document every tiny detail - focus on patterns

---

## Navigation

**Root Documentation:** [`docs/architecture/`](../README.md)
**Project-Specific Docs:** See subdirectories for each project in the monorepo

---

**Need help?** If you can't find what you're looking for, ask the team or check the [decisions/](./decisions/) folder for historical context.
