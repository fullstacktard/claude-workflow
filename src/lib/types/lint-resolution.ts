/**
 * Lint Resolution Workflow Type Definitions
 *
 * Shared type definitions for the lint resolution campaign workflow.
 * These types define the structure of analysis results, agent reports,
 * phase results, and campaign state.
 *
 * @module lint-resolution
 * @version 1.0.0
 */

/**
 * Agent execution report
 * Returned by each lint-fixer agent after completing work
 */
export interface AgentReport {
  agentId: string;
  deferredErrors?: {
    blockedBy?: string;
    error: string;
    reason: string;
  }[];
  errorsFixed: number;
  errorsRemaining: number;
  iteration: number;
  maxIterations: number;
  scope: { target: string; type: "file" | "rule"; };
  status: "BLOCKED" | "DEFERRED" | "FAILED" | "SUCCESS";
}

/**
 * Agent scope definition
 * Defines what the agent is working on (file or rule)
 */
export interface AgentScope {
  target: string;
  type: "file" | "rule";
}

/**
 * Agent state tracking
 * Tracks agent iteration and progress
 */
export interface AgentState {
  errorsFixed: number;
  iteration: number;
  lastStatus: string;
  scope: AgentScope;
}

/**
 * Campaign configuration
 * Controls campaign behavior and mock behavior for testing
 */
export interface CampaignConfig {
  branchDeleteFunction?: (branch: string) => void;
  enableRetry?: boolean;
  enableVerification?: boolean;
  gitCheckoutFunction?: (branch: string) => void;
  gitResetFunction?: (ref: string) => void;
  initialErrors: number;
  mockAgentBehavior?: MockAgentConfig;
  mockAutoFixReduction?: number;
  mockDeferredGrowth?: boolean;
  mockNoProgress?: boolean;
  mockSteadyProgress?: boolean;
  mockStuckScenario?: boolean;
  optInDeadCode?: boolean;
  phases?: number[];
  strategy?: string;
  userAbortAtPhase?: number;
  verificationFailAtPhase?: number;
  verificationFunction?: (diff: string) => Promise<VerificationResult>;
}

/**
 * Campaign execution result
 * Final result of complete campaign execution
 */
export interface CampaignResult {
  config: CampaignConfig;
  escalationReason?: string;
  failureReason?: string;
  phases: PhaseResult[];
  rounds: RoundResult[];
  state: CampaignState;
  status: "COMPLETE" | "ESCALATED" | "FAILED";
  strategy: string;
  totalErrorsFixed: number;
  verificationCalls: number;
}

/**
 * Campaign execution state
 * Tracks current progress and error counts
 */
export interface CampaignState {
  agent_reports: AgentReport[];
  deferred_count: number;
  errors_fixed: number;
  errors_remaining: number;
  errorsByFile: Record<string, number>;
  phase: number;
  round: number;
  verification_passed: boolean;
}

/**
 * Deferred error tracking
 * Errors that couldn't be fixed due to blockers
 */
export interface DeferredError {
  blockedBy?: string;
  error: string;
  file?: string;
  reason: string;
}

/**
 * Escalation check result
 * Determines if campaign should escalate
 */
export interface EscalationCheck {
  reason?: string;
  shouldEscalate: boolean;
}

/**
 * Lint analysis result structure
 * Contains error statistics and categorization
 */
export interface LintAnalysis {
  errorsByFile: Record<string, number>;
  errorsByRule: Record<string, number>;
  estimatedEffort: {
    autoFixable: number;
    complexity: "complex" | "medium" | "simple";
    manualRequired: number;
  };
  topFiles: { count: number; file: string; primaryRules: string[] }[];
  topRules: { count: number; fixable: boolean; rule: string; }[];
  totalErrors: number;
}

/**
 * Mock agent behavior configuration
 * Used in tests to control agent success/failure rates
 */
export interface MockAgentConfig {
  blockedRate: number;
  deferredRate: number;
  errorsPerAgent: { max: number; min: number; };
  successRate: number;
}

/**
 * Phase execution result
 * Contains complete metrics for a campaign phase
 */
export interface PhaseResult {
  deferredBacklog: DeferredError[];
  endTime: number;
  errorsFixed: number;
  errorsRemaining: number;
  name: string;
  phase: number;
  retryAttempt?: number;
  rolledBack: boolean;
  rounds: RoundResult[];
  startTime: number;
  strategyUsed: string;
  verification: VerificationResult;
}

/**
 * Round execution result
 * Contains metrics for a single round of agent spawning
 */
export interface RoundResult {
  agentsSpawned: number;
  deferredCount: number;
  errorsFixed: number;
  errorsRemaining: number;
  reports: AgentReport[];
  round: number;
}

/**
 * Verification result from refactor-verifier agent
 * Determines if changes maintain semantic equivalence
 */
export interface VerificationResult {
  breaking_changes: string[];
  semantic_equivalence: boolean;
}
