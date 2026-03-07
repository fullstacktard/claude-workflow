/**
 * DeployStatusCard - Shows status for a single GitHub Actions job.
 * Displays job name, status indicator (color), and timing info.
 */

interface JobStatus {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface DeployStatusCardProps {
  job: JobStatus;
}

function getStatusColor(status: string, conclusion: string | null): string {
  if (status === "completed") {
    if (conclusion === "success") return "bg-green-500";
    if (conclusion === "failure") return "bg-red-500";
    if (conclusion === "cancelled") return "bg-neutral-500";
    return "bg-yellow-500";
  }
  if (status === "in_progress") return "bg-blue-500 animate-pulse";
  if (status === "queued") return "bg-neutral-400";
  return "bg-neutral-600";
}

function getStatusLabel(status: string, conclusion: string | null): string {
  if (status === "completed") return conclusion ?? "completed";
  return status;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (startedAt === null) return "";
  const start = new Date(startedAt).getTime();
  const end = completedAt !== null ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
}

export function DeployStatusCard({ job }: DeployStatusCardProps): JSX.Element {
  const statusColor = getStatusColor(job.status, job.conclusion);
  const statusLabel = getStatusLabel(job.status, job.conclusion);
  const duration = formatDuration(job.startedAt, job.completedAt);

  return (
    <div className="rounded-md border border-neutral-600 bg-neutral-700/50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${statusColor}`} />
        <span className="text-sm font-medium text-white">{job.name}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs capitalize text-neutral-400">{statusLabel}</span>
        {duration !== "" && (
          <span className="text-xs text-neutral-500">{duration}</span>
        )}
      </div>
    </div>
  );
}
