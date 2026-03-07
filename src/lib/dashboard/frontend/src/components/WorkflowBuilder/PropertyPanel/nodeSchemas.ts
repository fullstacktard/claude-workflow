/**
 * Node Property Schemas
 * Type-safe definitions for workflow node properties and form field configurations
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Base properties shared by all node types
 */
export interface BaseNodeProperties {
  id: string;
  label: string;
  description?: string;
}

// ============================================================================
// Node Type Interfaces
// ============================================================================

/**
 * Entry node properties
 * Entry nodes mark workflow start points
 */
export interface EntryNodeProperties extends BaseNodeProperties {
  type: 'entry';
  trigger?: 'manual' | 'webhook' | 'scheduled';
  schedule?: string; // cron expression for scheduled triggers
}

/**
 * Phase node properties
 * Phases represent stages in the workflow where agents execute tasks
 */
export interface PhaseNodeProperties extends BaseNodeProperties {
  type: 'phase';
  agent: string; // agent name to spawn
  count: string; // '1', 'from_previous', or 'by_assignment'
  next: string | null; // next phase ID
}

/**
 * Condition node properties
 * Condition nodes provide branching logic based on expressions
 */
export interface ConditionNodeProperties extends BaseNodeProperties {
  type: 'condition';
  expression: string; // condition expression or template name
  customExpression?: string; // custom expression when expression is 'custom'
  trueBranch?: string; // node ID to go to if true (derived from edges)
  falseBranch?: string; // node ID to go to if false (derived from edges)
}

/**
 * Agent node properties
 * Agent nodes represent direct agent invocations
 */
export interface AgentNodeProperties extends BaseNodeProperties {
  type: 'agent';
  agentName: string;
  parameters?: Record<string, unknown>;
}

/**
 * Hook node properties
 * Hooks attach lifecycle handlers to phases
 */
export interface HookNodeProperties extends BaseNodeProperties {
  type: 'hook';
  hookType: 'before_phase' | 'after_phase' | 'on_error';
  targetPhase: string; // phase ID this hook attaches to
  script?: string; // optional script to run
}

/**
 * Union type for all node property types
 */
export type NodeProperties =
  | EntryNodeProperties
  | PhaseNodeProperties
  | ConditionNodeProperties
  | AgentNodeProperties
  | HookNodeProperties;

// ============================================================================
// Form Field Schema
// ============================================================================

/**
 * Field type definitions for form rendering
 */
export type FieldType = 'text' | 'textarea' | 'select' | 'number';

/**
 * Form field configuration
 */
export interface FieldSchema {
  name: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: readonly string[];
  showIf?: (data: Partial<NodeProperties>) => boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}

/**
 * Common agent types available in the system
 * These are pre-populated for easy selection
 */
export const AVAILABLE_AGENTS = [
  'frontend-engineer',
  'backend-engineer',
  'devops-engineer',
  'qa-engineer',
  'cto-architect',
  'code-reviewer',
  'debugger',
  'auto-fixer',
  'lint-fixer',
  'task-maker',
  'feature-planner',
  'research',
  'Explore',
] as const;

/**
 * Condition expression templates for easy selection
 */
export const CONDITION_TEMPLATES = [
  'all_tasks_complete',
  'has_errors',
  'output_count > 0',
  'status === "success"',
  'custom',
] as const;

/**
 * Node type to field schema mapping
 * Simplified to minimize typing - connections derive from edges automatically
 */
export const NODE_FIELD_SCHEMAS: Record<string, readonly FieldSchema[]> = {
  entry: [
    {
      name: 'trigger',
      type: 'select',
      label: 'Trigger Type',
      options: ['manual', 'webhook', 'scheduled'],
      required: true,
    },
    {
      name: 'schedule',
      type: 'text',
      label: 'Schedule (cron)',
      required: false,
      placeholder: '0 0 * * *',
      showIf: (data) => (data as Partial<EntryNodeProperties>).trigger === 'scheduled',
    },
  ],
  phase: [
    {
      name: 'agent',
      type: 'select',
      label: 'Agent',
      options: [...AVAILABLE_AGENTS],
      required: true,
    },
    {
      name: 'count',
      type: 'select',
      label: 'Agent Count',
      options: ['1', 'from_previous', 'by_assignment'],
      required: false,
    },
  ],
  condition: [
    {
      name: 'expression',
      type: 'select',
      label: 'Condition',
      options: [...CONDITION_TEMPLATES],
      required: true,
    },
    {
      name: 'customExpression',
      type: 'text',
      label: 'Custom Expression',
      required: false,
      placeholder: 'task.status === "done"',
      showIf: (data) => (data as Partial<ConditionNodeProperties>).expression === 'custom',
    },
  ],
  agent: [
    {
      name: 'agentName',
      type: 'select',
      label: 'Agent',
      options: [...AVAILABLE_AGENTS],
      required: true,
    },
  ],
  hook: [
    {
      name: 'hookType',
      type: 'select',
      label: 'Hook Type',
      options: ['before_phase', 'after_phase', 'on_error'],
      required: true,
    },
  ],
} as const;
