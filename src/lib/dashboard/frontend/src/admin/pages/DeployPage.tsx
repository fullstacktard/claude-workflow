/**
 * DeployPage - Admin deploy pipeline control page.
 *
 * Controls:
 * - Target checkboxes (Worker, npm, Landing)
 * - Bump type selector (none/patch/minor/major)
 * - Dry-run toggle
 * - Change summary textarea
 * - "Deploy Live" button with confirmation dialog
 *
 * Status display:
 * - Per-job progress cards (queued/in_progress/success/failure)
 * - Error messages with retry
 * - Dry-run banner
 *
 * History:
 * - Recent deploy runs with status badges and links to GitHub Actions
 */

import { useState } from "react";
import { useDeploy } from "../hooks/useDeploy";
import { DeployStatusCard } from "../components/deploy/DeployStatusCard";
import { DeployHistoryList } from "../components/deploy/DeployHistoryList";

type DeployTarget = "worker" | "npm" | "landing";
type BumpType = "none" | "patch" | "minor" | "major";

export function DeployPage(): JSX.Element {
  const {
    deployStatus,
    isTriggering,
    isPolling,
    history,
    isLoadingHistory,
    error,
    triggerDeploy,
    refreshHistory,
    clearStatus,
  } = useDeploy();

  const [targets, setTargets] = useState<Set<DeployTarget>>(new Set(["worker"]));
  const [bumpType, setBumpType] = useState<BumpType>("none");
  const [dryRun, setDryRun] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const toggleTarget = (target: DeployTarget): void => {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  };

  const handleDeploy = async (): Promise<void> => {
    setShowConfirm(false);
    if (targets.size === 0) return;
    await triggerDeploy({
      targets: Array.from(targets),
      bumpType,
      dryRun,
      changeSummary,
    });
  };

  const handleDeployClick = (): void => {
    if (dryRun) {
      // Dry runs skip confirmation
      void handleDeploy();
    } else {
      setShowConfirm(true);
    }
  };

  const canDeploy = targets.size > 0 && !isTriggering && !isPolling;
  const showNpmBump = targets.has("npm");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Deploy Pipeline</h1>
        {isPolling && (
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-sm text-blue-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            Polling status...
          </span>
        )}
      </div>

      {/* Dry Run Banner */}
      {dryRun && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-yellow-300">
          DRY RUN MODE - No actual deployments will be executed
        </div>
      )}

      {/* Error Display */}
      {error !== null && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={clearStatus}
              className="text-sm text-red-400 underline hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="rounded-lg border border-red-500/50 bg-red-900/30 px-6 py-4">
          <p className="mb-3 text-sm font-medium text-red-200">
            This will push changes to all users. Are you sure you want to continue?
          </p>
          <p className="mb-4 text-xs text-red-300/70">
            Targets: {Array.from(targets).join(", ")}
            {showNpmBump && bumpType !== "none" ? ` | Version bump: ${bumpType}` : ""}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => void handleDeploy()}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
            >
              Yes, Deploy Now
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-md bg-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Deploy Controls */}
      <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Deploy Configuration</h2>

        {/* Target Checkboxes */}
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-neutral-300">
            Deploy Targets
          </label>
          <div className="flex gap-4">
            {(["worker", "npm", "landing"] as DeployTarget[]).map((target) => (
              <label key={target} className="flex items-center gap-2 text-neutral-200">
                <input
                  type="checkbox"
                  checked={targets.has(target)}
                  onChange={() => toggleTarget(target)}
                  className="h-4 w-4 rounded border-neutral-600 bg-neutral-700"
                />
                <span className="capitalize">{target}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Bump Type (only when npm is selected) */}
        {showNpmBump && (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-neutral-300">
              Version Bump
            </label>
            <select
              value={bumpType}
              onChange={(e) => setBumpType(e.target.value as BumpType)}
              className="rounded-md border border-neutral-600 bg-neutral-700 px-3 py-2 text-white"
            >
              <option value="none">None</option>
              <option value="patch">Patch (0.0.x)</option>
              <option value="minor">Minor (0.x.0)</option>
              <option value="major">Major (x.0.0)</option>
            </select>
          </div>
        )}

        {/* Dry Run Toggle */}
        <div className="mb-4">
          <label className="flex items-center gap-2 text-neutral-200">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-600 bg-neutral-700"
            />
            <span>Dry run (no actual deploys)</span>
          </label>
        </div>

        {/* Change Summary */}
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-neutral-300">
            Change Summary
          </label>
          <textarea
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder="Describe what changed (e.g., 'Added 3D feature to pro tier')"
            rows={3}
            className="w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 py-2 text-white placeholder-neutral-500"
          />
        </div>

        {/* Deploy Button */}
        <button
          onClick={handleDeployClick}
          disabled={!canDeploy}
          className={`rounded-md px-6 py-2 font-semibold text-white transition ${
            canDeploy
              ? dryRun
                ? "bg-yellow-600 hover:bg-yellow-500"
                : "bg-green-600 hover:bg-green-500"
              : "cursor-not-allowed bg-neutral-600 text-neutral-400"
          }`}
        >
          {isTriggering
            ? "Triggering..."
            : dryRun
              ? "Dry Run Deploy"
              : "Deploy Live"}
        </button>
      </div>

      {/* Deploy Status */}
      {deployStatus !== null && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Deploy Status</h2>
            <a
              href={deployStatus.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:underline"
            >
              View on GitHub
            </a>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {deployStatus.jobs.map((job) => (
              <DeployStatusCard key={job.name} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Deploy History */}
      <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Deploy History</h2>
          <button
            onClick={() => void refreshHistory()}
            disabled={isLoadingHistory}
            className="text-sm text-blue-400 hover:underline"
          >
            {isLoadingHistory ? "Loading..." : "Refresh"}
          </button>
        </div>
        <DeployHistoryList entries={history} isLoading={isLoadingHistory} />
      </div>
    </div>
  );
}
