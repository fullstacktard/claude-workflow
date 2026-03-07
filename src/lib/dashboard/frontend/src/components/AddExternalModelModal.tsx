/**
 * AddExternalModelModal Component
 * Modal for adding/editing external (non-Claude) models with LiteLLM-compatible configuration
 */

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";

export interface ExternalModel {
  id: string;
  name: string;
  provider: "openai" | "azure" | "ollama" | "custom";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
}

interface AddExternalModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (model: ExternalModel) => void;
  onError: (error: string) => void;
  editModel?: ExternalModel; // For edit mode
}

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "ollama", label: "Ollama (Local)" },
  { value: "custom", label: "Custom Endpoint" },
] as const;

export function AddExternalModelModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
  editModel,
}: AddExternalModelModalProps): JSX.Element | null {
  const [formData, setFormData] = useState<Partial<ExternalModel>>({
    name: "",
    provider: "openai",
    baseUrl: "",
    apiKey: "",
    modelId: "",
    maxTokens: undefined,
    temperature: undefined,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Ref for modal content container (for focus trap)
  const modalRef = useRef<HTMLDivElement>(null);
  // Restore focus to previously focused element when modal closes
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Helper function for closing modal
  const handleClose = useCallback((): void => {
    if (isSubmitting) return;
    setFormData({
      name: "",
      provider: "openai",
      baseUrl: "",
      apiKey: "",
      modelId: "",
      maxTokens: undefined,
      temperature: undefined,
    });
    setErrors({});
    setShowApiKey(false);
    onClose();
  }, [onClose, isSubmitting]);

  /**
   * Handle keyboard navigation for modal
   * - Escape closes modal
   * - Tab is trapped within modal
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (event.key === "Escape" && !isSubmitting) {
      handleClose();
      return;
    }

    // Tab trap: prevent tabbing outside modal
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
        // Shift+Tab: move to previous or last element
        event.preventDefault();
        if (currentIndex <= 0) {
          focusableElements[focusableElements.length - 1]?.focus();
        } else {
          focusableElements[currentIndex - 1]?.focus();
        }
      } else {
        // Tab: move to next or first element
        event.preventDefault();
        if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
          focusableElements[0]?.focus();
        } else {
          focusableElements[currentIndex + 1]?.focus();
        }
      }
    }
  }, [handleClose, isSubmitting]);

  // Reset form when modal opens/closes or editModel changes
  useEffect(() => {
    if (isOpen) {
      if (editModel) {
        setFormData(editModel);
      } else {
        setFormData({
          name: "",
          provider: "openai",
          baseUrl: "",
          apiKey: "",
          modelId: "",
          maxTokens: undefined,
          temperature: undefined,
        });
      }
      setErrors({});
      setShowApiKey(false);
    }
  }, [isOpen, editModel]);

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
      document.body.style.overflow = "hidden"; // Prevent background scrolling
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
      document.body.style.overflow = ""; // Restore scrolling
    }

    return () => {
      document.body.style.overflow = ""; // Cleanup
    };
  }, [isOpen]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = "Model name is required";
    }
    if (!formData.baseUrl?.trim()) {
      newErrors.baseUrl = "Base URL is required";
    }
    if (!formData.modelId?.trim()) {
      newErrors.modelId = "Model ID is required";
    }
    // API key not required for Ollama (local)
    if (formData.provider !== "ollama" && !formData.apiKey?.trim()) {
      newErrors.apiKey = "API key is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // When editing, include the model ID in the URL path
      const url = editModel ? `/api/external-models/${editModel.id}` : "/api/external-models";
      const response = await fetch(url, {
        method: editModel ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const savedModel = (await response.json()) as ExternalModel;
      onSuccess(savedModel);
      handleClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget && !isSubmitting) {
      handleClose();
    }
  };

  const updateField = <K extends keyof ExternalModel>(
    field: K,
    value: ExternalModel[K]
  ): void => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Early return AFTER all hooks
  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={handleBackdropClick}
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
            {editModel ? "Edit External Model" : "Add External Model"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 rounded transition-colors hover:text-white hover:bg-red-800/50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="p-4 space-y-4">
          {/* Model Name */}
          <div className="mb-4 last:mb-0">
            <label htmlFor="model-name" className="block text-sm font-medium text-gray-300 mb-2">
              Model Name <span className="text-red-400">*</span>
            </label>
            <input
              id="model-name"
              type="text"
              value={formData.name || ""}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="e.g., GPT-4 Production"
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
            />
            {errors.name && (
              <p className="text-red-400 text-xs mt-1">{errors.name}</p>
            )}
          </div>

          {/* Provider Type */}
          <div className="mb-4 last:mb-0">
            <label htmlFor="provider" className="block text-sm font-medium text-gray-300 mb-2">
              Provider Type <span className="text-red-400">*</span>
            </label>
            <select
              id="provider"
              value={formData.provider || "openai"}
              onChange={(e) =>
                updateField("provider", e.target.value as ExternalModel["provider"])
              }
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 pr-12 text-base sm:text-sm text-foreground outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 appearance-none cursor-pointer select-chevron"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div className="mb-4 last:mb-0">
            <label htmlFor="base-url" className="block text-sm font-medium text-gray-300 mb-2">
              Base URL <span className="text-red-400">*</span>
            </label>
            <input
              id="base-url"
              type="url"
              value={formData.baseUrl || ""}
              onChange={(e) => updateField("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
            />
            {errors.baseUrl && (
              <p className="text-red-400 text-xs mt-1">{errors.baseUrl}</p>
            )}
          </div>

          {/* API Key */}
          <div className="mb-4 last:mb-0">
            <label htmlFor="api-key" className="block text-sm font-medium text-gray-300 mb-2">
              API Key {formData.provider !== "ollama" && <span className="text-red-400">*</span>}
            </label>
            <div className="relative">
              <input
                id="api-key"
                type={showApiKey ? "text" : "password"}
                value={formData.apiKey || ""}
                onChange={(e) => updateField("apiKey", e.target.value)}
                placeholder={formData.provider === "ollama" ? "Optional for local" : "sk-..."}
                className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
              >
                {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.apiKey && (
              <p className="text-red-400 text-xs mt-1">{errors.apiKey}</p>
            )}
          </div>

          {/* Model ID */}
          <div className="mb-4 last:mb-0">
            <label htmlFor="model-id" className="block text-sm font-medium text-gray-300 mb-2">
              Model ID <span className="text-red-400">*</span>
            </label>
            <input
              id="model-id"
              type="text"
              value={formData.modelId || ""}
              onChange={(e) => updateField("modelId", e.target.value)}
              placeholder="gpt-4-turbo-preview"
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
            />
            {errors.modelId && (
              <p className="text-red-400 text-xs mt-1">{errors.modelId}</p>
            )}
          </div>

          {/* Optional Fields Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Max Tokens */}
            <div className="mb-4 last:mb-0">
              <label htmlFor="max-tokens" className="block text-sm font-medium text-gray-300 mb-2">
                Max Tokens
              </label>
              <input
                id="max-tokens"
                type="number"
                value={formData.maxTokens ?? ""}
                onChange={(e) =>
                  updateField(
                    "maxTokens",
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder="4096"
                min={1}
                className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
              />
            </div>

            {/* Temperature */}
            <div className="mb-4 last:mb-0">
              <label htmlFor="temperature" className="block text-sm font-medium text-gray-300 mb-2">
                Temperature
              </label>
              <input
                id="temperature"
                type="number"
                value={formData.temperature ?? ""}
                onChange={(e) =>
                  updateField(
                    "temperature",
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                placeholder="0.7"
                min={0}
                max={2}
                step={0.1}
                className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-10 px-4 text-sm font-medium rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 hover:border-red-500 disabled:bg-gray-700 disabled:border-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-gray-900"
            >
              {isSubmitting
                ? "Saving..."
                : editModel
                ? "Update Model"
                : "Add Model"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
