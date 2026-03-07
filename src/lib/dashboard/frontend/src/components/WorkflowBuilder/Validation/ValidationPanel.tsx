/**
 * ValidationPanel Component
 * Displays workflow validation errors grouped by node with clickable navigation
 */

import { useMemo } from "react";
import type { ValidationError } from "../../../hooks/useWorkflowValidation";

/**
 * ValidationPanel props interface
 */
export interface ValidationPanelProps {
  /** List of validation errors */
  errors: ValidationError[];
  /** Callback when error is clicked - selects node on canvas */
  onErrorClick: (nodeId: string) => void;
  /** Whether validation is currently in progress */
  isValidating: boolean;
}

/**
 * Severity icon mapping
 */
const SEVERITY_ICONS: Record<"error" | "warning", string> = {
  error: "✗",
  warning: "⚠",
};

/**
 * ValidationPanel Component
 * Shows validation errors with node grouping and click-to-navigate
 */
export function ValidationPanel({
  errors,
  onErrorClick,
  isValidating,
}: ValidationPanelProps): JSX.Element {
  // Group errors by nodeId for organized display
  const errorsByNode = useMemo(() => {
    return errors.reduce((acc, error) => {
      if (!acc[error.nodeId]) {
        acc[error.nodeId] = [];
      }
      acc[error.nodeId].push(error);
      return acc;
    }, {} as Record<string, ValidationError[]>);
  }, [errors]);

  // Calculate total errors (for display)
  const errorCount = errors.filter((e) => e.severity === "error").length;
  const warningCount = errors.filter((e) => e.severity === "warning").length;

  // No errors state - prominent success indicator
  if (errors.length === 0 && !isValidating) {
    return (
      <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
        <div className="flex items-center gap-3 text-green-400">
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold">✓</span>
          </div>
          <div>
            <span className="text-sm font-medium">Workflow Valid</span>
            <p className="text-xs text-green-400/70">All nodes properly connected</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/95 border border-gray-700 rounded-lg p-4">
      {/* Header with status */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-100">
          Validation Results
        </h3>
        {isValidating && (
          <span className="text-xs text-gray-400 animate-pulse">
            Validating...
          </span>
        )}
      </div>

      {/* Error/Warning counts */}
      {errors.length > 0 && (
        <div className="mb-3 flex gap-4 text-xs">
          {errorCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-red-400 font-bold">✗</span>
              <span className="text-gray-300">
                {errorCount} {errorCount === 1 ? "error" : "errors"}
              </span>
            </div>
          )}
          {warningCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-yellow-400 font-bold">⚠</span>
              <span className="text-gray-300">
                {warningCount} {warningCount === 1 ? "warning" : "warnings"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Errors grouped by node */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {Object.entries(errorsByNode).map(([nodeId, nodeErrors]) => (
          <div key={nodeId} className="space-y-1">
            {/* Node header - clickable to navigate to node */}
            <button
              onClick={() => onErrorClick(nodeId)}
              className="w-full text-left text-xs font-semibold text-gray-200 hover:text-gray-100 transition-colors"
            >
              {nodeErrors[0].nodeName}
            </button>

            {/* Individual errors for this node */}
            {nodeErrors.map((error, index) => {
              const isError = error.severity === "error";
              const bgClass = isError
                ? "bg-red-900/30 border-red-500 hover:bg-red-900/40"
                : "bg-yellow-900/30 border-yellow-500 hover:bg-yellow-900/40";
              const iconClass = isError ? "text-red-400" : "text-yellow-400";

              return (
                <button
                  key={`${nodeId}-${index}`}
                  onClick={() => onErrorClick(nodeId)}
                  className={`w-full text-left border-l-4 ${bgClass} p-3 rounded cursor-pointer transition-colors`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`text-base font-bold ${iconClass} mt-0.5`}
                      aria-hidden="true"
                    >
                      {SEVERITY_ICONS[error.severity]}
                    </span>
                    <p className="text-sm text-gray-300 flex-1">
                      {error.message}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
