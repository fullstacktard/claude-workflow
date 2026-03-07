/**
 * DeployHistoryList - Renders a list of recent deploy workflow runs.
 * Shows timestamp, status badge, actor, and link to GitHub.
 */

interface DeployHistoryEntry {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  displayTitle: string;
  actor: string;
}

interface DeployHistoryListProps {
  entries: DeployHistoryEntry[];
  isLoading: boolean;
}

function getStatusBadge(status: string, conclusion: string | null): {
  label: string;
  className: string;
} {
  if (status === "completed") {
    if (conclusion === "success") {
      return { label: "Success", className: "bg-green-500/20 text-green-400" };
    }
    if (conclusion === "failure") {
      return { label: "Failed", className: "bg-red-500/20 text-red-400" };
    }
    if (conclusion === "cancelled") {
      return { label: "Cancelled", className: "bg-neutral-500/20 text-neutral-400" };
    }
    return { label: conclusion ?? "Done", className: "bg-yellow-500/20 text-yellow-400" };
  }
  if (status === "in_progress") {
    return { label: "Running", className: "bg-blue-500/20 text-blue-400" };
  }
  if (status === "queued") {
    return { label: "Queued", className: "bg-neutral-500/20 text-neutral-300" };
  }
  return { label: status, className: "bg-neutral-500/20 text-neutral-400" };
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DeployHistoryList({ entries, isLoading }: DeployHistoryListProps): JSX.Element {
  if (isLoading && entries.length === 0) {
    return <div className="py-8 text-center text-neutral-500">Loading deploy history...</div>;
  }

  if (entries.length === 0) {
    return <div className="py-8 text-center text-neutral-500">No deploy history found</div>;
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const badge = getStatusBadge(entry.status, entry.conclusion);
        return (
          <div
            key={entry.runId}
            className="flex items-center justify-between rounded-md border border-neutral-700 bg-neutral-700/30 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
              <span className="text-sm text-white">{entry.displayTitle}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-neutral-500">by {entry.actor}</span>
              <span className="text-xs text-neutral-500">{formatTimestamp(entry.createdAt)}</span>
              <a
                href={entry.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline"
              >
                View
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
