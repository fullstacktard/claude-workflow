/**
 * ClaudeProxyConfigScreen Component
 * Configuration editor for claude-proxy routing rules and ensembling
 */

import { useState, useEffect, useCallback } from "react";
import { TerminalCard } from "../components/TerminalCard";

/**
 * Simplified routing rule for UI
 */
interface SimpleRoutingRule {
  /** Source model pattern to match (e.g., "haiku", "sonnet") */
  sourcePattern: string;
  /** Target model alias to route to (e.g., "opus", "sonnet") */
  targetAlias: string;
  /** Whether this rule is enabled */
  enabled: boolean;
}

/**
 * Available source patterns (what Claude Code requests)
 */
const SOURCE_PATTERNS = [
  { value: "opus", label: "Opus requests", description: "Matches claude-opus-*" },
  { value: "sonnet", label: "Sonnet requests", description: "Matches claude-sonnet-*" },
  { value: "haiku", label: "Haiku requests", description: "Matches claude-haiku-*" }
];

/**
 * Available target aliases (what claude-proxy routes to)
 */
const TARGET_ALIASES = [
  { value: "opus", label: "Opus (claude-opus-4-6)", description: "Anthropic direct" },
  { value: "sonnet", label: "Sonnet (claude-sonnet-4-5-20251101)", description: "Routed via GLM API" },
  { value: "haiku", label: "Haiku (claude-haiku-4-5-20251001)", description: "Anthropic direct" }
];

/**
 * Available ensembling strategies
 */
const STRATEGY_OPTIONS = [
  { value: "self_moa", label: "Self-MoA", description: "Same model, different temperatures" },
  { value: "multi_model", label: "Multi-Model", description: "Different models/providers" },
  { value: "hybrid", label: "Hybrid", description: "Self-MoA + extra models" },
];

const JUDGE_MODE_OPTIONS = [
  { value: "pairwise", label: "Pairwise" },
  { value: "pointwise", label: "Pointwise" },
  { value: "multi_perspective", label: "Multi-Perspective" },
];

/**
 * Ensembling config shape matching the YAML
 */
interface EnsemblingYamlConfig {
  ensembling: {
    enabled: boolean;
    default_strategy: string;
    strategies: {
      self_moa: {
        candidates: number;
        temperatures: number[];
        judge_model: string;
        judge_mode: string;
        consensus_threshold: number;
        position_bias_mitigation: boolean;
      };
      multi_model: {
        candidates: Array<{ model: string; provider: string; temperature?: number; api_base?: string; api_key_env?: string }>;
        judge_model: string;
        judge_provider: string;
        judge_mode: string;
        consensus_threshold: number;
        position_bias_mitigation: boolean;
      };
      hybrid: {
        candidates: number;
        temperatures: number[];
        extra_models: Array<{ model: string; provider: string; api_base?: string; api_key_env?: string }>;
        judge_model: string;
        judge_provider: string;
        judge_mode: string;
        consensus_threshold: number;
        position_bias_mitigation: boolean;
      };
    };
    prompt_repetition: { enabled: boolean; mode: string };
    execution_sandbox: { enabled: boolean; timeout_seconds: number; checks: string[] };
    agent_overrides: Record<string, Record<string, string>>;
  };
}

const DEFAULT_ENSEMBLING: EnsemblingYamlConfig = {
  ensembling: {
    enabled: false,
    default_strategy: "self_moa",
    strategies: {
      self_moa: {
        candidates: 3,
        temperatures: [0.3, 0.6, 0.9],
        judge_model: "same",
        judge_mode: "pairwise",
        consensus_threshold: 0.67,
        position_bias_mitigation: true,
      },
      multi_model: {
        candidates: [],
        judge_model: "claude-opus-4-6",
        judge_provider: "anthropic",
        judge_mode: "multi_perspective",
        consensus_threshold: 0.67,
        position_bias_mitigation: true,
      },
      hybrid: {
        candidates: 3,
        temperatures: [0.3, 0.6, 0.9],
        extra_models: [],
        judge_model: "claude-opus-4-6",
        judge_provider: "anthropic",
        judge_mode: "pairwise",
        consensus_threshold: 0.67,
        position_bias_mitigation: true,
      },
    },
    prompt_repetition: { enabled: false, mode: "concat" },
    execution_sandbox: { enabled: false, timeout_seconds: 30, checks: ["syntax"] },
    agent_overrides: {},
  },
};

export function ClaudeProxyConfigScreen(): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [rules, setRules] = useState<SimpleRoutingRule[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reloadStatus, setReloadStatus] = useState<string | null>(null);

  // Ensembling state
  const [ensemblingConfig, setEnsemblingConfig] = useState<EnsemblingYamlConfig>(DEFAULT_ENSEMBLING);
  const [ensemblingLoading, setEnsemblingLoading] = useState(true);
  const [ensemblingHasChanges, setEnsemblingHasChanges] = useState(false);
  const [ensemblingSaving, setEnsemblingSaving] = useState(false);
  const [ensemblingSaveError, setEnsemblingSaveError] = useState<string | null>(null);
  const [ensemblingSaveSuccess, setEnsemblingSaveSuccess] = useState(false);
  const [ensemblingStatus, setEnsemblingStatus] = useState<{
    recent_decisions: Array<Record<string, unknown>>;
    strategy_metrics: Record<string, { total_requests: number; avg_latency_ms: number; avg_tokens: number; winner_distribution: Record<string, number> }>;
  } | null>(null);

  /**
   * Fetch current routing rules
   */
  useEffect(() => {
    async function fetchRules(): Promise<void> {
      try {
        const response = await fetch("/api/claude-proxy/rules");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json() as { rules: SimpleRoutingRule[] };
        setRules(data.rules || []);
      } catch (error) {
        console.error("[claude-proxy-config] Error fetching rules:", error);
        // Initialize with empty rules if fetch fails
        setRules([]);
      } finally {
        setIsLoading(false);
      }
    }

    void fetchRules();
  }, []);

  /**
   * Add a new rule
   */
  function handleAddRule(): void {
    setRules(prev => [
      ...prev,
      { sourcePattern: "", targetAlias: "", enabled: true }
    ]);
    setHasChanges(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  /**
   * Remove a rule
   */
  function handleRemoveRule(index: number): void {
    setRules(prev => prev.filter((_, i) => i !== index));
    setHasChanges(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  /**
   * Update a rule field
   */
  function handleRuleChange(index: number, field: keyof SimpleRoutingRule, value: string | boolean): void {
    setRules(prev => prev.map((rule, i) =>
      i === index ? { ...rule, [field]: value } : rule
    ));
    setHasChanges(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  /**
   * Save rules to server
   */
  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setReloadStatus(null);

    try {
      // Filter out incomplete rules
      const validRules = rules.filter(r => r.sourcePattern && r.targetAlias);

      const response = await fetch("/api/claude-proxy/rules", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rules: validRules })
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const result = await response.json() as { reloaded: boolean; message: string };

      setHasChanges(false);
      setSaveSuccess(true);
      setReloadStatus(result.message);

      // Clear success message after 5 seconds
      setTimeout(() => {
        setSaveSuccess(false);
        setReloadStatus(null);
      }, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save rules";
      setSaveError(message);
      console.error("[claude-proxy-config] Error saving rules:", error);
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Reset changes
   */
  function handleReset(): void {
    async function fetchRules(): Promise<void> {
      setIsLoading(true);
      try {
        const response = await fetch("/api/claude-proxy/rules");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json() as { rules: SimpleRoutingRule[] };
        setRules(data.rules || []);
        setHasChanges(false);
        setSaveError(null);
        setSaveSuccess(false);
      } catch (error) {
        console.error("[claude-proxy-config] Error fetching rules:", error);
      } finally {
        setIsLoading(false);
      }
    }

    void fetchRules();
  }

  // ===== ENSEMBLING HANDLERS =====

  const fetchEnsemblingConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/claude-proxy/ensembling");
      if (response.ok) {
        const data = await response.json() as EnsemblingYamlConfig;
        setEnsemblingConfig(data);
      }
    } catch (error) {
      console.error("[ensembling] Error fetching config:", error);
    } finally {
      setEnsemblingLoading(false);
    }
  }, []);

  const fetchEnsemblingStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/claude-proxy/ensembling/status");
      if (response.ok) {
        const data = await response.json();
        setEnsemblingStatus(data);
      }
    } catch {
      // Proxy may not be running
    }
  }, []);

  useEffect(() => {
    void fetchEnsemblingConfig();
    void fetchEnsemblingStatus();
  }, [fetchEnsemblingConfig, fetchEnsemblingStatus]);

  function updateEnsembling(updater: (prev: EnsemblingYamlConfig) => EnsemblingYamlConfig): void {
    setEnsemblingConfig(updater);
    setEnsemblingHasChanges(true);
    setEnsemblingSaveError(null);
    setEnsemblingSaveSuccess(false);
  }

  async function handleEnsemblingSave(): Promise<void> {
    setEnsemblingSaving(true);
    setEnsemblingSaveError(null);
    setEnsemblingSaveSuccess(false);

    try {
      const response = await fetch("/api/claude-proxy/ensembling", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ensemblingConfig),
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setEnsemblingHasChanges(false);
      setEnsemblingSaveSuccess(true);
      setTimeout(() => setEnsemblingSaveSuccess(false), 5000);
    } catch (error) {
      setEnsemblingSaveError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setEnsemblingSaving(false);
    }
  }

  function handleEnsemblingReset(): void {
    void fetchEnsemblingConfig();
    setEnsemblingHasChanges(false);
    setEnsemblingSaveError(null);
    setEnsemblingSaveSuccess(false);
  }

  // Shorthand accessor for the current strategy config
  const ens = ensemblingConfig.ensembling;
  const activeStrategy = ens.default_strategy as "self_moa" | "multi_model" | "hybrid";
  const selfMoa = ens.strategies.self_moa;
  const multiModel = ens.strategies.multi_model;
  const hybrid = ens.strategies.hybrid;

  /**
   * Get description for a target alias
   */
  function getTargetDescription(alias: string): string {
    const target = TARGET_ALIASES.find(t => t.value === alias);
    return target?.description || alias;
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col bg-gray-950 p-6 gap-6 overflow-hidden">
        {/* Skeleton: Routing Rules card */}
        <TerminalCard command="cat" filename="~/.claude-workflow/claude-proxy-config.yaml" headerText="Routing Rules" className="min-h-0 flex-1">
          <div className="flex flex-col flex-1 min-h-0 h-full -mx-4 -my-4 animate-pulse overflow-hidden">
            {/* Info box skeleton */}
            <div className="px-4 py-3 border-b border-red-800/30">
              <div className="h-3 w-48 bg-gray-800/35 rounded mb-2" />
              <div className="h-2.5 w-full bg-gray-800/20 rounded" />
            </div>
            {/* Rule row skeletons */}
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3 border-t border-red-800/30">
                <div className="h-3 w-6 bg-gray-800/35 rounded shrink-0" />
                <div className="h-5 w-9 bg-gray-800/35 rounded-full shrink-0" />
                <div className="h-8 bg-gray-800/50 rounded flex-1" style={{ maxWidth: `${140 + (i % 3) * 30}px` }} />
                <div className="h-3 w-6 bg-gray-800/20 rounded shrink-0" />
                <div className="h-8 bg-gray-800/50 rounded flex-1" style={{ maxWidth: `${120 + (i % 2) * 40}px` }} />
                <div className="h-7 w-7 bg-gray-800/20 rounded shrink-0" />
              </div>
            ))}
          </div>
        </TerminalCard>

        {/* Skeleton: Ensembling card */}
        <TerminalCard command="cat" filename="~/.claude-proxy/ensembling_config.yaml" headerText="Ensembling (MoA)" className="min-h-0 flex-[0.6]">
          <div className="flex flex-col flex-1 min-h-0 h-full -mx-4 -my-4 animate-pulse overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-4">
              <div className="h-5 w-9 bg-gray-800/35 rounded-full" />
              <div className="h-3 w-16 bg-gray-800/35 rounded" />
              <div className="h-8 w-32 bg-gray-800/50 rounded" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3 border-t border-red-800/30">
                <div className="h-4 bg-gray-800/50 rounded" style={{ width: `${100 + (i % 2) * 40}px` }} />
                <div className="h-3 w-20 bg-gray-800/20 rounded" />
              </div>
            ))}
          </div>
        </TerminalCard>
      </div>
    );
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        onClick={handleAddRule}
        className="h-7 px-3 text-xs bg-transparent border-1 border-green-800 text-green-400 rounded-md hover:bg-green-800 hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 focus:ring-offset-gray-900"
        type="button"
      >
        + Add Rule
      </button>
      <button
        onClick={handleReset}
        disabled={!hasChanges || isSaving}
        className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 disabled:bg-gray-800 disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
        type="button"
      >
        Reset
      </button>
      <button
        onClick={() => void handleSave()}
        disabled={!hasChanges || isSaving}
        className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 disabled:bg-gray-800 disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
        type="button"
      >
        {isSaving ? "Saving..." : hasChanges ? "Save" : "Saved"}
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-gray-950 p-6 gap-6 overflow-y-auto scrollbar-hide">
      <TerminalCard
        command="cat"
        filename="~/.claude-workflow/claude-proxy-config.yaml"
        headerText="Routing Rules"
        headerActions={headerActions}
        className="min-h-0"
      >
        <div className="space-y-4 overflow-y-auto scrollbar-hide">
          {/* Success message */}
          {saveSuccess && (
            <div className="p-3 bg-gray-800/50 border-1 border-gray-700 rounded text-gray-300 text-sm">
              {reloadStatus || "Rules saved successfully!"}
            </div>
          )}

          {/* Error message */}
          {saveError !== null && (
            <div className="p-3 bg-red-900/30 border-1 border-red-800 rounded text-red-300 text-sm">
              Error: {saveError}
            </div>
          )}

          {/* Info about how rules work */}
          <div className="p-3 bg-gray-900/50 border-1 border-gray-700 rounded text-gray-400 text-xs">
            <p className="font-medium text-gray-300 mb-1">How routing rules work:</p>
            <p>Rules match requests by model name substring. When Claude Code requests a model containing the source pattern, claude-proxy routes it to the target model. Rules are evaluated top-to-bottom, first match wins.</p>
          </div>

          {/* Rules list */}
          {rules.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <p>No routing rules configured.</p>
              <p className="text-xs mt-1">All requests will pass through to Anthropic API directly.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule, index) => (
                <div
                  key={index}
                  className={`p-3 border rounded ${
                    rule.enabled
                      ? "bg-gray-900/50 border-gray-700"
                      : "bg-gray-900/20 border-gray-800 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Rule number */}
                    <span className="text-xs text-gray-500 w-6">#{index + 1}</span>

                    {/* Enabled toggle */}
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => handleRuleChange(index, "enabled", e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600 peer-checked:after:bg-white"></div>
                    </label>

                    {/* Source pattern dropdown */}
                    <select
                      value={rule.sourcePattern}
                      onChange={(e) => handleRuleChange(index, "sourcePattern", e.target.value)}
                      className="flex-1 p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    >
                      <option value="">Select source...</option>
                      {SOURCE_PATTERNS.map((pattern) => (
                        <option key={pattern.value} value={pattern.value}>
                          {pattern.label}
                        </option>
                      ))}
                    </select>

                    {/* Arrow */}
                    <span className="text-gray-500">→</span>

                    {/* Target alias dropdown */}
                    <select
                      value={rule.targetAlias}
                      onChange={(e) => handleRuleChange(index, "targetAlias", e.target.value)}
                      className="flex-1 p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent"
                    >
                      <option value="">Select target...</option>
                      {TARGET_ALIASES.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </select>

                    {/* Remove button */}
                    <button
                      onClick={() => handleRemoveRule(index)}
                      className="p-1 text-red-500 hover:text-red-400 transition-colors"
                      type="button"
                      title="Remove rule"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {/* Rule description */}
                  {rule.sourcePattern && rule.targetAlias && (
                    <div className="mt-2 text-xs text-gray-500 ml-9">
                      Requests containing "<span className="text-gray-300">{rule.sourcePattern}</span>" → <span className="text-gray-300">{getTargetDescription(rule.targetAlias)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Current effective routing summary */}
          {rules.length > 0 && (
            <div className="mt-4 p-3 bg-gray-900/30 border-1 border-gray-800 rounded">
              <p className="text-xs font-medium text-gray-400 mb-2">Effective Routing:</p>
              <div className="space-y-1">
                {SOURCE_PATTERNS.map((pattern) => {
                  const matchingRule = rules.find(r => r.enabled && r.sourcePattern === pattern.value);
                  const target = matchingRule
                    ? TARGET_ALIASES.find(t => t.value === matchingRule.targetAlias)
                    : null;

                  return (
                    <div key={pattern.value} className="flex items-center text-xs">
                      <span className="w-20 text-gray-400">{pattern.label.replace(" requests", "")}:</span>
                      {target ? (
                        <span className="text-green-400">→ {target.label}</span>
                      ) : (
                        <span className="text-gray-500">Passthrough (Anthropic API)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </TerminalCard>

      {/* ===== ENSEMBLING SETTINGS ===== */}
      <TerminalCard
        command="cat"
        filename="~/.claude-proxy/ensembling_config.yaml"
        headerText="Ensembling (MoA)"
        headerActions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleEnsemblingReset}
              disabled={!ensemblingHasChanges || ensemblingSaving}
              className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 disabled:bg-gray-800 disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              Reset
            </button>
            <button
              onClick={() => void handleEnsemblingSave()}
              disabled={!ensemblingHasChanges || ensemblingSaving}
              className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 disabled:bg-gray-800 disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              {ensemblingSaving ? "Saving..." : ensemblingHasChanges ? "Save" : "Saved"}
            </button>
          </div>
        }
        className="min-h-0"
      >
        {ensemblingLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="spinner w-6 h-6" />
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto scrollbar-hide">
            {/* Save messages */}
            {ensemblingSaveSuccess && (
              <div className="p-3 bg-gray-800/50 border-1 border-gray-700 rounded text-gray-300 text-sm">
                Ensembling config saved and reloaded.
              </div>
            )}
            {ensemblingSaveError !== null && (
              <div className="p-3 bg-red-900/30 border-1 border-red-800 rounded text-red-300 text-sm">
                Error: {ensemblingSaveError}
              </div>
            )}

            {/* Enabled toggle + Strategy selector */}
            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={ens.enabled}
                  onChange={(e) => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: { ...prev.ensembling, enabled: e.target.checked },
                  }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600 peer-checked:after:bg-white" />
              </label>
              <span className={`text-sm ${ens.enabled ? "text-green-400" : "text-gray-500"}`}>
                {ens.enabled ? "Enabled" : "Disabled"}
              </span>

              <select
                value={ens.default_strategy}
                onChange={(e) => updateEnsembling(prev => ({
                  ...prev,
                  ensembling: { ...prev.ensembling, default_strategy: e.target.value },
                }))}
                className="ml-auto p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                {STRATEGY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Strategy description */}
            <div className="p-3 bg-gray-900/50 border-1 border-gray-700 rounded text-gray-400 text-xs">
              <p className="font-medium text-gray-300 mb-1">
                {STRATEGY_OPTIONS.find(s => s.value === activeStrategy)?.label}:
              </p>
              <p>{STRATEGY_OPTIONS.find(s => s.value === activeStrategy)?.description}</p>
              <p className="mt-1 text-gray-500">
                Generates N candidate responses in parallel, judges them via LLM, and returns the best one.
                Token cost: ~{activeStrategy === "hybrid" ? "4.4" : "3.3"}x per request.
              </p>
            </div>

            {/* Self-MoA settings */}
            {activeStrategy === "self_moa" && (
              <div className="space-y-3 p-3 border-1 border-gray-700 rounded bg-gray-900/30">
                <p className="text-xs font-medium text-gray-300">Self-MoA Settings</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Candidates</label>
                    <input
                      type="number"
                      min={2}
                      max={7}
                      value={selfMoa.candidates}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            self_moa: { ...prev.ensembling.strategies.self_moa, candidates: parseInt(e.target.value) || 3 },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Judge Mode</label>
                    <select
                      value={selfMoa.judge_mode}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            self_moa: { ...prev.ensembling.strategies.self_moa, judge_mode: e.target.value },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      {JUDGE_MODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Temperatures (comma-separated)</label>
                    <input
                      type="text"
                      value={selfMoa.temperatures.join(", ")}
                      onChange={(e) => {
                        const temps = e.target.value.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
                        updateEnsembling(prev => ({
                          ...prev,
                          ensembling: {
                            ...prev.ensembling,
                            strategies: {
                              ...prev.ensembling.strategies,
                              self_moa: { ...prev.ensembling.strategies.self_moa, temperatures: temps.length > 0 ? temps : [0.5] },
                            },
                          },
                        }));
                      }}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Consensus Threshold</label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={selfMoa.consensus_threshold}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            self_moa: { ...prev.ensembling.strategies.self_moa, consensus_threshold: parseFloat(e.target.value) || 0.67 },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selfMoa.position_bias_mitigation}
                    onChange={(e) => updateEnsembling(prev => ({
                      ...prev,
                      ensembling: {
                        ...prev.ensembling,
                        strategies: {
                          ...prev.ensembling.strategies,
                          self_moa: { ...prev.ensembling.strategies.self_moa, position_bias_mitigation: e.target.checked },
                        },
                      },
                    }))}
                    className="rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-400">Position bias mitigation (run judge twice with A/B swapped)</span>
                </label>
              </div>
            )}

            {/* Multi-Model settings */}
            {activeStrategy === "multi_model" && (
              <div className="space-y-3 p-3 border-1 border-gray-700 rounded bg-gray-900/30">
                <p className="text-xs font-medium text-gray-300">Multi-Model Settings</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Judge Model</label>
                    <input
                      type="text"
                      value={multiModel.judge_model}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            multi_model: { ...prev.ensembling.strategies.multi_model, judge_model: e.target.value },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Judge Mode</label>
                    <select
                      value={multiModel.judge_mode}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            multi_model: { ...prev.ensembling.strategies.multi_model, judge_mode: e.target.value },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      {JUDGE_MODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Judge Provider</label>
                    <select
                      value={multiModel.judge_provider}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            multi_model: { ...prev.ensembling.strategies.multi_model, judge_provider: e.target.value },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="local">Local</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Consensus Threshold</label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={multiModel.consensus_threshold}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            multi_model: { ...prev.ensembling.strategies.multi_model, consensus_threshold: parseFloat(e.target.value) || 0.67 },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>
                </div>

                {/* Model Candidates List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">Model Candidates</label>
                    <button
                      onClick={() => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            multi_model: {
                              ...prev.ensembling.strategies.multi_model,
                              candidates: [...prev.ensembling.strategies.multi_model.candidates, { model: "", provider: "anthropic", temperature: 0.5 }],
                            },
                          },
                        },
                      }))}
                      className="text-xs text-red-400 hover:text-red-300"
                      type="button"
                    >
                      + Add
                    </button>
                  </div>
                  {multiModel.candidates.map((cand, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
                      <input
                        type="text"
                        placeholder="model"
                        value={cand.model}
                        onChange={(e) => updateEnsembling(prev => {
                          const newCandidates = [...prev.ensembling.strategies.multi_model.candidates];
                          newCandidates[idx] = { ...newCandidates[idx], model: e.target.value };
                          return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, multi_model: { ...prev.ensembling.strategies.multi_model, candidates: newCandidates } } } };
                        })}
                        className="flex-1 p-1.5 text-xs bg-gray-700 border-1 border-gray-600 rounded text-white"
                      />
                      <select
                        value={cand.provider}
                        onChange={(e) => updateEnsembling(prev => {
                          const newCandidates = [...prev.ensembling.strategies.multi_model.candidates];
                          newCandidates[idx] = { ...newCandidates[idx], provider: e.target.value };
                          return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, multi_model: { ...prev.ensembling.strategies.multi_model, candidates: newCandidates } } } };
                        })}
                        className="p-1.5 text-xs bg-gray-700 border-1 border-gray-600 rounded text-white"
                      >
                        <option value="anthropic">Anthropic</option>
                        <option value="openai">OpenAI</option>
                        <option value="local">Local</option>
                      </select>
                      <button
                        onClick={() => updateEnsembling(prev => ({
                          ...prev,
                          ensembling: {
                            ...prev.ensembling,
                            strategies: {
                              ...prev.ensembling.strategies,
                              multi_model: {
                                ...prev.ensembling.strategies.multi_model,
                                candidates: prev.ensembling.strategies.multi_model.candidates.filter((_, i) => i !== idx),
                              },
                            },
                          },
                        }))}
                        className="text-red-500 hover:text-red-400 text-xs px-1"
                        type="button"
                      >
                        x
                      </button>
                    </div>
                  ))}
                  {multiModel.candidates.length === 0 && (
                    <p className="text-xs text-gray-500 italic">No candidates configured. Add models to enable multi-model ensembling.</p>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={multiModel.position_bias_mitigation}
                    onChange={(e) => updateEnsembling(prev => ({
                      ...prev,
                      ensembling: {
                        ...prev.ensembling,
                        strategies: {
                          ...prev.ensembling.strategies,
                          multi_model: { ...prev.ensembling.strategies.multi_model, position_bias_mitigation: e.target.checked },
                        },
                      },
                    }))}
                    className="rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-400">Position bias mitigation</span>
                </label>
              </div>
            )}

            {/* Hybrid settings */}
            {activeStrategy === "hybrid" && (
              <div className="space-y-3 p-3 border-1 border-gray-700 rounded bg-gray-900/30">
                <p className="text-xs font-medium text-gray-300">Hybrid Settings</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Self-MoA Candidates</label>
                    <input
                      type="number"
                      min={2}
                      max={7}
                      value={hybrid.candidates}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            hybrid: { ...prev.ensembling.strategies.hybrid, candidates: parseInt(e.target.value) || 3 },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Judge Mode</label>
                    <select
                      value={hybrid.judge_mode}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            hybrid: { ...prev.ensembling.strategies.hybrid, judge_mode: e.target.value },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      {JUDGE_MODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Temperatures (comma-separated)</label>
                    <input
                      type="text"
                      value={hybrid.temperatures.join(", ")}
                      onChange={(e) => {
                        const temps = e.target.value.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
                        updateEnsembling(prev => ({
                          ...prev,
                          ensembling: {
                            ...prev.ensembling,
                            strategies: {
                              ...prev.ensembling.strategies,
                              hybrid: { ...prev.ensembling.strategies.hybrid, temperatures: temps.length > 0 ? temps : [0.5] },
                            },
                          },
                        }));
                      }}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Judge Model</label>
                    <input
                      type="text"
                      value={hybrid.judge_model}
                      onChange={(e) => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            hybrid: { ...prev.ensembling.strategies.hybrid, judge_model: e.target.value },
                          },
                        },
                      }))}
                      className="w-full p-2 text-sm bg-gray-800 border-1 border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>
                </div>

                {/* Extra Models List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">Extra Models</label>
                    <button
                      onClick={() => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            hybrid: {
                              ...prev.ensembling.strategies.hybrid,
                              extra_models: [...prev.ensembling.strategies.hybrid.extra_models, { model: "", provider: "openai" }],
                            },
                          },
                        },
                      }))}
                      className="text-xs text-red-400 hover:text-red-300"
                      type="button"
                    >
                      + Add
                    </button>
                  </div>
                  {hybrid.extra_models.map((extra, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
                      <input
                        type="text"
                        placeholder="model"
                        value={extra.model}
                        onChange={(e) => updateEnsembling(prev => {
                          const newExtras = [...prev.ensembling.strategies.hybrid.extra_models];
                          newExtras[idx] = { ...newExtras[idx], model: e.target.value };
                          return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, hybrid: { ...prev.ensembling.strategies.hybrid, extra_models: newExtras } } } };
                        })}
                        className="flex-1 p-1.5 text-xs bg-gray-700 border-1 border-gray-600 rounded text-white"
                      />
                      <select
                        value={extra.provider}
                        onChange={(e) => updateEnsembling(prev => {
                          const newExtras = [...prev.ensembling.strategies.hybrid.extra_models];
                          newExtras[idx] = { ...newExtras[idx], provider: e.target.value };
                          return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, hybrid: { ...prev.ensembling.strategies.hybrid, extra_models: newExtras } } } };
                        })}
                        className="p-1.5 text-xs bg-gray-700 border-1 border-gray-600 rounded text-white"
                      >
                        <option value="anthropic">Anthropic</option>
                        <option value="openai">OpenAI</option>
                        <option value="local">Local</option>
                      </select>
                      <button
                        onClick={() => updateEnsembling(prev => ({
                          ...prev,
                          ensembling: {
                            ...prev.ensembling,
                            strategies: {
                              ...prev.ensembling.strategies,
                              hybrid: {
                                ...prev.ensembling.strategies.hybrid,
                                extra_models: prev.ensembling.strategies.hybrid.extra_models.filter((_, i) => i !== idx),
                              },
                            },
                          },
                        }))}
                        className="text-red-500 hover:text-red-400 text-xs px-1"
                        type="button"
                      >
                        x
                      </button>
                    </div>
                  ))}
                  {hybrid.extra_models.length === 0 && (
                    <p className="text-xs text-gray-500 italic">No extra models configured.</p>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hybrid.position_bias_mitigation}
                    onChange={(e) => updateEnsembling(prev => ({
                      ...prev,
                      ensembling: {
                        ...prev.ensembling,
                        strategies: {
                          ...prev.ensembling.strategies,
                          hybrid: { ...prev.ensembling.strategies.hybrid, position_bias_mitigation: e.target.checked },
                        },
                      },
                    }))}
                    className="rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-400">Position bias mitigation</span>
                </label>
              </div>
            )}

            {/* Agent Overrides */}
            <div className="space-y-2 p-3 border-1 border-gray-700 rounded bg-gray-900/30">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-300">Agent Overrides</p>
                <button
                  onClick={() => {
                    const prefix = prompt("Enter agent hash prefix:");
                    if (prefix) {
                      updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          agent_overrides: { ...prev.ensembling.agent_overrides, [prefix]: { strategy: "self_moa" } },
                        },
                      }));
                    }
                  }}
                  className="text-xs text-red-400 hover:text-red-300"
                  type="button"
                >
                  + Add Override
                </button>
              </div>
              {Object.entries(ens.agent_overrides).map(([prefix, override]) => (
                <div key={prefix} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
                  <span className="text-xs text-gray-400 font-mono w-20 truncate" title={prefix}>{prefix}</span>
                  <select
                    value={override.strategy || "self_moa"}
                    onChange={(e) => updateEnsembling(prev => ({
                      ...prev,
                      ensembling: {
                        ...prev.ensembling,
                        agent_overrides: { ...prev.ensembling.agent_overrides, [prefix]: { ...prev.ensembling.agent_overrides[prefix], strategy: e.target.value } },
                      },
                    }))}
                    className="flex-1 p-1.5 text-xs bg-gray-700 border-1 border-gray-600 rounded text-white"
                  >
                    {STRATEGY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => updateEnsembling(prev => {
                      const newOverrides = { ...prev.ensembling.agent_overrides };
                      delete newOverrides[prefix];
                      return { ...prev, ensembling: { ...prev.ensembling, agent_overrides: newOverrides } };
                    })}
                    className="text-red-500 hover:text-red-400 text-xs px-1"
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))}
              {Object.keys(ens.agent_overrides).length === 0 && (
                <p className="text-xs text-gray-500 italic">No agent overrides. All agents use the default strategy.</p>
              )}
            </div>

            {/* Prompt repetition */}
            <div className="flex items-center gap-3 p-3 border-1 border-gray-700 rounded bg-gray-900/30">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={ens.prompt_repetition.enabled}
                  onChange={(e) => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: {
                      ...prev.ensembling,
                      prompt_repetition: { ...prev.ensembling.prompt_repetition, enabled: e.target.checked },
                    },
                  }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600 peer-checked:after:bg-white" />
              </label>
              <div>
                <p className="text-xs text-gray-300">Prompt Repetition</p>
                <p className="text-xs text-gray-500">Duplicate last user message to improve response quality (arXiv:2512.14982)</p>
              </div>
            </div>

            {/* Execution sandbox */}
            <div className="flex items-center gap-3 p-3 border-1 border-gray-700 rounded bg-gray-900/30">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={ens.execution_sandbox.enabled}
                  onChange={(e) => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: {
                      ...prev.ensembling,
                      execution_sandbox: { ...prev.ensembling.execution_sandbox, enabled: e.target.checked },
                    },
                  }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600 peer-checked:after:bg-white" />
              </label>
              <div>
                <p className="text-xs text-gray-300">Execution Sandbox</p>
                <p className="text-xs text-gray-500">Filter candidates with Python syntax errors before judging</p>
              </div>
            </div>

            {/* Metrics (if available) */}
            {ensemblingStatus && ensemblingStatus.strategy_metrics && Object.keys(ensemblingStatus.strategy_metrics).length > 0 && (
              <div className="p-3 border-1 border-gray-700 rounded bg-gray-900/30">
                <p className="text-xs font-medium text-gray-300 mb-2">Strategy Metrics</p>
                <div className="space-y-2">
                  {Object.entries(ensemblingStatus.strategy_metrics).map(([name, m]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">{name}</span>
                      <div className="flex gap-3 text-gray-500">
                        <span>{m.total_requests} requests</span>
                        <span>{Math.round(m.avg_latency_ms)}ms avg</span>
                        <span>{Math.round(m.avg_tokens)} tokens avg</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </TerminalCard>
    </div>
  );
}
