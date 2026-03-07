/**
 * AddMcpServerModal Component
 * Modal for adding and editing MCP server configurations
 *
 * @example
 * ```tsx
 * <AddMcpServerModal
 *   isOpen={true}
 *   onClose={() => setIsOpen(false)}
 *   onSuccess={() => refetch()}
 *   onError={(msg) => showToast(msg, 'error')}
 * />
 *
 * // Edit mode
 * <AddMcpServerModal
 *   isOpen={true}
 *   onClose={() => setIsOpen(false)}
 *   onSuccess={() => refetch()}
 *   onError={(msg) => showToast(msg, 'error')}
 *   editServer={existingServerConfig}
 * />
 * ```
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  /** Server name (alphanumeric with hyphens) */
  name: string;
  /** Command to execute (e.g., npx, node, uvx) */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Transport protocol */
  transport: "stdio" | "sse" | "streamable-http";
  /** Idle timeout in seconds (0 = no timeout) */
  idleTimeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Props for AddMcpServerModal component
 */
interface AddMcpServerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal closes */
  onClose: () => void;
  /** Callback when server is successfully added/updated */
  onSuccess: () => void;
  /** Callback when an error occurs */
  onError: (error: string) => void;
  /** If provided, modal is in edit mode with prefilled values */
  editServer?: McpServerConfig;
}

type ModalStep = "form" | "loading" | "error";

interface FormState {
  name: string;
  command: string;
  args: string[];
  transport: "stdio" | "sse" | "streamable-http";
  idleTimeout: string;
  envVars: Array<{ key: string; value: string; isReference?: boolean; maskedValue?: string }>;
}

interface ApiErrorResponse {
  error?: string;
}

interface EnvVarData {
  set: boolean;
  maskedValue: string;
  value?: string;
}

const SERVER_NAME_REGEX = /^[a-zA-Z0-9-]+$/;

const INITIAL_FORM_STATE: FormState = {
  name: "",
  command: "",
  args: [],
  transport: "stdio",
  idleTimeout: "",
  envVars: [],
};

/**
 * Convert McpServerConfig to FormState
 * Detects env var references like ${VAR_NAME} and resolves them to actual values
 */
function serverToFormState(server: McpServerConfig, globalEnvVars?: Record<string, EnvVarData>): FormState {
  return {
    name: server.name,
    command: server.command,
    args: [...(server.args || [])],
    transport: server.transport,
    idleTimeout: server.idleTimeout?.toString() ?? "",
    envVars: Object.entries(server.env || {}).map(([key, value]) => {
      // Check if value is a reference like ${VAR_NAME}
      const refMatch = value.match(/^\$\{([A-Z][A-Z0-9_]*)\}$/);
      if (refMatch) {
        const refName = refMatch[1];
        const globalVar = globalEnvVars?.[refName];
        // Use the actual value from global env vars, or empty string if not set
        return {
          key,
          value: globalVar?.value || "",
          isReference: true,
          maskedValue: globalVar?.maskedValue || "(not set)",
        };
      }
      return { key, value };
    }),
  };
}

export function AddMcpServerModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
  editServer,
}: AddMcpServerModalProps): JSX.Element | null {
  const isEditMode = editServer !== undefined;

  const [step, setStep] = useState<ModalStep>("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [globalEnvVars, setGlobalEnvVars] = useState<Record<string, EnvVarData>>({});

  // Ref for modal content container (for focus trap)
  const modalRef = useRef<HTMLDivElement>(null);
  // Restore focus to previously focused element when modal closes
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Fetch global env vars when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchEnvVars = async (): Promise<void> => {
        try {
          const response = await fetch("/api/mcpproxy/api-keys");
          if (response.ok) {
            const data = await response.json() as { envVars?: Record<string, EnvVarData> };
            setGlobalEnvVars(data.envVars || {});
          }
        } catch (error) {
          console.error("[AddMcpServerModal] Failed to fetch env vars:", error);
        }
      };
      void fetchEnvVars();
    }
  }, [isOpen]);

  // Reset form when modal opens/closes or editServer changes
  useEffect(() => {
    if (isOpen) {
      if (editServer) {
        setForm(serverToFormState(editServer, globalEnvVars));
      } else {
        setForm(INITIAL_FORM_STATE);
      }
      setStep("form");
      setErrorMessage("");
    }
  }, [isOpen, editServer, globalEnvVars]);

  const handleClose = useCallback((): void => {
    setStep("form");
    setErrorMessage("");
    onClose();
  }, [onClose]);

  /**
   * Handle keyboard navigation for modal
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      handleClose();
      return;
    }

    // Tab trap
    if (event.key === "Tab" && modalRef.current) {
      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

      if (focusableElements.length === 0) return;

      const activeElement = document.activeElement as HTMLElement;
      const currentIndex = focusableElements.indexOf(activeElement);

      if (event.shiftKey) {
        event.preventDefault();
        if (currentIndex <= 0) {
          focusableElements[focusableElements.length - 1]?.focus();
        } else {
          focusableElements[currentIndex - 1]?.focus();
        }
      } else {
        event.preventDefault();
        if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
          focusableElements[0]?.focus();
        } else {
          focusableElements[currentIndex + 1]?.focus();
        }
      }
    }
  }, [handleClose]);

  // Focus first focusable element when modal opens
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const firstFocusable = modalRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
  }, [isOpen]);

  // Manage body scroll and focus restoration
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Validation
  function validateForm(): string | null {
    if (!form.name.trim()) {
      return "Server name is required";
    }
    if (!SERVER_NAME_REGEX.test(form.name)) {
      return "Server name must be alphanumeric with hyphens only";
    }
    if (!form.command.trim()) {
      return "Command is required";
    }
    // Check for empty keys in env vars
    const hasEmptyEnvKey = form.envVars.some(
      (ev) => ev.key.trim() === "" && ev.value.trim() !== ""
    );
    if (hasEmptyEnvKey) {
      return "Environment variable keys cannot be empty";
    }
    return null;
  }

  const isFormValid =
    form.name.trim() !== "" &&
    SERVER_NAME_REGEX.test(form.name) &&
    form.command.trim() !== "";

  // Args handlers
  function handleAddArg(): void {
    setForm((prev) => ({
      ...prev,
      args: [...prev.args, ""],
    }));
  }

  function handleRemoveArg(index: number): void {
    setForm((prev) => ({
      ...prev,
      args: prev.args.filter((_, i) => i !== index),
    }));
  }

  function handleArgChange(index: number, value: string): void {
    setForm((prev) => ({
      ...prev,
      args: prev.args.map((arg, i) => (i === index ? value : arg)),
    }));
  }

  // Env var handlers
  function handleAddEnvVar(): void {
    setForm((prev) => ({
      ...prev,
      envVars: [...prev.envVars, { key: "", value: "" }],
    }));
  }

  function handleRemoveEnvVar(index: number): void {
    setForm((prev) => ({
      ...prev,
      envVars: prev.envVars.filter((_, i) => i !== index),
    }));
  }

  function handleEnvVarChange(
    index: number,
    field: "key" | "value",
    value: string
  ): void {
    setForm((prev) => ({
      ...prev,
      envVars: prev.envVars.map((ev, i) =>
        i === index ? { ...ev, [field]: value } : ev
      ),
    }));
  }

  // Submit handler
  async function handleSubmit(): Promise<void> {
    const validationError = validateForm();
    if (validationError) {
      setErrorMessage(validationError);
      setStep("error");
      return;
    }

    setStep("loading");

    try {
      // Convert form state to API payload
      const payload: McpServerConfig = {
        name: form.name.trim(),
        command: form.command.trim(),
        args: form.args.filter((arg) => arg.trim() !== ""),
        transport: form.transport,
        idleTimeout: form.idleTimeout ? parseInt(form.idleTimeout, 10) : 0,
        env: form.envVars.reduce(
          (acc, { key, value }) => {
            if (key.trim()) {
              acc[key.trim()] = value;
            }
            return acc;
          },
          {} as Record<string, string>
        ),
      };

      const url = isEditMode
        ? `/api/mcpproxy/servers/${editServer.name}`
        : "/api/mcpproxy/servers";
      const method = isEditMode ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Handle non-JSON error responses gracefully
        let errorMessage = `HTTP ${response.status}`;
        try {
          const data = (await response.json()) as ApiErrorResponse;
          errorMessage = data.error ?? errorMessage;
        } catch {
          // Response body wasn't JSON - use status-based message
          if (response.status === 500) {
            errorMessage = "Server error. Please try again later.";
          } else if (response.status >= 502 && response.status <= 504) {
            errorMessage = "Service temporarily unavailable.";
          }
        }
        throw new Error(errorMessage);
      }

      onSuccess();
      handleClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save server configuration";
      setErrorMessage(message);
      setStep("error");
      onError(message);
    }
  }

  function handleRetry(): void {
    setStep("form");
    setErrorMessage("");
  }

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (isFormValid && step === "form") {
      void handleSubmit();
    }
  }

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-gray-900 border border-red-800 rounded-lg shadow-xl max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-red-800">
          <h2 id="modal-title" className="text-white font-medium font-mono">
            {isEditMode ? "Edit MCP Server" : "Add MCP Server"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 rounded transition-colors hover:text-white hover:bg-red-800/50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {step === "loading" ? (
            <div className="py-8 flex flex-col items-center justify-center">
              <div className="spinner w-8 h-8 mb-4" />
              <p className="text-gray-400">
                {isEditMode ? "Updating server..." : "Adding server..."}
              </p>
            </div>
          ) : step === "error" ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-2">Error</h3>
              <div className="p-4 rounded-md border bg-red-900/20 border-red-800/50">
                <p className="text-red-400 text-sm">{errorMessage}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleRetry}
                  className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                  type="button"
                >
                  Back to Form
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-300 mb-4">
                Configure an MCP server to add tools to your workflow.
              </p>

              <form onSubmit={handleFormSubmit}>
                {/* Server Name */}
                <div className="mb-4 last:mb-0">
                  <label htmlFor="server-name" className="block text-sm font-medium text-gray-300 mb-2">
                    Server Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="server-name"
                    type="text"
                    value={form.name}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="e.g., context7, exa-search"
                    className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
                    autoFocus
                    disabled={isEditMode}
                    aria-describedby="server-name-hint"
                  />
                  <p id="server-name-hint" className="text-xs text-gray-500 mt-3">
                    Alphanumeric and hyphens only
                  </p>
                </div>

                {/* Command */}
                <div className="mb-4 last:mb-0">
                  <label htmlFor="server-command" className="block text-sm font-medium text-gray-300 mb-2">
                    Command <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="server-command"
                    type="text"
                    value={form.command}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, command: e.target.value }))
                    }
                    placeholder="e.g., npx, node, uvx"
                    className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 font-mono"
                  />
                </div>

                {/* Args - Array Builder */}
                <div className="mb-4 last:mb-0 space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-300">Arguments</label>
                    <button
                      type="button"
                      onClick={handleAddArg}
                      className="h-7 px-3 text-xs bg-transparent border border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                      aria-label="Add argument"
                    >
                      + Add
                    </button>
                  </div>
                  {form.args.map((arg, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={arg}
                        onChange={(e) => handleArgChange(index, e.target.value)}
                        placeholder="e.g., -y, @anthropic-ai/context7-mcp"
                        className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
                        aria-label={`Argument ${index + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveArg(index)}
                        className="h-11 w-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-red-400 rounded-md transition-colors hover:text-red-300 hover:bg-red-800/20 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                        aria-label={`Remove argument ${index + 1}`}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                  {form.args.length === 0 && (
                    <p className="text-xs text-gray-500">
                      No arguments added. Click &quot;+ Add&quot; to add command arguments.
                    </p>
                  )}
                </div>

                {/* Transport */}
                <div className="mb-4 last:mb-0">
                  <label htmlFor="server-transport" className="block text-sm font-medium text-gray-300 mb-2">
                    Transport
                  </label>
                  <select
                    id="server-transport"
                    value={form.transport}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        transport: e.target.value as FormState["transport"],
                      }))
                    }
                    className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 pr-12 text-base sm:text-sm text-foreground outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 appearance-none cursor-pointer select-chevron"
                  >
                    <option value="stdio">stdio (Standard I/O)</option>
                    <option value="sse">sse (Server-Sent Events)</option>
                    <option value="streamable-http">streamable-http</option>
                  </select>
                </div>

                {/* Idle Timeout */}
                <div className="mb-4 last:mb-0">
                  <label htmlFor="server-timeout" className="block text-sm font-medium text-gray-300 mb-2">
                    Idle Timeout (seconds)
                  </label>
                  <input
                    id="server-timeout"
                    type="number"
                    value={form.idleTimeout}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, idleTimeout: e.target.value }))
                    }
                    placeholder="0 (no timeout)"
                    min="0"
                    className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
                    aria-describedby="timeout-hint"
                  />
                  <p id="timeout-hint" className="text-xs text-gray-500 mt-3">
                    0 means no timeout
                  </p>
                </div>

                {/* Environment Variables - Key-Value Builder */}
                <div className="mb-4 last:mb-0 space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-300">Environment Variables</label>
                    <button
                      type="button"
                      onClick={handleAddEnvVar}
                      className="h-7 px-3 text-xs bg-transparent border border-red-800 text-gray-400 rounded-md hover:bg-red-800 hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                      aria-label="Add environment variable"
                    >
                      + Add
                    </button>
                  </div>
                  {form.envVars.map((envVar, index) => (
                    <div key={index} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={envVar.key}
                          onChange={(e) =>
                            handleEnvVarChange(index, "key", e.target.value)
                          }
                          placeholder="KEY"
                          className="w-1/3 bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 font-mono"
                          aria-label={`Environment variable ${index + 1} key`}
                        />
                        <span className="text-gray-500">=</span>
                        <input
                          type="text"
                          value={envVar.value}
                          onChange={(e) =>
                            handleEnvVarChange(index, "value", e.target.value)
                          }
                          placeholder="value"
                          className="flex-1 bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 font-mono"
                          aria-label={`Environment variable ${index + 1} value`}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvVar(index)}
                          className="h-11 w-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-red-400 rounded-md transition-colors hover:text-red-300 hover:bg-red-800/20 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                          aria-label={`Remove environment variable ${index + 1}`}
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      {/* Show hint for referenced env vars */}
                      {envVar.isReference && (
                        <div className="ml-0 pl-2 border-l-2 border-green-800/50">
                          <span className="text-xs text-green-500">
                            Global env var (from ~/.mcp-proxy/.env)
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  {form.envVars.length === 0 && (
                    <p className="text-xs text-gray-500">
                      No environment variables. Click &quot;+ Add&quot; for API keys, etc.
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2 mt-6">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!isFormValid}
                    className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 hover:border-red-500 disabled:bg-gray-700 disabled:border-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
                  >
                    {isEditMode ? "Save Changes" : "Add Server"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
