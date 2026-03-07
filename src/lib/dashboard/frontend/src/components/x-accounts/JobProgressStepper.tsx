/**
 * JobProgressStepper - Vertical 6-stage progress stepper for GeeLark account creation jobs.
 *
 * Renders each stage with an icon (pending, in_progress, completed, failed),
 * a connector line between steps, optional timing data, and a retry button
 * below the failed step.
 */
import { Check, Loader2, X as XIcon } from "lucide-react";

import type { GeeLarkJob, JobStage, StepState } from "../../types/x-accounts";
import { JOB_STAGE_LABELS, JOB_STAGE_ORDER, JOB_TYPE_STAGE_ORDERS } from "../../types/x-accounts";

/** Renders the correct icon for each step state */
function StepIcon({ state }: { state: StepState }): JSX.Element {
  switch (state) {
    case "completed":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20 text-green-400">
          <Check className="h-3.5 w-3.5" />
        </div>
      );
    case "in_progress":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </div>
      );
    case "failed":
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 text-red-400">
          <XIcon className="h-3.5 w-3.5" />
        </div>
      );
    case "pending":
    default:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-700 text-gray-600">
          <div className="h-2 w-2 rounded-full bg-gray-700" />
        </div>
      );
  }
}

interface JobProgressStepperProps {
  /** The current stage the job is on */
  currentStage: JobStage;
  /** Overall job status */
  status: "running" | "completed" | "failed";
  /** Job type -- determines which stage order to use. Defaults to create_x_account. */
  jobType?: GeeLarkJob["type"];
  /** Error message to display below the failed step */
  error?: string;
  /** Per-stage elapsed seconds for timing display */
  stageTimings?: Partial<Record<JobStage, number>>;
  /** Callback when the user clicks "Retry" on a failed step */
  onRetry?: () => void;
}

export function JobProgressStepper({
  currentStage,
  status,
  jobType,
  error,
  stageTimings,
  onRetry,
}: JobProgressStepperProps): JSX.Element {
  const stageOrder = jobType != null ? (JOB_TYPE_STAGE_ORDERS[jobType] ?? JOB_STAGE_ORDER) : JOB_STAGE_ORDER;
  const currentIndex = stageOrder.indexOf(currentStage);

  function getStepState(index: number): StepState {
    if (index < currentIndex) return "completed";
    if (index === currentIndex) {
      if (status === "failed") return "failed";
      if (status === "completed") return "completed";
      return "in_progress";
    }
    // Steps after current: if job completed globally, mark all as completed
    if (status === "completed") return "completed";
    return "pending";
  }

  function formatTiming(stage: JobStage): string {
    const seconds = stageTimings?.[stage];
    if (seconds === undefined) return "--";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  }

  return (
    <div className="flex flex-col gap-0" role="list" aria-label="Job progress steps">
      {stageOrder.map((stage, index) => {
        const state = getStepState(index);
        const isLast = index === stageOrder.length - 1;

        return (
          <div key={stage} className="flex gap-3" role="listitem">
            {/* Icon + connector line */}
            <div className="flex flex-col items-center">
              <StepIcon state={state} />
              {!isLast && (
                <div
                  className={`w-px min-h-4 flex-1 ${
                    state === "completed" ? "bg-green-500/30" : "bg-gray-800"
                  }`}
                />
              )}
            </div>
            {/* Label + timing + error */}
            <div className="flex-1 pb-3">
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-medium ${
                    state === "completed"
                      ? "text-gray-300"
                      : state === "in_progress"
                        ? "text-blue-400"
                        : state === "failed"
                          ? "text-red-400"
                          : "text-gray-600"
                  }`}
                >
                  {JOB_STAGE_LABELS[stage]}
                </span>
                <span className="text-xs font-mono text-gray-600">
                  {formatTiming(stage)}
                </span>
              </div>
              {state === "failed" && error && (
                <div className="mt-1.5">
                  <p className="mb-1.5 text-xs text-red-400/80">{error}</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/20"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
