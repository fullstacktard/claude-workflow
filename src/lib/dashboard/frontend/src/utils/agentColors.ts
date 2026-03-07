/**
 * Agent color mapping utility
 * Maps agent names to Tailwind CSS color classes based on agent frontmatter colors
 */

/** Agent color mapping from frontmatter definitions */
const AGENT_COLORS: Record<string, string> = {
  // Blue agents
  'Explore': 'text-blue-400',
  'feature-planner': 'text-blue-400',

  // Cyan agents
  'skill-analyzer': 'text-cyan-400',
  'backend-engineer': 'text-cyan-400',
  'task-reviewer': 'text-cyan-400',
  'css-fixer': 'text-cyan-400',
  'tailwind-migrator': 'text-cyan-400',

  // Green agents
  'backlog-plan-generator': 'text-green-400',
  'qa-resolution-planner': 'text-green-400',
  'pr-document-maker': 'text-green-400',
  'qa-engineer': 'text-green-400',
  'task-maker': 'text-green-400',

  // Orange agents
  'workflow-aggregator': 'text-orange-400',
  'config-setup-agent': 'text-orange-400',
  'debugger': 'text-orange-400',
  'cleanup-agent': 'text-orange-400',
  'devops-engineer': 'text-orange-400',

  // Pink agents
  'frontend-engineer': 'text-pink-400',
  'v0-ui-generator': 'text-pink-400',

  // Purple agents
  'css-resolution-planner': 'text-purple-400',
  'research': 'text-purple-400',
  'v0-planner': 'text-purple-400',
  'cto-architect': 'text-purple-400',
  'style-guide-generator': 'text-purple-400',

  // Red agents
  'auto-fixer': 'text-red-400',
  'lint-resolution-planner': 'text-red-400',

  // Yellow agents
  'lint-fixer': 'text-yellow-400',
  'task-status-auditor': 'text-yellow-400',
  'code-reviewer': 'text-yellow-400',
  'agent-analyzer': 'text-yellow-400',
};

/** Default color for unknown agents */
const DEFAULT_AGENT_COLOR = 'text-gray-400';

/**
 * Stage-to-agent mapping for workflow stages
 * Maps generic stage names to their typical agent for coloring
 */
const STAGE_TO_AGENT: Record<string, string> = {
  'implementation': 'frontend-engineer',  // Pink - generic impl stage
  'code-review': 'code-reviewer',         // Yellow
  'code_review': 'code-reviewer',         // Yellow (underscore variant)
  'planning': 'feature-planner',          // Blue
  'task-creation': 'task-maker',          // Green
  'task_creation': 'task-maker',          // Green (underscore variant)
};

/**
 * Get Tailwind color class for an agent name
 * @param agentName - Name of the agent (e.g., 'frontend-engineer')
 * @returns Tailwind text color class (e.g., 'text-pink-400')
 */
export function getAgentColorClass(agentName: string | undefined): string {
  if (!agentName) {
    return DEFAULT_AGENT_COLOR;
  }
  // Strip common suffixes like " invoked" that may be appended by the backend
  const normalizedName = agentName.replace(/ invoked$/i, '').trim();

  // First check if it's a direct agent name
  if (AGENT_COLORS[normalizedName]) {
    return AGENT_COLORS[normalizedName];
  }

  // Then check if it's a stage name that maps to an agent
  const mappedAgent = STAGE_TO_AGENT[normalizedName];
  if (mappedAgent && AGENT_COLORS[mappedAgent]) {
    return AGENT_COLORS[mappedAgent];
  }

  return DEFAULT_AGENT_COLOR;
}
