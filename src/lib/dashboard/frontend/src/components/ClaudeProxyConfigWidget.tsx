/**
 * ClaudeProxyConfigWidget Component
 * Compact configuration widget for claude-proxy model routing and API keys
 * Designed to fit in dashboard grid layout
 */

import { useState, useEffect, useCallback } from "react";
import { TerminalCard } from "./TerminalCard";

/**
 * Available routing modes for a model
 */
type RoutingMode = "passthrough" | "redirect";

/**
 * Model configuration entry
 */
interface ModelConfig {
  alias: string;
  fullModelName: string;
  displayName: string;
  routingMode: RoutingMode;
  targetModel?: string;
  apiBase?: string;
  fallbacks?: string[];
}

/**
 * API key entry for Z.ai
 */
interface ApiKeyEntry {
  isSet: boolean;
  isEditing: boolean;
  editValue: string;
  isSaving: boolean;
}

/**
 * Router settings for fallback configuration
 */
interface RouterSettings {
  allowedFails: number;
  cooldownTime: number;
  numRetries: number;
}

/**
 * Available GLM models for redirect
 */
const GLM_MODELS = [
  { value: "openai/glm-4.7", label: "GLM 4.7", apiBase: "https://api.z.ai/api/coding/paas/v4" },
  { value: "openai/glm-4.6", label: "GLM 4.6", apiBase: "https://api.z.ai/api/coding/paas/v4" },
];

/**
 * Available Claude models for redirect
 */
const CLAUDE_MODELS = [
  { value: "anthropic/claude-opus-4-6", label: "Opus (claude-opus-4-6)" },
  { value: "anthropic/claude-sonnet-4-5-20251101", label: "Sonnet (claude-sonnet-4-5-20251101)" },
  { value: "anthropic/claude-haiku-4-5-20251001", label: "Haiku (claude-haiku-4-5-20251001)" },
];

/**
 * All redirect targets grouped
 */
const ALL_REDIRECT_TARGETS = [
  { group: "GLM", models: GLM_MODELS },
  { group: "Claude", models: CLAUDE_MODELS },
];

interface ClaudeProxyConfigWidgetProps {
  className?: string;
  onToastSuccess?: (message: string) => void;
  onToastError?: (message: string) => void;
}

/**
 * Get display name for a target model value
 */
function getTargetModelLabel(targetModel: string): string {
  const glmMatch = GLM_MODELS.find((m) => m.value === targetModel);
  if (glmMatch) return glmMatch.label;
  const claudeMatch = CLAUDE_MODELS.find((m) => m.value === targetModel);
  if (claudeMatch) return claudeMatch.label;
  return targetModel.split("/").pop() || targetModel;
}

export function ClaudeProxyConfigWidget({
  className = "",
  onToastSuccess,
  onToastError,
}: ClaudeProxyConfigWidgetProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // Z.ai API key state
  const [apiKey, setApiKey] = useState<ApiKeyEntry>({
    isSet: false,
    isEditing: false,
    editValue: "",
    isSaving: false,
  });

  // Global routing toggle state
  const [routingEnabled, setRoutingEnabled] = useState(false);
  const [routingEnabledLoading, setRoutingEnabledLoading] = useState(false);

  // Router settings state for fallback configuration
  const [routerSettings, setRouterSettings] = useState<RouterSettings>({
    allowedFails: 2,
    cooldownTime: 60,
    numRetries: 3,
  });
  const [routerSettingsEditing, setRouterSettingsEditing] = useState(false);

  // Per-model fallback editing state
  const [editingFallbacks, setEditingFallbacks] = useState<string | null>(null);
  const [fallbackEditValue, setFallbackEditValue] = useState("");
  const [savingFallbacks, setSavingFallbacks] = useState(false);

  /**
   * Fetch current claude-proxy configuration
   */
  const fetchConfig = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/config");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { models: ModelConfig[] };
      setModels(data.models || []);
    } catch (error) {
      console.error("[claude-proxy-config] Error fetching config:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Fetch Z.ai API key status
   */
  const fetchApiKey = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/api-keys");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as Record<string, { set: boolean }>;
      setApiKey((prev) => ({
        ...prev,
        isSet: data.ZAI_API_KEY?.set ?? false,
      }));
    } catch (error) {
      console.error("[claude-proxy-config] Error fetching API key:", error);
    }
  }, []);

  /**
   * Fetch claude-proxy routing enable/disable status
   */
  const fetchRoutingStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/routing");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { enabled?: boolean };
      setRoutingEnabled(data.enabled ?? false);
    } catch (error) {
      console.error("[claude-proxy-config] Error fetching routing status:", error);
    }
  }, []);

  /**
   * Fetch router settings from backend
   */
  const fetchRouterSettings = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/claude-proxy/router-settings");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json() as RouterSettings;
      setRouterSettings({
        allowedFails: data.allowedFails ?? 2,
        cooldownTime: data.cooldownTime ?? 60,
        numRetries: data.numRetries ?? 3,
      });
    } catch (error) {
      console.error("[claude-proxy-config] Error fetching router settings:", error);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
    void fetchApiKey();
    void fetchRoutingStatus();
    void fetchRouterSettings();
  }, [fetchConfig, fetchApiKey, fetchRoutingStatus, fetchRouterSettings]);

  /**
   * Toggle claude-proxy routing on/off
   */
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
      onToastSuccess?.(
        !routingEnabled
          ? "claude-proxy routing enabled (restart Claude Code for changes)"
          : "claude-proxy routing disabled (restart Claude Code for changes)"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to toggle routing";
      onToastError?.(message);
    } finally {
      setRoutingEnabledLoading(false);
    }
  }

  /**
   * Save router settings for fallback configuration
   */
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
      onToastSuccess?.("Router settings saved (rebuild container to apply)");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save router settings";
      onToastError?.(message);
    }
  }

  /**
   * Start editing fallbacks for a model
   */
  function startEditingFallbacks(alias: string, currentFallbacks: string[]): void {
    setEditingFallbacks(alias);
    setFallbackEditValue(currentFallbacks.join(", "));
  }

  /**
   * Cancel editing fallbacks
   */
  function cancelEditingFallbacks(): void {
    setEditingFallbacks(null);
    setFallbackEditValue("");
  }

  /**
   * Save fallbacks for a model
   */
  async function handleSaveFallbacks(alias: string): Promise<void> {
    setSavingFallbacks(true);
    try {
      // Parse comma-separated fallbacks
      const fallbacks = fallbackEditValue
        .split(",")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      const response = await fetch("/api/claude-proxy/fallbacks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAlias: alias, fallbacks }),
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      // Update local state
      setModels((prev) =>
        prev.map((model) =>
          model.alias === alias ? { ...model, fallbacks } : model
        )
      );

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

  /**
   * Handle routing mode change for a model
   */
  function handleModeChange(alias: string, newMode: RoutingMode): void {
    setModels((prev) =>
      prev.map((model) =>
        model.alias === alias
          ? {
              ...model,
              routingMode: newMode,
              // Clear target when switching to passthrough
              targetModel: newMode === "passthrough" ? undefined : model.targetModel,
            }
          : model
      )
    );
    setHasChanges(true);
  }

  /**
   * Handle target model change for redirect mode
   */
  function handleTargetChange(alias: string, targetModel: string): void {
    const glmModel = GLM_MODELS.find((m) => m.value === targetModel);
    const apiBase = glmModel?.apiBase;

    setModels((prev) =>
      prev.map((model) =>
        model.alias === alias ? { ...model, targetModel, apiBase } : model
      )
    );
    setHasChanges(true);
  }

  /**
   * Rebuild and restart claude-proxy container
   */
  async function handleRebuild(): Promise<void> {
    setIsRebuilding(true);
    try {
      const response = await fetch("/api/claude-proxy/rebuild", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      onToastSuccess?.("claude-proxy rebuilt and restarted");
      // Refresh config after rebuild
      setTimeout(() => void fetchConfig(), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rebuild";
      onToastError?.(message);
      console.error("[claude-proxy-config] Error rebuilding:", error);
    } finally {
      setIsRebuilding(false);
    }
  }

  /**
   * Extract model name from target model value for routing rules
   * e.g., "openai/glm-4.7" -> "glm-4.7"
   * e.g., "anthropic/claude-opus-4-6" -> "opus"
   */
  function getTargetModelName(targetModel: string): string {
    // For GLM models: openai/glm-4.7 -> glm-4.7
    if (targetModel.includes("glm")) {
      const parts = targetModel.split("/");
      return parts[parts.length - 1]; // e.g., "glm-4.7"
    }
    // For Claude models: anthropic/claude-opus-4-6 -> opus
    if (targetModel.includes("opus")) return "opus";
    if (targetModel.includes("sonnet")) return "sonnet";
    if (targetModel.includes("haiku")) return "haiku";
    // Fallback: use last part of path
    const parts = targetModel.split("/");
    return parts[parts.length - 1];
  }

  /**
   * Save configuration
   * Saves model routing rules to claude-proxy config
   */
  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      // Build routing rules from redirect configurations
      // Rule format: name = target model alias in config.yaml, model_name = source pattern to match
      // Example: { name: "glm-4.7", model_name: "sonnet" } means "route sonnet requests to glm-4.7"
      const rules = models
        .filter((m) => m.routingMode === "redirect" && m.targetModel)
        .map((m) => ({
          // sourcePattern: the model alias being requested (e.g., "sonnet", "opus")
          sourcePattern: m.alias,
          // targetAlias: the model_name in config.yaml to route TO (e.g., "glm-4.7", "opus")
          targetAlias: getTargetModelName(m.targetModel!),
          enabled: true,
        }));

      // Save routing rules to claude-proxy config
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
      onToastSuccess?.("Model routing saved to claude-proxy config");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      onToastError?.(message);
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Save Z.ai API key
   */
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

  /**
   * Delete Z.ai API key
   */
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

  if (isLoading) {
    return (
      <TerminalCard command="cat" filename="~/.claude-workflow/claude-proxy-config.yaml" className={className}>
        <div className="flex flex-col items-center justify-center h-full">
          <div className="spinner w-8 h-8 mb-4" />
          <p className="text-gray-400">Loading config...</p>
        </div>
      </TerminalCard>
    );
  }


  const headerActions = (
    <div className="flex items-center gap-2">
      {/* Global routing toggle switch - red/green slider */}
      <button
        onClick={() => void handleRoutingToggle()}
        disabled={routingEnabledLoading}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${
          routingEnabledLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        } ${
          routingEnabled
            ? "bg-green-600 focus:ring-green-500"
            : "bg-red-600 focus:ring-red-500"
        }`}
        type="button"
        role="switch"
        aria-checked={routingEnabled}
        title={routingEnabled ? "Disable claude-proxy routing (direct to API)" : "Enable claude-proxy routing (via localhost:4000)"}
      >
        <span className="sr-only">
          {routingEnabled ? "Disable routing" : "Enable routing"}
        </span>
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
            routingEnabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      {/* Save button (only when has changes) */}
      {hasChanges && (
        <button
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          type="button"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      )}
      {/* Rebuild button */}
      <button
        onClick={() => void handleRebuild()}
        disabled={isRebuilding || isSaving}
        className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        type="button"
        title="Rebuild and restart claude-proxy Docker container"
      >
        {isRebuilding ? "Rebuilding..." : "Rebuild"}
      </button>
    </div>
  );

  return (
    <TerminalCard
      command="cat"
      filename="~/.claude-workflow/claude-proxy-config.yaml"
      headerText="claude-proxy"
      headerActions={headerActions}
      className={className}
      noPadding
    >
      <div className="[&>*+*]:border-t [&>*+*]:border-red-800/50">
        {/* Model Routing sub-header */}
        <div className="px-4 py-2 bg-gray-900/50">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Model Routing</span>
        </div>

        {models.map((model) => {
          const isRedirect = model.routingMode === "redirect";
          const fallbacksDisplay = model.fallbacks && model.fallbacks.length > 0
            ? model.fallbacks.join(" → ")
            : "None";

          return (
            <div key={model.alias} className="px-4 py-3 flex flex-col gap-2">
              {/* Row 1: Model name, status, and controls */}
              <div className="flex items-center justify-between gap-3">
                {/* Left: Model name and status */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-white font-medium capitalize shrink-0">
                    {model.displayName}
                  </span>
                  <span className={`text-xs shrink-0 ${isRedirect ? "text-red-400" : "text-gray-500"}`}>
                    {isRedirect && model.targetModel
                      ? `→ ${getTargetModelLabel(model.targetModel)}`
                      : "Passthrough"}
                  </span>
                </div>

                {/* Right: Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Mode toggle */}
                  <button
                    onClick={() => handleModeChange(model.alias, isRedirect ? "passthrough" : "redirect")}
                    className="h-7 px-2 text-xs rounded-md border-1 border-red-800 bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900 transition-colors"
                    type="button"
                    title={isRedirect ? "Click to passthrough" : "Click to redirect"}
                  >
                    {isRedirect ? "Redirect" : "Direct"}
                  </button>

                  {/* Target selector (only when redirecting) */}
                  {isRedirect && (
                    <select
                      value={model.targetModel || ""}
                      onChange={(e) => handleTargetChange(model.alias, e.target.value)}
                      className="h-7 pl-2 pr-4 text-xs bg-gray-900 border-1 border-red-800 rounded-md text-white focus:outline-none focus:ring-1 focus:ring-red-600"
                    >
                      <option value="">Select...</option>
                      {ALL_REDIRECT_TARGETS.map((group) => (
                        <optgroup key={group.group} label={group.group}>
                          {group.models.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Row 2: Fallbacks display/edit */}
              <div className="flex items-center gap-2 pl-0">
                <span className="text-xs text-gray-500 shrink-0">Fallbacks:</span>
                {editingFallbacks === model.alias ? (
                  <>
                    <input
                      type="text"
                      value={fallbackEditValue}
                      onChange={(e) => setFallbackEditValue(e.target.value)}
                      placeholder="e.g. glm-4.7, glm-4.6, opus"
                      className="flex-1 h-6 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-red-600"
                      autoFocus
                    />
                    <button
                      onClick={() => void handleSaveFallbacks(model.alias)}
                      disabled={savingFallbacks}
                      className="h-6 px-2 text-xs bg-red-700 border-1 border-red-600 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      type="button"
                    >
                      {savingFallbacks ? "..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEditingFallbacks}
                      className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                      type="button"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-gray-400 font-mono flex-1">{fallbacksDisplay}</span>
                    <button
                      onClick={() => startEditingFallbacks(model.alias, model.fallbacks || [])}
                      className="h-6 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors opacity-60 hover:opacity-100"
                      type="button"
                      title="Edit fallbacks"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Fallback Settings sub-header */}
        <div className="px-4 py-2 bg-gray-900/50">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Failover Settings</span>
        </div>

        {/* Router Settings section */}
        {routerSettingsEditing ? (
          <div className="px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-white text-sm font-medium">Allowed Failures</span>
                <span className="text-xs text-gray-500">Before triggering cooldown</span>
              </div>
              <input
                type="number"
                min="1"
                max="10"
                value={routerSettings.allowedFails}
                onChange={(e) => setRouterSettings((prev) => ({
                  ...prev,
                  allowedFails: Number(e.target.value) || 2,
                }))}
                className="w-20 h-7 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-white text-sm font-medium">Cooldown Time</span>
                <span className="text-xs text-gray-500">Seconds before retry (default: 60)</span>
              </div>
              <input
                type="number"
                min="10"
                max="600"
                value={routerSettings.cooldownTime}
                onChange={(e) => setRouterSettings((prev) => ({
                  ...prev,
                  cooldownTime: Number(e.target.value) || 60,
                }))}
                className="w-20 h-7 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-white text-sm font-medium">Num Retries</span>
                <span className="text-xs text-gray-500">Retry attempts before failover</span>
              </div>
              <input
                type="number"
                min="1"
                max="10"
                value={routerSettings.numRetries}
                onChange={(e) => setRouterSettings((prev) => ({
                  ...prev,
                  numRetries: Number(e.target.value) || 3,
                }))}
                className="w-20 h-7 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleSaveRouterSettings()}
                className="flex-1 h-7 px-3 text-xs bg-red-700 border-1 border-red-600 text-white rounded hover:bg-red-600 transition-colors"
                type="button"
              >
                Save
              </button>
              <button
                onClick={() => setRouterSettingsEditing(false)}
                className="flex-1 h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
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
                {routerSettings.allowedFails} failures → {routerSettings.cooldownTime}s cooldown, {routerSettings.numRetries} retries
              </span>
            </div>
            <button
              onClick={() => setRouterSettingsEditing(true)}
              className="h-7 px-3 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
              type="button"
            >
              Edit
            </button>
          </div>
        )}

        {/* External Models sub-header */}
        <div className="px-4 py-2 bg-gray-900/50">
          <span className="text-xs text-gray-500 uppercase tracking-wider">External Models</span>
        </div>

        {/* Z.ai API Key section */}
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
                  className="h-7 px-2 text-xs bg-gray-900 border-1 border-red-800 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600 w-32"
                  autoFocus
                />
                <button
                  disabled={apiKey.isSaving || apiKey.editValue.trim() === ""}
                  onClick={() => void handleSaveApiKey()}
                  className="h-7 px-2 text-xs bg-red-700 border-1 border-red-600 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  type="button"
                >
                  {apiKey.isSaving ? "..." : "Save"}
                </button>
                <button
                  onClick={() => setApiKey((prev) => ({ ...prev, isEditing: false, editValue: "" }))}
                  className="h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setApiKey((prev) => ({ ...prev, isEditing: true }))}
                  className="h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-gray-400 rounded hover:bg-red-800 hover:text-gray-900 transition-colors"
                  type="button"
                >
                  {apiKey.isSet ? "Update" : "Set"}
                </button>
                {apiKey.isSet && (
                  <button
                    onClick={() => void handleDeleteApiKey()}
                    className="h-7 px-2 text-xs bg-transparent border-1 border-red-800 text-red-400 rounded hover:bg-red-800 hover:text-red-300 transition-colors"
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
    </TerminalCard>
  );
}
