/**
 * BatchActions Component
 *
 * Batch approve/reject action bar shown when there are pending drafts.
 * The actual confirmation dialog logic lives in DraftsPage via useConfirm().
 * This component is purely presentational.
 *
 * @module components/drafts/BatchActions
 */

interface BatchActionsProps {
  /** Number of drafts currently in "pending" status */
  pendingCount: number;
  /** Called when user clicks "Approve All Pending" */
  onBatchApprove: () => void;
  /** Called when user clicks "Reject All Pending" */
  onBatchReject: () => void;
}

export function BatchActions({
  pendingCount,
  onBatchApprove,
  onBatchReject,
}: BatchActionsProps): JSX.Element | null {
  if (pendingCount === 0) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-red-800/30 bg-gray-900/50 px-4 py-2"
      role="toolbar"
      aria-label="Batch actions"
    >
      <span className="text-xs text-gray-500">
        {pendingCount} pending draft{pendingCount !== 1 ? "s" : ""}
      </span>
      <button
        onClick={onBatchApprove}
        className="rounded border border-green-600/30 bg-green-600/20 px-2.5 py-1 text-xs text-green-400 transition-colors hover:bg-green-600/30 focus:outline-none focus:ring-2 focus:ring-green-400/50"
      >
        Approve All Pending
      </button>
      <button
        onClick={onBatchReject}
        className="rounded border border-red-600/30 bg-red-600/20 px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-600/30 focus:outline-none focus:ring-2 focus:ring-red-400/50"
      >
        Reject All Pending
      </button>
    </div>
  );
}
