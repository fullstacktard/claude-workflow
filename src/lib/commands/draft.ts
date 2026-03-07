/**
 * Draft Command
 *
 * Creates a structured brief template that users fill in
 * before running a workflow command with `@<path>`.
 *
 * Usage:
 *   claude-workflow draft <name>                  (default: feature workflow)
 *   claude-workflow draft <name> --type qa
 *   claude-workflow draft <name> --type ui
 *   claude-workflow draft <name> --type lint
 *   claude-workflow draft <name> --type demo
 *   claude-workflow draft <name> --type surreal
 *
 * Output: backlog/workflows/<slug>/brief.md
 *
 * @module draft
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import chalk from "chalk";

import { clackYesNo, showHeader, showBox, showInfo } from "../ui.js";

export interface DraftOptions {
  name?: string;
  type?: string;
}

/**
 * Workflow type definitions mapping type flags to templates and commands
 */
interface WorkflowType {
  displayName: string;
  command: string;
  generateBrief: (name: string, date: string) => string;
}

/**
 * Sanitize a feature name into a kebab-case slug.
 * Strips non-alphanumeric characters and collapses hyphens.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, "")
    .replaceAll(/[\s_]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/**
 * Get today's date as YYYY-MM-DD
 */
function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ============================================================================
// Brief Templates
// ============================================================================

function featureBrief(name: string, date: string): string {
  return `---
name: ${name}
created: "${date}"
status: draft
type: feature
---

# ${name}

## What to Build
<!-- Describe the feature in 2-5 sentences. What should it do? What problem does it solve? -->


## Target Users
<!-- Who will use this? End users, developers, admins? -->


## Scope

**In scope:**
<!-- What IS included in this feature -->
-

**Out of scope:**
<!-- What is NOT included (future work, adjacent features) -->
-

## Complexity Hint
<!-- How large is this feature? -->
<!-- single-component | multi-component | system-wide -->


## Task Type Hints
<!-- What types of work are involved? Check all that apply -->
- [ ] frontend
- [ ] backend
- [ ] devops
- [ ] testing
- [ ] documentation
- [ ] research

## Constraints
<!-- Technical constraints, compatibility requirements, libraries to use or avoid -->
-

## Codebase Areas
<!-- Which packages, directories, or modules will this touch? -->
<!-- e.g. packages/dashboard/src/components, packages/api/routes -->
-

## Integration Points
<!-- Existing systems, APIs, or services this needs to work with -->
-

## Dependencies
<!-- Other features or tasks that must complete before/after this one -->
<!-- e.g. "Requires task-42 (auth API)" or "Blocks task-50 (dashboard)" -->
-

## Non-Functional Requirements
<!-- Performance targets, accessibility, security, browser support -->
-

## Success Criteria
<!-- How do we know this feature is complete and correct? -->
-

## Additional Context
<!-- Links, mockups, related issues, design docs, prior art -->

`;
}

function qaBrief(name: string, date: string): string {
  return `---
name: ${name}
created: "${date}"
status: draft
type: qa
---

# ${name}

## Test Target
<!-- URL or application entry point to test -->
<!-- e.g. http://localhost:3000, https://staging.myapp.com -->


## What to Test
<!-- Describe the features, flows, or pages that need E2E testing -->
<!-- Be specific about user journeys and expected behaviors -->


## Coverage Level
<!-- Pick one: Smoke | Regression | Comprehensive -->
<!-- Smoke = critical paths only, Regression = changed areas + critical, Comprehensive = full suite -->
-

## Test Artifacts
<!-- Check all that apply -->
- [ ] Screenshots
- [ ] Video recordings
- [ ] Accessibility reports
- [ ] Performance metrics

## Automation Preference
<!-- Pick one: Fully automated | Phase-by-phase review | Manual review after each step -->
-

## Test Scenarios

### Critical Paths
<!-- Must-test user flows that cannot fail -->
-

### Edge Cases
<!-- Unusual inputs, error states, boundary conditions -->
-

### Regression Areas
<!-- Previously broken functionality to verify -->
-

## Authentication
<!-- How to log in, test accounts, OAuth flows -->
<!-- Leave blank if no auth required -->


## Browser / Device Requirements
<!-- Which browsers and viewports to test -->
<!-- e.g. Chrome desktop, Mobile Safari, Firefox -->
- Chrome (desktop)

## Environment Setup
<!-- Any setup needed before tests run -->
<!-- e.g. seed data, feature flags, env vars -->


## Known Issues
<!-- Existing bugs to skip or work around during testing -->


## Success Criteria
<!-- What does "all tests pass" look like? -->
- All critical paths pass without errors
- No visual regressions on key pages

`;
}

function uiBrief(name: string, date: string): string {
  return `---
name: ${name}
created: "${date}"
status: draft
type: ui
---

# ${name}

## Style Guide (BLOCKING)
<!-- ⚠️ v0-planner REQUIRES a style guide to generate components. -->
<!-- If you have one, provide the path. If not, run the style-guide-generator first. -->
<!-- e.g. docs/style-guide.md, src/styles/theme.css -->
- Path:
- [ ] Style guide exists (if unchecked, run: \`/style-guide-generator\` before proceeding)

## Visual Tone
<!-- How should the UI feel? Pick one or describe your own. -->
<!-- Options: Professional | Playful | Minimal | Bold | Corporate | Custom -->
-

## Color Scheme / Theme
<!-- Primary brand color(s) and mode preference. Used for design token extraction. -->
- Primary color:
- Secondary color:
- Mode: light | dark | both
<!-- If using @theme tokens, list the CSS file: e.g. src/styles/theme.css -->

## Component Description
<!-- What UI component(s) need to be built? What do they look like and do? -->


## User Interaction
<!-- How does the user interact with this? Clicks, forms, drag-drop, keyboard? -->


## Design Reference
<!-- Links to mockups, Figma files, screenshots, or similar existing UIs -->
<!-- If no mockup, describe the visual style (minimal, bold, dashboard-like, etc.) -->


## Component Breakdown
<!-- List individual components needed -->
<!-- e.g. SearchBar, ResultCard, FilterPanel, Pagination -->
-

## Data & State
<!-- What data does this component display or manage? -->
<!-- Where does it come from? API, props, local state, global store? -->


## Responsive Behavior
<!-- How should this look on mobile, tablet, desktop? -->
- Mobile:
- Desktop:

## Existing Patterns
<!-- Reference existing components in the codebase to match style -->
<!-- e.g. "Match the card style in src/components/TaskCard.tsx" -->


## Accessibility
<!-- ARIA labels, keyboard navigation, screen reader requirements -->
-

## Integration Point
<!-- Where does this component live in the app? Which route/page? -->


## Success Criteria
<!-- How do we know the UI is complete and correct? -->
-

`;
}

function lintBrief(name: string, date: string): string {
  return `---
name: ${name}
created: "${date}"
status: draft
type: lint
---

# ${name}

## Scope
<!-- Which directories or packages to lint-fix -->
<!-- e.g. packages/dashboard, src/, entire repo -->


## Error Types to Fix
<!-- Which categories of errors to focus on -->
<!-- Leave blank to fix everything -->
- TypeScript errors
- ESLint violations
- Unused exports (knip)

## Automation Level
<!-- How much control do you want during the fix process? -->
<!-- Pick one: fully-automated | phase-by-phase | manual-review -->
- fully-automated <!-- run everything end-to-end, no stops -->
- phase-by-phase <!-- pause for review between phases -->
- manual-review <!-- approve each fix group before applying -->

## Risk Tolerance
<!-- How aggressive should fixes be? -->
<!-- Pick one: aggressive | conservative | cautious -->
- conservative <!-- safe changes only, skip ambiguous fixes -->
- aggressive <!-- maximize fixes, accept some risk -->
- cautious <!-- manual verification for each change -->

## Priority Rules
<!-- Specific lint rules that are most important -->
<!-- e.g. no-explicit-any, @typescript-eslint/no-unused-vars -->


## Exclusions
<!-- Files or directories to skip -->
<!-- e.g. generated files, vendor code, test fixtures -->


## Context
<!-- Why is this lint fix needed? Recent upgrade? New rule added? -->


## Success Criteria
<!-- What does "clean" look like? -->
- \`npm run lint\` passes with zero errors
- \`npm run typecheck\` passes with zero errors

`;
}

function demoBrief(name: string, date: string): string {
  return `---
name: ${name}
created: "${date}"
status: draft
type: demo
---

# ${name}

## Platform
<!-- Determines aspect ratio and format automatically -->
<!-- twitter | instagram | github-readme | general -->
-

## Target URL
<!-- The URL to record -->


## What to Show
<!-- Describe the demo flow in 1-3 sentences -->


## Scenes

### Scene 1
<!-- Description of what happens -->
- Duration: 3-5s
- Actions:
  - click: "#selector" or "element description"
  - type: "#selector" "text to type"
  - scroll: 600px
  - wait: 2s

### Scene 2
- Duration: 3-5s
- Actions:
  - click: "#selector"

### Scene 3
- Duration: 3-5s
- Actions:
  - click: "#selector"

## Visual Style
- Device frame: browser | phone | laptop | none
- Theme: light | dark

## Background
<!-- purple-gradient | dark-blue-gradient | solid-black | solid-white | custom CSS -->
- purple-gradient

## Effects
<!-- Toggle each effect on/off -->
- [x] Zoom on clicks
- [x] Click ripples
- [ ] Motion blur

## Captions
<!-- Text overlays per scene. Leave blank for none -->


## Audio
<!-- Background music, sound effects, voiceover. Leave blank for silent -->


## Output
- Format: mp4
- Quality: 80
- FPS: 30

## Success Criteria
<!-- What makes this a good demo video? -->
-

`;
}

function surrealBrief(name: string, date: string): string {
  return `---
name: ${name}
created: "${date}"
status: draft
type: surreal-video
---

# ${name}

## Creative Brief
<!-- Describe the surreal vision in 2-3 sentences -->
<!-- Think: dreamlike, impossible physics, emotional resonance -->


## Aesthetic Direction
<!-- melting-clocks | cosmic-ocean | organic-machines | liquid-architecture | custom -->
-

## Provider Preference
<!-- replicate-luma (recommended) | runway | kling | hailuo | auto -->
- auto

## Clip Duration
<!-- 5 | 10 | 15 | 30 seconds -->
- 10

## Number of Clips
<!-- How many distinct clips to generate -->
- 1

## Branding
<!-- Logo, text overlays, intro/outro for final composition -->
- Logo path:
- Intro text:
- Outro text:
- Watermark: yes | no

## Transitions
<!-- fade | dissolve | cut | wipe | none -->
- fade

## Audio
<!-- Background music, ambient sound, or silent -->


## Output
- Format: mp4
- Resolution: 1920x1080

## Prompt Engineering Notes
<!-- Additional guidance for the AI prompt optimizer -->
<!-- e.g., "emphasize warm tones", "slow camera movement", "no faces" -->


## Success Criteria
-

`;
}

// ============================================================================
// Workflow Type Registry
// ============================================================================

const WORKFLOW_TYPES: Record<string, WorkflowType> = {
  feature: {
    displayName: "Feature Development",
    command: "/workflow",
    generateBrief: featureBrief,
  },
  qa: {
    displayName: "QA Testing",
    command: "/qa",
    generateBrief: qaBrief,
  },
  ui: {
    displayName: "Frontend Building",
    command: "/ui",
    generateBrief: uiBrief,
  },
  lint: {
    displayName: "Lint Fix",
    command: "/lint-fix",
    generateBrief: lintBrief,
  },
  demo: {
    displayName: "Demo Recording",
    command: "/demo",
    generateBrief: demoBrief,
  },
  surreal: {
    displayName: "Surreal Video",
    command: "/surreal",
    generateBrief: surrealBrief,
  },
};

const VALID_TYPES = Object.keys(WORKFLOW_TYPES);

export async function draft(options: DraftOptions): Promise<void> {
  await showHeader();

  const name = options.name?.trim();
  const typeName = options.type?.trim().toLowerCase() ?? "feature";

  if (!name) {
    console.error(chalk.red("Usage: claude-workflow draft <name> [--type <type>]"));
    console.error();
    console.error("  Creates a brief template you can fill in before running a workflow.");
    console.error();
    console.error(chalk.bold("Types:"));
    for (const [key, wf] of Object.entries(WORKFLOW_TYPES)) {
      const isDefault = key === "feature" ? chalk.dim(" (default)") : "";
      console.error(`  ${chalk.cyan(key.padEnd(10))} ${wf.displayName}${isDefault}`);
    }
    console.error();
    console.error(chalk.dim("Examples:"));
    console.error(chalk.dim("  claude-workflow draft user-authentication"));
    console.error(chalk.dim("  claude-workflow draft \"dark mode toggle\" --type ui"));
    console.error(chalk.dim("  claude-workflow draft checkout-flow --type qa"));
    console.error(chalk.dim("  claude-workflow draft cleanup --type lint"));
    console.error(chalk.dim("  claude-workflow draft product-demo --type video"));
    process.exit(1);
  }

  if (!VALID_TYPES.includes(typeName)) {
    console.error(chalk.red(`Unknown workflow type: ${typeName}`));
    console.error(`Valid types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const workflowType = WORKFLOW_TYPES[typeName];
  const slug = toSlug(name);
  const dir = path.join(process.cwd(), "backlog", "workflows", slug);
  const briefPath = path.join(dir, "brief.md");
  const relativePath = path.join("backlog", "workflows", slug, "brief.md");

  // Check if already exists
  if (existsSync(briefPath)) {
    showInfo(`Brief already exists at ${chalk.cyan(relativePath)}`);
    const overwrite = await clackYesNo("Overwrite existing brief?", false);
    if (!overwrite) {
      console.log(chalk.dim("  Cancelled."));
      return;
    }
  }

  // Create directory and write file
  mkdirSync(dir, { recursive: true });
  writeFileSync(briefPath, workflowType.generateBrief(name, today()));

  // Show success with workflow-specific command
  const nextSteps = [
    `${chalk.white("1.")} Fill in the brief at ${chalk.cyan(relativePath)}`,
    `${chalk.white("2.")} Run the workflow:`,
    `   ${chalk.yellow(`${workflowType.command} @${relativePath}`)}`,
  ].join("\n");

  showBox(`${workflowType.displayName} Brief Created`, nextSteps, "success");
}
