/**
 * BlockedTaskBadge displays the count of blocked agents in workflow header.
 *
 * Shows an amber badge with the number of blocked agents. Hidden when count is 0.
 */

interface BlockedTaskBadgeProps {
  /** Number of blocked agents */
  count: number;
  /** Optional click handler to expand blocked section */
  onClick?: () => void;
}

/**
 * Badge component showing blocked agent count.
 * Returns null when count is 0 (nothing to display).
 */
export function BlockedTaskBadge({
  count,
  onClick,
}: BlockedTaskBadgeProps): JSX.Element | null {
  if (count === 0) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-900/30 border border-amber-700 rounded-md text-xs cursor-pointer transition-colors hover:bg-amber-900/50"
      title={`${count} blocked agent${count > 1 ? "s" : ""}`}
      type="button"
    >
      <span className="text-amber-400 font-bold">!</span>
      <span className="text-amber-300 font-mono">{count}</span>
      <span className="text-amber-400/80">blocked</span>
    </button>
  );
}
