/**
 * JobQueuePanel - Displays a list of active and completed GeeLark creation jobs.
 *
 * Each job renders as a collapsible card with a summary header (status icon,
 * name/id, step count, elapsed time) and an expandable JobProgressStepper.
 * Active and failed jobs are auto-expanded; completed jobs are collapsed.
 */
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useState } from "react";

import type { GeeLarkJob } from "../../types/x-accounts";
import { JOB_TYPE_STAGE_ORDERS, JOB_TYPE_LABELS, parseJobStage } from "../../types/x-accounts";
import { JobProgressStepper } from "./JobProgressStepper";

/** Formats elapsed seconds since job start into "Xm XXs" */
function formatElapsed(startedAt: string): string {
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const clamped = Math.max(0, elapsed);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

interface JobCardProps {
  job: GeeLarkJob;
  onRetry?: (jobId: string) => void;
}

function JobCard({ job, onRetry }: JobCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(
    job.status === "running" || job.status === "failed"
  );
  const stage = parseJobStage(job.progress);
  const stageOrder = JOB_TYPE_STAGE_ORDERS[job.type] ?? JOB_TYPE_STAGE_ORDERS.create_x_account;
  const stageIndex = stageOrder.indexOf(stage);
  const totalSteps = stageOrder.length;
  const jobTypeLabel = JOB_TYPE_LABELS[job.type] ?? job.type;

  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-gray-800/30"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2">
          {job.status === "running" && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
          )}
          {job.status === "completed" && (
            <div className="h-3.5 w-3.5 shrink-0 rounded-full bg-green-500" />
          )}
          {job.status === "failed" && (
            <div className="h-3.5 w-3.5 shrink-0 rounded-full bg-red-500" />
          )}
          <span className="truncate text-xs text-white">
            {job.result?.account_handle
              ? `@${job.result.account_handle}`
              : `Job ${job.id.slice(0, 8)}`}
          </span>
          <span className="text-xs text-gray-600">{jobTypeLabel}</span>
          <span className="text-xs text-gray-500">
            Step {Math.min(stageIndex + 1, totalSteps)}/{totalSteps}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-gray-600">
            {formatElapsed(job.started_at)}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-600" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-600" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-800/50 px-3 pb-3 pt-1">
          <JobProgressStepper
            currentStage={stage}
            status={job.status}
            jobType={job.type}
            error={job.error}
            onRetry={onRetry ? () => onRetry(job.id) : undefined}
          />
        </div>
      )}
    </div>
  );
}

interface JobQueuePanelProps {
  /** All tracked jobs (active + completed + failed) */
  jobs: GeeLarkJob[];
  /** Callback when user clicks "Retry" on a failed job */
  onRetry?: (jobId: string) => void;
  /** Callback to clear completed/failed jobs from the list */
  onClearCompleted?: () => void;
}

export function JobQueuePanel({
  jobs,
  onRetry,
  onClearCompleted,
}: JobQueuePanelProps): JSX.Element {
  const activeJobs = jobs.filter((j) => j.status === "running");
  const completedJobs = jobs.filter((j) => j.status !== "running");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Job Queue{" "}
          {activeJobs.length > 0 && (
            <span className="text-blue-400">({activeJobs.length} active)</span>
          )}
        </h3>
        {completedJobs.length > 0 && onClearCompleted && (
          <button
            type="button"
            onClick={onClearCompleted}
            className="text-xs text-gray-600 transition-colors hover:text-gray-400"
          >
            Clear completed
          </button>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="px-1 text-xs text-gray-600">No active jobs</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onRetry={onRetry} />
          ))}
        </div>
      )}
    </div>
  );
}
