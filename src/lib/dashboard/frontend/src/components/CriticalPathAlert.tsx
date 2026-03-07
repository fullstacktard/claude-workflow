/**
 * CriticalPathAlert displays a warning banner when critical path is blocked.
 *
 * Shows when 3 or more agents are blocked, indicating a significant workflow bottleneck.
 */

interface CriticalBlocker {
  agentType: string;
  taskId: string;
  status: string;
  blockingCount: number;
}

interface CriticalPathAlertProps {
  /** Total number of blocked agents */
  blockedCount: number;
  /** Information about the agent causing the most blockage */
  criticalBlocker?: CriticalBlocker;
  /** Optional dismiss handler */
  onDismiss?: () => void;
}

/**
 * Alert banner for critical path blocking situations.
 * Only renders when blockedCount >= 3.
 */
export function CriticalPathAlert({
  blockedCount,
  criticalBlocker,
  onDismiss,
}: CriticalPathAlertProps): JSX.Element | null {
  // Only show when 3+ tasks are blocked
  if (blockedCount < 3) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-red-900/30 border border-red-700 rounded-lg" role="alert">
      <div className="flex items-center justify-center w-8 h-8 bg-red-800/50 rounded-full text-red-400 font-bold text-lg shrink-0">!</div>
      <div className="flex-1 min-w-0">
        <div className="text-red-400 font-semibold text-sm">Critical Path Blocked</div>
        <div className="text-red-300/80 text-xs mt-0.5">
          {blockedCount} agents waiting
          {criticalBlocker && (
            <>
              {" - "}
              <span className="text-amber-300">{criticalBlocker.agentType}</span>
              {" is blocking "}
              <span className="text-amber-300">{criticalBlocker.blockingCount}</span>
              {" downstream task"}
              {criticalBlocker.blockingCount !== 1 ? "s" : ""}
            </>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="p-1 text-red-400/60 hover:text-red-300 hover:bg-red-800/30 rounded transition-colors"
          aria-label="Dismiss alert"
          type="button"
        >
          x
        </button>
      )}
    </div>
  );
}
