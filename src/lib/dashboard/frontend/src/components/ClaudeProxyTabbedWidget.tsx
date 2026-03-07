/**
 * ClaudeProxyTabbedWidget Component
 * Combines claude-proxy config, agent routing, and model routing into a tabbed interface
 */

import { useCallback, useEffect, useState } from "react";
import { Terminal } from "lucide-react";

import type { ExternalModel } from "./AddExternalModelModal";
import { getAgentColorClass } from "../utils/agentColors";

// ============================================================================
// Types
// ============================================================================

type RoutingMode = "passthrough" | "redirect";
type TabId = "config" | "agent" | "external" | "moa";

const PROVIDER_LABELS: Record<ExternalModel["provider"], string> = {
  openai: "OpenAI",
  azure: "Azure",
  ollama: "Ollama",
  custom: "Custom",
};

interface ModelConfig {
  alias: string;
  fullModelName: string;
  displayName: string;
  routingMode: RoutingMode;
  targetModel?: string;
  apiBase?: string;
  fallbacks?: string[];
}

interface ApiKeyEntry {
  isSet: boolean;
  isEditing: boolean;
  editValue: string;
  isSaving: boolean;
}

interface RouterSettings {
  allowedFails: number;
  cooldownTime: number;
  numRetries: number;
}

interface AgentHash {
  name: string;
  hash: string;
  description?: string;
  createdAt?: string;
}

interface AgentRoutingConfig {
  enabled: boolean;
  routes: Record<string, string>;
}

interface ModelRoutingConfig {
  enabled: boolean;
  routes: Record<string, string>;
}

interface ClaudeProxyTabbedWidgetProps {
  className?: string;
  onToastSuccess?: (message: string) => void;
  onToastError?: (message: string) => void;
  /** Callback when agent routing is toggled */
  onAgentRoutingToggle?: (enabled: boolean) => void;
  /** Current agent routing state from parent */
  agentRoutingEnabled?: boolean;
  /** External model callbacks */
  onAddExternalModel?: () => void;
  onEditExternalModel?: (model: ExternalModel) => void;
  onRemoveExternalModel?: (modelId: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const GLM_MODELS = [
  { value: "openai/glm-5", label: "GLM 5", apiBase: "https://api.z.ai/api/coding/paas/v4" },
  { value: "openai/glm-4.7", label: "GLM 4.7", apiBase: "https://api.z.ai/api/coding/paas/v4" },
  { value: "openai/glm-4.6", label: "GLM 4.6", apiBase: "https://api.z.ai/api/coding/paas/v4" },
];

const CLAUDE_MODELS = [
  { value: "anthropic/claude-opus-4-6", label: "Opus (claude-opus-4-6)" },
  { value: "anthropic/claude-sonnet-4-5-20251101", label: "Sonnet (claude-sonnet-4-5-20251101)" },
  { value: "anthropic/claude-haiku-4-5-20251001", label: "Haiku (claude-haiku-4-5-20251001)" },
];

const ALL_REDIRECT_TARGETS = [
  { group: "GLM", models: GLM_MODELS },
  { group: "Claude", models: CLAUDE_MODELS },
];

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

// ============================================================================
// Helper Functions
// ============================================================================

function getTargetModelLabel(targetModel: string): string {
  const glmMatch = GLM_MODELS.find((m) => m.value === targetModel);
  if (glmMatch) return glmMatch.label;
  const claudeMatch = CLAUDE_MODELS.find((m) => m.value === targetModel);
  if (claudeMatch) return claudeMatch.label;
  return targetModel.split("/").pop() || targetModel;
}

function getTargetModelName(targetModel: string): string {
  if (targetModel.includes("glm")) {
    const parts = targetModel.split("/");
    return parts[parts.length - 1];
  }
  if (targetModel.includes("opus")) return "opus";
  if (targetModel.includes("sonnet")) return "sonnet";
  if (targetModel.includes("haiku")) return "haiku";
  const parts = targetModel.split("/");
  return parts[parts.length - 1];
}

// ============================================================================
// Main Component
// ============================================================================

export function ClaudeProxyTabbedWidget({
  className = "",
  onToastSuccess,
  onToastError,
  onAgentRoutingToggle,
  onAddExternalModel,
  onEditExternalModel,
  onRemoveExternalModel,
}: ClaudeProxyTabbedWidgetProps): JSX.Element {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("config");

  // Config tab state
  const [isLoading, setIsLoading] = useState(true);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [apiKey, setApiKey] = useState<ApiKeyEntry>({
    isSet: false,
    isEditing: false,
    editValue: "",
    isSaving: false,
  });
  const [routingEnabled, setRoutingEnabled] = useState(false);
  const [routingEnabledLoading, setRoutingEnabledLoading] = useState(false);
  const [routerSettings, setRouterSettings] = useState<RouterSettings>({
    allowedFails: 2,
    cooldownTime: 60,
    numRetries: 3,
  });
  const [routerSettingsEditing, setRouterSettingsEditing] = useState(false);
  const [editingFallbacks, setEditingFallbacks] = useState<string | null>(null);
  const [fallbackEditValue, setFallbackEditValue] = useState("");
  const [savingFallbacks, setSavingFallbacks] = useState(false);

  // Agent routing tab state
  const [agents, setAgents] = useState<AgentHash[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentRoutingConfig>({ enabled: false, routes: {} });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isAgentLoading, setIsAgentLoading] = useState(true);
  const [isAgentToggling, setIsAgentToggling] = useState(false);

  // Model routing state (kept for config reference)
  const [modelConfig, setModelConfig] = useState<ModelRoutingConfig>({ enabled: false, routes: {} });

  // LiteLLM aliases state
  const [litellmAliases, setLitellmAliases] = useState<Array<{ modelName: string; targetModel: string }>>([]);

  // External models tab state
  const [externalModels, setExternalModels] = useState<ExternalModel[]>([]);
  const [isExternalLoading, setIsExternalLoading] = useState(true);

  // MoA (ensembling) tab state
  const [ensemblingConfig, setEnsemblingConfig] = useState<EnsemblingYamlConfig>(DEFAULT_ENSEMBLING);
  const [isEnsemblingLoading, setIsEnsemblingLoading] = useState(true);
  const [ensemblingHasChanges, setEnsemblingHasChanges] = useState(false);
  const [ensemblingSaving, setEnsemblingSaving] = useState(false);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchConfig = useCallback(async (): Promise<void> => {
    try {
      // Fetch available models with routing info from litellm_config.yaml
      const modelsResponse = await fetch("/api/claude-proxy/models");
      if (!modelsResponse.ok) throw new Error(`HTTP ${modelsResponse.status}`);
      const modelsData = (await modelsResponse.json()) as {
        models: Array<{ model: string; targetModel: string | null }>;
      };
      const modelsList = modelsData.models || [];

      // Build model configs with real routing state
      const defaultModels: ModelConfig[] = modelsList.map((entry) => {
        const model = entry.model;
        let displayName = model;

        if (model.includes("opus")) displayName = `Opus (${model})`;
        else if (model.includes("sonnet")) displayName = `Sonnet (${model})`;
        else if (model.includes("haiku")) displayName = `Haiku (${model})`;

        const isRedirected = entry.targetModel !== null;

        return {
          alias: model,
          fullModelName: model,
          displayName,
          routingMode: isRedirected ? ("redirect" as RoutingMode) : ("passthrough" as RoutingMode),
          targetModel: entry.targetModel ?? undefined,
        };
      });

      setModels(defaultModels);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching config:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchApiKey = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/api-keys");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Record<string, { set: boolean }>;
      setApiKey((prev) => ({ ...prev, isSet: data.ZAI_API_KEY?.set ?? false }));
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching API key:", error);
    }
  }, []);

  const fetchRoutingStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/routing");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { enabled?: boolean };
      setRoutingEnabled(data.enabled ?? false);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching routing status:", error);
    }
  }, []);

  const fetchRouterSettings = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/router-settings");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as RouterSettings;
      setRouterSettings({
        allowedFails: data.allowedFails ?? 2,
        cooldownTime: data.cooldownTime ?? 60,
        numRetries: data.numRetries ?? 3,
      });
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching router settings:", error);
    }
  }, []);

  const fetchAgents = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/agents");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { agents: AgentHash[] };
      setAgents(data.agents || []);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching agents:", error);
      setAgents([]);
    }
  }, []);

  const fetchAgentConfig = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/config/agent-routing");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as AgentRoutingConfig;
      setAgentConfig(data);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching agent config:", error);
    } finally {
      setIsAgentLoading(false);
    }
  }, []);

  const fetchAvailableModels = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/models");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        models: Array<{ model: string; targetModel: string | null; type: "claude" | "glm"; label?: string }>;
      };
      // Only use Claude models as source (GLM are redirect targets only)
      const claudeModels = (data.models || [])
        .filter((m) => m.type === "claude")
        .map((m) => m.model);
      setAvailableModels(claudeModels);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching models:", error);
    }
  }, []);

  const fetchLitellmAliases = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/config/litellm-aliases");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { aliases: Array<{ modelName: string; targetModel: string }> };
      setLitellmAliases(data.aliases || []);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching litellm aliases:", error);
    }
  }, []);

  const fetchExternalModels = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/external-models");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ExternalModel[];
      setExternalModels(data);
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching external models:", error);
    } finally {
      setIsExternalLoading(false);
    }
  }, []);

  const fetchEnsemblingConfig = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/ensembling");
      if (response.ok) {
        const data = (await response.json()) as EnsemblingYamlConfig;
        setEnsemblingConfig(data);
      }
    } catch (error) {
      console.error("[claude-proxy-tabbed] Error fetching ensembling config:", error);
    } finally {
      setIsEnsemblingLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
    void fetchApiKey();
    void fetchRoutingStatus();
    void fetchRouterSettings();
    void fetchAgents();
    void fetchAgentConfig();
    void fetchAvailableModels();
    void fetchLitellmAliases();
    void fetchExternalModels();
    void fetchEnsemblingConfig();
  }, [fetchConfig, fetchApiKey, fetchRoutingStatus, fetchRouterSettings, fetchAgents, fetchAgentConfig, fetchAvailableModels, fetchLitellmAliases, fetchExternalModels, fetchEnsemblingConfig]);

  // ============================================================================
  // Config Tab Handlers
  // ============================================================================

  async function handleRoutingToggle(): Promise<void> {
    setRoutingEnabledLoading(true);
    try {
      const response = await fetch("/api/claude-proxy/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !routingEnabled }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setRoutingEnabled(!routingEnabled);
      onToastSuccess?.(!routingEnabled
        ? "claude-proxy routing enabled (restart Claude Code)"
        : "claude-proxy routing disabled (restart Claude Code)");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to toggle routing";
      onToastError?.(message);
    } finally {
      setRoutingEnabledLoading(false);
    }
  }

  async function handleSaveRouterSettings(): Promise<void> {
    try {
      const response = await fetch("/api/claude-proxy/router-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(routerSettings),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setRouterSettingsEditing(false);
      onToastSuccess?.("Router settings saved (rebuild to apply)");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save router settings";
      onToastError?.(message);
    }
  }

  function startEditingFallbacks(alias: string, currentFallbacks: string[]): void {
    setEditingFallbacks(alias);
    setFallbackEditValue(currentFallbacks.join(", "));
  }

  function cancelEditingFallbacks(): void {
    setEditingFallbacks(null);
    setFallbackEditValue("");
  }

  async function handleSaveFallbacks(alias: string): Promise<void> {
    setSavingFallbacks(true);
    try {
      const fallbacks = fallbackEditValue.split(",").map((f) => f.trim()).filter((f) => f.length > 0);
      const response = await fetch("/api/claude-proxy/fallbacks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAlias: alias, fallbacks }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setModels((prev) => prev.map((model) => model.alias === alias ? { ...model, fallbacks } : model));
      setEditingFallbacks(null);
      setFallbackEditValue("");
      onToastSuccess?.(`Fallbacks saved for ${alias}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save fallbacks";
      onToastError?.(message);
    } finally {
      setSavingFallbacks(false);
    }
  }

  function handleModeChange(alias: string, newMode: RoutingMode): void {
    setModels((prev) => prev.map((model) =>
      model.alias === alias
        ? { ...model, routingMode: newMode, targetModel: newMode === "passthrough" ? undefined : model.targetModel }
        : model
    ));
    setHasChanges(true);
  }

  function handleTargetChange(alias: string, targetModel: string): void {
    const glmModel = GLM_MODELS.find((m) => m.value === targetModel);
    const apiBase = glmModel?.apiBase;
    setModels((prev) => prev.map((model) => model.alias === alias ? { ...model, targetModel, apiBase } : model));
    setHasChanges(true);
  }

  async function handleRebuild(): Promise<void> {
    setIsRebuilding(true);
    try {
      const response = await fetch("/api/claude-proxy/rebuild", { method: "POST" });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      onToastSuccess?.("claude-proxy rebuilt and restarted");
      setTimeout(() => void fetchConfig(), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rebuild";
      onToastError?.(message);
    } finally {
      setIsRebuilding(false);
    }
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      const rules = models
        .filter((m) => m.routingMode === "redirect" && m.targetModel)
        .map((m) => ({
          sourcePattern: m.alias,
          targetAlias: getTargetModelName(m.targetModel!),
          enabled: true,
        }));
      const rulesResponse = await fetch("/api/claude-proxy/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      if (!rulesResponse.ok) {
        const data = (await rulesResponse.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${rulesResponse.status}`);
      }
      setHasChanges(false);
      onToastSuccess?.("Model routing saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      onToastError?.(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveApiKey(): Promise<void> {
    setApiKey((prev) => ({ ...prev, isSaving: true }));
    try {
      const response = await fetch("/api/claude-proxy/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envVar: "ZAI_API_KEY", apiKey: apiKey.editValue }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setApiKey({ isSet: true, isEditing: false, editValue: "", isSaving: false });
      onToastSuccess?.("Z.ai API key saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      onToastError?.(message);
      setApiKey((prev) => ({ ...prev, isSaving: false }));
    }
  }

  async function handleDeleteApiKey(): Promise<void> {
    if (!confirm("Remove Z.ai API key?")) return;
    try {
      const response = await fetch("/api/claude-proxy/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envVar: "ZAI_API_KEY" }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setApiKey({ isSet: false, isEditing: false, editValue: "", isSaving: false });
      onToastSuccess?.("Z.ai API key removed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete";
      onToastError?.(message);
    }
  }

  // ============================================================================
  // Agent Routing Tab Handlers
  // ============================================================================

  async function handleToggleAgentRouting(): Promise<void> {
    const newEnabled = !agentConfig.enabled;
    setIsAgentToggling(true);
    try {
      const response = await fetch("/api/claude-proxy/config/agent-routing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setAgentConfig((prev) => ({ ...prev, enabled: newEnabled }));
      onToastSuccess?.(newEnabled ? "Agent routing enabled" : "Agent routing disabled");
      onAgentRoutingToggle?.(newEnabled);
      await fetch("/api/claude-proxy/reload", { method: "POST" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to toggle";
      onToastError?.(message);
    } finally {
      setIsAgentToggling(false);
    }
  }

  async function handleAgentModelChange(agentHash: string, modelId: string): Promise<void> {
    try {
      const response = await fetch("/api/claude-proxy/config/agent-routing/route", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentHash, modelId }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setAgentConfig((prev) => ({ ...prev, routes: { ...prev.routes, [agentHash]: modelId } }));
      onToastSuccess?.("Route updated");
      await fetch("/api/claude-proxy/reload", { method: "POST" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update route";
      onToastError?.(message);
    }
  }

  // ============================================================================
  // MoA (Ensembling) Tab Handlers
  // ============================================================================

  function updateEnsembling(updater: (prev: EnsemblingYamlConfig) => EnsemblingYamlConfig): void {
    setEnsemblingConfig(updater);
    setEnsemblingHasChanges(true);
  }

  async function handleEnsemblingSave(): Promise<void> {
    setEnsemblingSaving(true);
    try {
      const response = await fetch("/api/claude-proxy/ensembling", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ensemblingConfig),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setEnsemblingHasChanges(false);
      onToastSuccess?.("MoA config saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save ensembling config";
      onToastError?.(message);
    } finally {
      setEnsemblingSaving(false);
    }
  }

  function handleEnsemblingReset(): void {
    void fetchEnsemblingConfig();
    setEnsemblingHasChanges(false);
  }

  // Shorthand accessors for ensembling config
  const ens = ensemblingConfig.ensembling;
  const activeStrategy = ens.default_strategy as "self_moa" | "multi_model" | "hybrid";
  const selfMoa = ens.strategies.self_moa;
  const multiModel = ens.strategies.multi_model;
  const hybrid = ens.strategies.hybrid;

  // ============================================================================
  // Render
  // ============================================================================

  const isAnyLoading = isLoading || isAgentLoading || isEnsemblingLoading;

  if (isAnyLoading) {
    return (
      <div className={`font-mono relative isolate flex flex-col min-h-0 z-0 ${className}`}>
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <Terminal className="w-3 h-3 sm:w-4 sm:h-4 text-red-400" />
          <span className="text-gray-400 text-xs sm:text-sm">cat</span>
          <span className="text-red-300 text-xs sm:text-sm font-mono">~/.claude-workflow/claude-proxy</span>
        </div>
        <div className="border border-red-800 rounded bg-gray-900/80 flex flex-col flex-1 min-h-0 relative z-[1] animate-pulse">
          {/* Skeleton header with tab buttons */}
          <div className="bg-gray-900 px-3 sm:px-4 py-1.5 border-b border-red-800 flex items-center justify-between gap-2 rounded-t shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-7 w-16 bg-gray-800/50 rounded-md" />
              <div className="h-7 w-14 bg-gray-800/20 rounded-md" />
              <div className="h-7 w-18 bg-gray-800/20 rounded-md" />
              <div className="h-7 w-12 bg-gray-800/20 rounded-md" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-5 w-9 bg-gray-800/35 rounded-full" />
              <div className="h-7 w-16 bg-gray-800/20 rounded-md" />
            </div>
          </div>
          {/* Skeleton model routing rows */}
          <div className="flex-1 min-h-0 text-sm [&>*+*]:border-t [&>*+*]:border-red-800/50 flex flex-col overflow-hidden">
            <div className="px-4 py-2 bg-gray-900/50 shrink-0">
              <div className="h-3 w-24 bg-gray-800/35 rounded" />
            </div>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="h-4 bg-gray-800/50 rounded" style={{ width: `${100 + (i % 3) * 40}px` }} />
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-20 bg-gray-800/20 rounded" />
                    <div className="h-6 w-16 bg-gray-800/20 rounded" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-16 bg-gray-800/20 rounded" />
                  <div className="h-3 w-10 bg-gray-800/20 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`font-mono relative isolate flex flex-col min-h-0 z-0 ${className}`}>
      {/* Terminal prompt line */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <Terminal className="w-3 h-3 sm:w-4 sm:h-4 text-red-400" />
        <span className="text-gray-400 text-xs sm:text-sm">cat</span>
        <span className="text-red-300 text-xs sm:text-sm font-mono">~/.claude-workflow/claude-proxy</span>
      </div>

      {/* Bordered container */}
      <div className="border border-red-800 rounded bg-gray-900/80 flex flex-col flex-1 min-h-0 relative z-[1]">
        {/* Header with tabs and global toggle */}
        <div className="bg-gray-900 px-1.5 sm:px-4 py-1.5 border-b border-red-800 flex items-center justify-between gap-1 sm:gap-2 rounded-t shrink-0 relative z-10 isolate overflow-x-auto">
          {/* Tab buttons */}
          <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("config")}
              className={`h-7 px-1.5 sm:px-3 text-[10px] sm:text-xs rounded-md transition-colors border-1 border-red-800 whitespace-nowrap ${
                activeTab === "config"
                  ? "bg-red-600 text-white"
                  : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
              }`}
            >
              Config
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("agent")}
              className={`h-7 px-1.5 sm:px-3 text-[10px] sm:text-xs rounded-md transition-colors border-1 border-red-800 whitespace-nowrap ${
                activeTab === "agent"
                  ? "bg-red-600 text-white"
                  : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
              }`}
            >
              Agent
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("external")}
              className={`h-7 px-1.5 sm:px-3 text-[10px] sm:text-xs rounded-md transition-colors border-1 border-red-800 whitespace-nowrap ${
                activeTab === "external"
                  ? "bg-red-600 text-white"
                  : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
              }`}
            >
              Ext
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("moa")}
              className={`h-7 px-1.5 sm:px-3 text-[10px] sm:text-xs rounded-md transition-colors border-1 border-red-800 whitespace-nowrap ${
                activeTab === "moa"
                  ? "bg-red-600 text-white"
                  : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
              }`}
            >
              MoA
            </button>
          </div>

          {/* Header actions based on active tab */}
          <div className="flex items-center gap-2">
            {activeTab === "config" && (
              <>
                <button
                  onClick={() => void handleRoutingToggle()}
                  disabled={routingEnabledLoading}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    routingEnabledLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  } ${routingEnabled ? "bg-green-600" : "bg-red-600"}`}
                  type="button"
                  role="switch"
                  aria-checked={routingEnabled}
                  title={routingEnabled ? "Disable proxy routing" : "Enable proxy routing"}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    routingEnabled ? "translate-x-5" : "translate-x-1"
                  }`} />
                </button>
                {hasChanges && (
                  <button
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                    className="h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
                    type="button"
                  >
                    {isSaving ? "..." : "Save"}
                  </button>
                )}
                <button
                  onClick={() => void handleRebuild()}
                  disabled={isRebuilding || isSaving}
                  className={
                    isRebuilding || isSaving
                      ? "h-7 px-2 text-xs bg-red-700 border-1 border-red-800 text-white rounded-md cursor-not-allowed opacity-70"
                      : "h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
                  }
                  type="button"
                  title="Rebuild container"
                >
                  {isRebuilding ? "..." : <><span className="sm:hidden">RB</span><span className="hidden sm:inline">Rebuild</span></>}
                </button>
              </>
            )}
            {activeTab === "agent" && (
              <>
                <button
                  type="button"
                  role="switch"
                  aria-checked={agentConfig.enabled}
                  onClick={() => void handleToggleAgentRouting()}
                  disabled={isAgentToggling}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                    agentConfig.enabled ? "bg-green-600" : "bg-red-800"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    agentConfig.enabled ? "translate-x-5" : "translate-x-1"
                  }`} />
                </button>
              </>
            )}
            {activeTab === "external" && onAddExternalModel && (
              <button
                onClick={onAddExternalModel}
                className="h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
                type="button"
              >
                <span className="sm:hidden">+ Add</span><span className="hidden sm:inline">Add Model</span>
              </button>
            )}
            {activeTab === "moa" && (
              <>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ens.enabled}
                  onClick={() => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: { ...prev.ensembling, enabled: !prev.ensembling.enabled },
                  }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                    ens.enabled ? "bg-green-600" : "bg-red-800"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    ens.enabled ? "translate-x-5" : "translate-x-1"
                  }`} />
                </button>
                {ensemblingHasChanges && (
                  <button
                    onClick={() => void handleEnsemblingSave()}
                    disabled={ensemblingSaving}
                    className="h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors"
                    type="button"
                  >
                    {ensemblingSaving ? "..." : "Save"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-y-auto text-sm text-gray-300">
          {/* Config Tab */}
          {activeTab === "config" && (
            <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50">
              <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Model Routing</span>
              </div>
              {models.map((model) => {
                const isRedirect = model.routingMode === "redirect";
                const fallbacksDisplay = model.fallbacks && model.fallbacks.length > 0 ? model.fallbacks.join(" -> ") : "None";
                return (
                  <div key={model.alias} className="px-4 py-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-white text-sm font-medium capitalize shrink-0">{model.displayName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isRedirect && model.targetModel ? (
                          <span className="text-xs text-amber-400">
                            {`→ ${model.targetModel}`}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">Passthrough</span>
                        )}
                        <button
                          onClick={() => handleModeChange(model.alias, isRedirect ? "passthrough" : "redirect")}
                          className="h-6 px-2 text-xs rounded border-1 border-red-800 bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900 transition-colors"
                          type="button"
                        >
                          {isRedirect ? "Redirect" : "Direct"}
                        </button>
                        {isRedirect && !model.targetModel && (
                          <select
                            value={model.targetModel || ""}
                            onChange={(e) => handleTargetChange(model.alias, e.target.value)}
                            className="h-6 pl-2 pr-4 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none"
                          >
                            <option value="">Select...</option>
                            {ALL_REDIRECT_TARGETS.map((group) => (
                              <optgroup key={group.group} label={group.group}>
                                {group.models.map((m) => (
                                  <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-0">
                      <span className="text-xs text-gray-500 shrink-0">Fallbacks:</span>
                      {editingFallbacks === model.alias ? (
                        <>
                          <input
                            type="text"
                            value={fallbackEditValue}
                            onChange={(e) => setFallbackEditValue(e.target.value)}
                            placeholder="e.g. glm-4.7, glm-4.6"
                            className="flex-1 h-5 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white font-mono focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => void handleSaveFallbacks(model.alias)}
                            disabled={savingFallbacks}
                            className="h-5 px-2 text-xs bg-red-700 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
                            type="button"
                          >
                            {savingFallbacks ? "..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEditingFallbacks}
                            className="h-5 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                            type="button"
                          >
                            X
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-gray-400 font-mono flex-1">{fallbacksDisplay}</span>
                          <button
                            onClick={() => startEditingFallbacks(model.alias, model.fallbacks || [])}
                            className="h-5 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors opacity-60 hover:opacity-100"
                            type="button"
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Active Redirects (LiteLLM Aliases) */}
              {litellmAliases.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Active Redirects</span>
                  </div>
                  {litellmAliases.map((alias) => (
                    <div key={`${alias.modelName}-${alias.targetModel}`} className="px-4 py-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-gray-300 font-mono text-sm truncate">{alias.modelName}</span>
                        <span className="text-amber-500 shrink-0">→</span>
                        <span className="text-amber-400 font-mono text-sm truncate">{alias.targetModel}</span>
                      </div>
                      <span className="text-xs text-gray-600 shrink-0">active</span>
                    </div>
                  ))}
                </>
              )}

              <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Failover Settings</span>
              </div>
              {routerSettingsEditing ? (
                <div className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm">Allowed Failures</span>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={routerSettings.allowedFails}
                      onChange={(e) => setRouterSettings((prev) => ({ ...prev, allowedFails: Number(e.target.value) || 2 }))}
                      className="w-16 h-6 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm">Cooldown (s)</span>
                    <input
                      type="number"
                      min="10"
                      max="600"
                      value={routerSettings.cooldownTime}
                      onChange={(e) => setRouterSettings((prev) => ({ ...prev, cooldownTime: Number(e.target.value) || 60 }))}
                      className="w-16 h-6 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm">Num Retries</span>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={routerSettings.numRetries}
                      onChange={(e) => setRouterSettings((prev) => ({ ...prev, numRetries: Number(e.target.value) || 3 }))}
                      className="w-16 h-6 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => void handleSaveRouterSettings()}
                      className="flex-1 h-6 px-2 text-xs bg-red-700 text-white rounded hover:bg-red-600 transition-colors"
                      type="button"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setRouterSettingsEditing(false)}
                      className="flex-1 h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-white font-medium">Failover Configuration</span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      {routerSettings.allowedFails} fails {"->"} {routerSettings.cooldownTime}s cooldown, {routerSettings.numRetries} retries
                    </span>
                  </div>
                  <button
                    onClick={() => setRouterSettingsEditing(true)}
                    className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                    type="button"
                  >
                    Edit
                  </button>
                </div>
              )}

              <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                <span className="text-xs text-gray-500 uppercase tracking-wider">External Models</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-white font-medium">z.ai API Key</span>
                  <span className="text-xs text-gray-500 mt-0.5">Required for GLM redirects</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {apiKey.isEditing ? (
                    <>
                      <input
                        type="password"
                        value={apiKey.editValue}
                        onChange={(e) => setApiKey((prev) => ({ ...prev, editValue: e.target.value }))}
                        placeholder="Enter API key..."
                        className="h-6 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none w-28"
                        autoFocus
                      />
                      <button
                        disabled={apiKey.isSaving || apiKey.editValue.trim() === ""}
                        onClick={() => void handleSaveApiKey()}
                        className="h-6 px-2 text-xs bg-red-700 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
                        type="button"
                      >
                        {apiKey.isSaving ? "..." : "Save"}
                      </button>
                      <button
                        onClick={() => setApiKey((prev) => ({ ...prev, isEditing: false, editValue: "" }))}
                        className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                        type="button"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setApiKey((prev) => ({ ...prev, isEditing: true }))}
                        className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                        type="button"
                      >
                        {apiKey.isSet ? "Update" : "Set"}
                      </button>
                      {apiKey.isSet && (
                        <button
                          onClick={() => void handleDeleteApiKey()}
                          className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-red-400 rounded hover:bg-red-800 hover:text-red-300 transition-colors"
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Agent Routing Tab */}
          {activeTab === "agent" && (
            <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50 flex flex-col flex-1 h-full">
              {agents.length > 0 ? (
                <>
                  <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">
                      Registered Agents ({agents.length})
                    </span>
                  </div>
                  {agents.map((agent) => (
                    <div key={agent.hash} className="px-4 py-2 flex items-center justify-between gap-3">
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-sm ${getAgentColorClass(agent.name)}`}>{agent.name}</span>
                      </div>
                      <select
                        value={agentConfig.routes[agent.hash] || ""}
                        onChange={(e) => void handleAgentModelChange(agent.hash, e.target.value)}
                        disabled={!agentConfig.enabled}
                        className="h-6 px-2 text-xs bg-gray-900 border-1 border-red-800 text-gray-300 rounded hover:border-red-700 focus:outline-none disabled:opacity-50 min-w-0 max-w-[150px]"
                      >
                        <option value="">Default model</option>
                        {availableModels
                          .filter((model) => model !== agentConfig.routes[agent.hash])
                          .map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                      </select>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 text-sm">No agents registered</p>
                </div>
              )}
            </div>
          )}

          {/* External Models Tab */}
          {activeTab === "external" && (
            <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50 flex flex-col flex-1 h-full">
              {isExternalLoading ? (
                <div className="animate-pulse flex flex-col flex-1 h-full overflow-hidden">
                  <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                    <div className="h-3 w-32 bg-gray-800/35 rounded" />
                  </div>
                  {Array.from({ length: 15 }).map((_, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between gap-3 border-t border-red-800/50">
                      <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 bg-gray-800/50 rounded" style={{ width: `${80 + (i % 2) * 30}px` }} />
                          <div className="h-4 w-14 bg-gray-800/35 rounded" />
                        </div>
                        <div className="h-3 bg-gray-800/20 rounded" style={{ width: `${120 + (i % 2) * 40}px` }} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="h-6 w-10 bg-gray-800/20 rounded" />
                        <div className="h-6 w-14 bg-gray-800/20 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : externalModels.length > 0 ? (
                <>
                  <div className="px-4 py-2 bg-gray-900/50 shrink-0">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">
                      External Models ({externalModels.length})
                    </span>
                  </div>
                  {externalModels.map((model) => (
                    <div key={model.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{model.name}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                            {PROVIDER_LABELS[model.provider]}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 mt-0.5 font-mono truncate">
                          {model.modelId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {onEditExternalModel && (
                          <button
                            onClick={() => onEditExternalModel(model)}
                            className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                            type="button"
                          >
                            Edit
                          </button>
                        )}
                        {onRemoveExternalModel && (
                          <button
                            onClick={() => onRemoveExternalModel(model.id)}
                            className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-red-400 rounded hover:bg-red-800 hover:text-red-300 transition-colors"
                            type="button"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 text-sm">No external models configured</p>
                </div>
              )}
            </div>
          )}

          {/* MoA (Ensembling) Tab */}
          {activeTab === "moa" && (
            <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50">
              {/* Strategy selector */}
              <div className="px-4 py-2 bg-gray-900/50">
                <span className="text-xs text-gray-500 uppercase tracking-wide">Strategy</span>
              </div>
              <div className="px-4 py-2 flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">Default Strategy</span>
                <select
                  value={ens.default_strategy}
                  onChange={(e) => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: { ...prev.ensembling, default_strategy: e.target.value },
                  }))}
                  className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                >
                  {STRATEGY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="px-4 py-1.5">
                <span className="text-xs text-gray-600">
                  {STRATEGY_OPTIONS.find(s => s.value === activeStrategy)?.description}
                  {" — ~"}{activeStrategy === "hybrid" ? "4.4" : "3.3"}x token cost
                </span>
              </div>

              {/* Self-MoA Settings */}
              {activeStrategy === "self_moa" && (
                <>
                  <div className="px-4 py-2 bg-gray-900/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Self-MoA Settings</span>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Candidates</span>
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
                      className="h-6 w-16 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Judge Mode</span>
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
                      className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                    >
                      {JUDGE_MODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Temperatures</span>
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
                      className="h-6 w-32 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Consensus Threshold</span>
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
                      className="h-6 w-16 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Position Bias Mitigation</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={selfMoa.position_bias_mitigation}
                      onClick={() => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            self_moa: { ...prev.ensembling.strategies.self_moa, position_bias_mitigation: !prev.ensembling.strategies.self_moa.position_bias_mitigation },
                          },
                        },
                      }))}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                        selfMoa.position_bias_mitigation ? "bg-green-600" : "bg-red-800"
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        selfMoa.position_bias_mitigation ? "translate-x-5" : "translate-x-1"
                      }`} />
                    </button>
                  </div>
                </>
              )}

              {/* Multi-Model Settings */}
              {activeStrategy === "multi_model" && (
                <>
                  <div className="px-4 py-2 bg-gray-900/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Multi-Model Settings</span>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Judge Model</span>
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
                      className="h-6 w-48 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Judge Provider</span>
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
                      className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="local">Local</option>
                    </select>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Judge Mode</span>
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
                      className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                    >
                      {JUDGE_MODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Consensus Threshold</span>
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
                      className="h-6 w-16 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Position Bias Mitigation</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={multiModel.position_bias_mitigation}
                      onClick={() => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            multi_model: { ...prev.ensembling.strategies.multi_model, position_bias_mitigation: !prev.ensembling.strategies.multi_model.position_bias_mitigation },
                          },
                        },
                      }))}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                        multiModel.position_bias_mitigation ? "bg-green-600" : "bg-red-800"
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        multiModel.position_bias_mitigation ? "translate-x-5" : "translate-x-1"
                      }`} />
                    </button>
                  </div>
                  {/* Model Candidates */}
                  <div className="px-4 py-2 bg-gray-900/50 flex items-center justify-between">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Model Candidates</span>
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
                  {multiModel.candidates.length === 0 ? (
                    <div className="px-4 py-2">
                      <span className="text-xs text-gray-600 italic">No candidates configured</span>
                    </div>
                  ) : (
                    multiModel.candidates.map((cand, idx) => (
                      <div key={idx} className="px-4 py-2 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="model"
                          value={cand.model}
                          onChange={(e) => updateEnsembling(prev => {
                            const newCandidates = [...prev.ensembling.strategies.multi_model.candidates];
                            newCandidates[idx] = { ...newCandidates[idx], model: e.target.value };
                            return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, multi_model: { ...prev.ensembling.strategies.multi_model, candidates: newCandidates } } } };
                          })}
                          className="h-6 flex-1 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                        />
                        <select
                          value={cand.provider}
                          onChange={(e) => updateEnsembling(prev => {
                            const newCandidates = [...prev.ensembling.strategies.multi_model.candidates];
                            newCandidates[idx] = { ...newCandidates[idx], provider: e.target.value };
                            return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, multi_model: { ...prev.ensembling.strategies.multi_model, candidates: newCandidates } } } };
                          })}
                          className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
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
                    ))
                  )}
                </>
              )}

              {/* Hybrid Settings */}
              {activeStrategy === "hybrid" && (
                <>
                  <div className="px-4 py-2 bg-gray-900/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Hybrid Settings</span>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Self-MoA Candidates</span>
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
                      className="h-6 w-16 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Temperatures</span>
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
                      className="h-6 w-32 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Judge Model</span>
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
                      className="h-6 w-48 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white text-right focus:outline-none"
                    />
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Judge Mode</span>
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
                      className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                    >
                      {JUDGE_MODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Position Bias Mitigation</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hybrid.position_bias_mitigation}
                      onClick={() => updateEnsembling(prev => ({
                        ...prev,
                        ensembling: {
                          ...prev.ensembling,
                          strategies: {
                            ...prev.ensembling.strategies,
                            hybrid: { ...prev.ensembling.strategies.hybrid, position_bias_mitigation: !prev.ensembling.strategies.hybrid.position_bias_mitigation },
                          },
                        },
                      }))}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                        hybrid.position_bias_mitigation ? "bg-green-600" : "bg-red-800"
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        hybrid.position_bias_mitigation ? "translate-x-5" : "translate-x-1"
                      }`} />
                    </button>
                  </div>
                  {/* Extra Models */}
                  <div className="px-4 py-2 bg-gray-900/50 flex items-center justify-between">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Extra Models</span>
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
                  {hybrid.extra_models.length === 0 ? (
                    <div className="px-4 py-2">
                      <span className="text-xs text-gray-600 italic">No extra models configured</span>
                    </div>
                  ) : (
                    hybrid.extra_models.map((extra, idx) => (
                      <div key={idx} className="px-4 py-2 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="model"
                          value={extra.model}
                          onChange={(e) => updateEnsembling(prev => {
                            const newExtras = [...prev.ensembling.strategies.hybrid.extra_models];
                            newExtras[idx] = { ...newExtras[idx], model: e.target.value };
                            return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, hybrid: { ...prev.ensembling.strategies.hybrid, extra_models: newExtras } } } };
                          })}
                          className="h-6 flex-1 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
                        />
                        <select
                          value={extra.provider}
                          onChange={(e) => updateEnsembling(prev => {
                            const newExtras = [...prev.ensembling.strategies.hybrid.extra_models];
                            newExtras[idx] = { ...newExtras[idx], provider: e.target.value };
                            return { ...prev, ensembling: { ...prev.ensembling, strategies: { ...prev.ensembling.strategies, hybrid: { ...prev.ensembling.strategies.hybrid, extra_models: newExtras } } } };
                          })}
                          className="h-6 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
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
                    ))
                  )}
                </>
              )}

              {/* Options */}
              <div className="px-4 py-2 bg-gray-900/50">
                <span className="text-xs text-gray-500 uppercase tracking-wide">Options</span>
              </div>
              <div className="px-4 py-2 flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400">Prompt Repetition</span>
                  <span className="text-xs text-gray-600">Duplicate last user message (arXiv:2512.14982)</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ens.prompt_repetition.enabled}
                  onClick={() => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: {
                      ...prev.ensembling,
                      prompt_repetition: { ...prev.ensembling.prompt_repetition, enabled: !prev.ensembling.prompt_repetition.enabled },
                    },
                  }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                    ens.prompt_repetition.enabled ? "bg-green-600" : "bg-red-800"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    ens.prompt_repetition.enabled ? "translate-x-5" : "translate-x-1"
                  }`} />
                </button>
              </div>
              <div className="px-4 py-2 flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400">Execution Sandbox</span>
                  <span className="text-xs text-gray-600">Filter candidates with syntax errors before judging</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ens.execution_sandbox.enabled}
                  onClick={() => updateEnsembling(prev => ({
                    ...prev,
                    ensembling: {
                      ...prev.ensembling,
                      execution_sandbox: { ...prev.ensembling.execution_sandbox, enabled: !prev.ensembling.execution_sandbox.enabled },
                    },
                  }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                    ens.execution_sandbox.enabled ? "bg-green-600" : "bg-red-800"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    ens.execution_sandbox.enabled ? "translate-x-5" : "translate-x-1"
                  }`} />
                </button>
              </div>

              {/* Agent Overrides */}
              <div className="px-4 py-2 bg-gray-900/50 flex items-center justify-between">
                <span className="text-xs text-gray-500 uppercase tracking-wide">Agent Overrides</span>
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
                  + Add
                </button>
              </div>
              {Object.keys(ens.agent_overrides).length === 0 ? (
                <div className="px-4 py-2">
                  <span className="text-xs text-gray-600 italic">No agent overrides — all use default strategy</span>
                </div>
              ) : (
                Object.entries(ens.agent_overrides).map(([prefix, override]) => (
                  <div key={prefix} className="px-4 py-2 flex items-center gap-2">
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
                      className="h-6 flex-1 px-2 text-xs bg-gray-800 border-1 border-red-800 rounded text-white focus:outline-none"
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
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
