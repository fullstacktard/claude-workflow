/**
 * Agent Output Type Schemas
 *
 * JSON schemas for workflow agents that output structured JSON.
 *
 * IMPORTANT: These schemas are NOT enforced by Claude Code CLI.
 * The `outputFormat` field in agent frontmatter is completely ignored.
 * These schemas serve as documentation and for PostToolUse hook validation.
 *
 * @see README.md for full explanation
 */

export { default as featurePlannerSchema } from "./feature-planner.schema.json";
export { default as lintResolutionPlannerSchema } from "./lint-resolution-planner.schema.json";
export { default as researchSchema } from "./research.schema.json";
export { default as v0PlannerSchema } from "./v0-planner.schema.json";
export { default as demoPlannerSchema } from "./demo-planner.schema.json";
export { default as demoReviewerSchema } from "./demo-reviewer.schema.json";
export { default as surrealClipGeneratorSchema } from "./surreal-clip-generator.schema.json";
export { default as surrealVideoReviewerSchema } from "./surreal-video-reviewer.schema.json";
export { default as workflowAggregatorSchema } from "./workflow-aggregator.schema.json";
export { default as xAccountCreatorSchema } from "./x-account-creator.schema.json";

/**
 * Map of agent names to their output schemas
 */
export const agentSchemas = {
  "feature-planner": "feature-planner.schema.json",
  "lint-resolution-planner": "lint-resolution-planner.schema.json",
  "research": "research.schema.json",
  "v0-planner": "v0-planner.schema.json",
  "demo-planner": "demo-planner.schema.json",
  "demo-reviewer": "demo-reviewer.schema.json",
  "surreal-clip-generator": "surreal-clip-generator.schema.json",
  "surreal-video-reviewer": "surreal-video-reviewer.schema.json",
  "workflow-aggregator": "workflow-aggregator.schema.json",
  "x-account-creator": "x-account-creator.schema.json",
} as const;

export type WorkflowAgent = keyof typeof agentSchemas;
