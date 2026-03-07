/**
 * PhoneFleetTable - Table view for GeeLark cloud phone fleet management.
 *
 * Columns: Serial/Name, Status (color-coded badge), Proxy, Billing timer,
 * Associated account handle, Action buttons (Start, Stop, Screenshot, Destroy).
 *
 * Action buttons are state-aware:
 * - Start: only for Stopped phones
 * - Stop: only for Running phones
 * - Screenshot: only for Running phones
 * - Destroy: only for Stopped or Expired phones
 */
import { Camera, Play, Square, Trash2 } from "lucide-react";

import type { GeeLarkPhone, PhoneStatusValue } from "../../types/x-accounts";

/** Status configuration: label, color class, and animation state */
const STATUS_CONFIG: Record<
  PhoneStatusValue,
  { label: string; colorClass: string; pulse: boolean }
> = {
  0: { label: "Running", colorClass: "bg-green-500", pulse: true },
  1: { label: "Starting...", colorClass: "bg-blue-500", pulse: true },
  2: { label: "Stopped", colorClass: "bg-gray-500", pulse: false },
  3: { label: "Expired", colorClass: "bg-red-500", pulse: false },
};

/** Renders a color-coded status badge with optional pulse animation */
function StatusBadge({ status }: { status: PhoneStatusValue }): JSX.Element {
  const config = STATUS_CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white">
      <span
        className={`h-2 w-2 rounded-full ${config.colorClass} ${
          config.pulse ? "animate-pulse" : ""
        }`}
      />
      {config.label}
    </span>
  );
}

/**
 * Formats elapsed billing time and estimated cost.
 * Rate: ~$0.06/min ($3.60/hr).
 */
function formatBillingTime(startedAt: string | null): string {
  if (!startedAt) return "--";
  const elapsed = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / 1000
  );
  const clamped = Math.max(0, elapsed);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  const cost = (clamped / 60) * 0.06;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s | $${cost.toFixed(2)}`;
}

interface PhoneFleetTableProps {
  /** List of phones to display */
  phones: GeeLarkPhone[];
  /** Called when user wants to start a stopped phone */
  onStart: (phoneId: string) => void;
  /** Called when user wants to stop a running phone */
  onStop: (phoneId: string) => void;
  /** Called when user wants to destroy a stopped/expired phone */
  onDestroy: (phoneId: string) => void;
  /** Called when user wants to take a screenshot of a running phone */
  onScreenshot: (phoneId: string) => void;
  /** Set of phone IDs currently performing an action (disables buttons) */
  loadingActions: Set<string>;
}

export function PhoneFleetTable({
  phones,
  onStart,
  onStop,
  onDestroy,
  onScreenshot,
  loadingActions,
}: PhoneFleetTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-800 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Serial / Name</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Proxy</th>
            <th className="px-3 py-2">Billing</th>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {phones.map((phone) => {
            const isRunning = phone.status === 0;
            const isStopped = phone.status === 2;
            const isExpired = phone.status === 3;
            const isStarting = phone.status === 1;
            const isLoading = loadingActions.has(phone.id);

            return (
              <tr
                key={phone.id}
                className="transition-colors hover:bg-gray-900/50"
              >
                <td className="px-3 py-2.5 font-mono text-xs text-white">
                  {phone.serialName || phone.serialNo}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={phone.status} />
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-400">
                  {phone.proxy
                    ? `${phone.proxy.server}:${phone.proxy.port}`
                    : "--"}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-400">
                  {isRunning ? formatBillingTime(phone.startedAt) : "--"}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-400">
                  {phone.associatedHandle ? (
                    <span className="text-blue-400">
                      @{phone.associatedHandle}
                    </span>
                  ) : (
                    "--"
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      disabled={!isStopped || isLoading}
                      onClick={() => onStart(phone.id)}
                      className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-green-400 disabled:cursor-not-allowed disabled:opacity-30"
                      title={
                        isStopped
                          ? "Start phone"
                          : "Phone must be stopped to start"
                      }
                      aria-label={`Start phone ${phone.serialName || phone.serialNo}`}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!isRunning || isLoading}
                      onClick={() => onStop(phone.id)}
                      className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-yellow-400 disabled:cursor-not-allowed disabled:opacity-30"
                      title={
                        isRunning
                          ? "Stop phone"
                          : "Phone must be running to stop"
                      }
                      aria-label={`Stop phone ${phone.serialName || phone.serialNo}`}
                    >
                      <Square className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!isRunning || isLoading}
                      onClick={() => onScreenshot(phone.id)}
                      className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-30"
                      title={
                        isRunning
                          ? "Take screenshot"
                          : "Phone must be running for screenshot"
                      }
                      aria-label={`Screenshot phone ${phone.serialName || phone.serialNo}`}
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={
                        (!isStopped && !isExpired) || isStarting || isLoading
                      }
                      onClick={() => onDestroy(phone.id)}
                      className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                      title={
                        isStopped || isExpired
                          ? "Destroy phone"
                          : "Stop the phone before deleting"
                      }
                      aria-label={`Destroy phone ${phone.serialName || phone.serialNo}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {phones.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-gray-500">No cloud phones found</p>
        </div>
      )}
    </div>
  );
}
