/**
 * SubscriberTable Component
 *
 * Displays a paginated table of subscribers with email, tier, status,
 * start date, and MRR columns. Includes loading skeleton and empty state.
 * Rows are clickable to open the subscriber detail panel.
 */

import { useCallback, type JSX } from "react";
import type { Subscription } from "../../types/admin";

interface SubscriberTableProps {
  subscriptions: Subscription[];
  loading: boolean;
  onRowClick: (subscription: Subscription) => void;
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function SubscriberTable({
  subscriptions,
  loading,
  onRowClick,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: SubscriberTableProps): JSX.Element {
  const totalPages = Math.ceil(totalCount / pageSize);

  const formatCurrency = useCallback((amountCents: number, currency: string): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  }, []);

  const formatDate = useCallback((isoDate: string | null): string => {
    if (!isoDate) return "--";
    return new Date(isoDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  if (loading) {
    return <SubscriberTableSkeleton rows={pageSize} />;
  }

  if (subscriptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <svg
          className="mb-4 h-12 w-12 text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <p className="text-sm">No subscribers found</p>
        <p className="mt-1 text-xs text-gray-500">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-red-800/50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                Tier
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                Start Date
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-400">
                MRR
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-800/30">
            {subscriptions.map((sub) => (
              <tr
                key={sub.id}
                onClick={() => onRowClick(sub)}
                className="cursor-pointer transition-colors hover:bg-gray-800/50"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(sub);
                  }
                }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={sub.customer.avatar_url}
                      alt=""
                      className="h-8 w-8 rounded-full bg-gray-800"
                    />
                    <div>
                      <p className="font-medium text-gray-100">{sub.customer.email}</p>
                      {sub.customer.name && (
                        <p className="text-xs text-gray-500">{sub.customer.name}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <TierBadge tierName={sub.product.name} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge
                    status={sub.status}
                    cancelAtPeriodEnd={sub.cancel_at_period_end}
                  />
                </td>
                <td className="px-4 py-3 text-gray-300">{formatDate(sub.started_at)}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-100">
                  {formatCurrency(sub.amount, sub.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-red-800/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <label htmlFor="page-size-select" className="sr-only">
            Rows per page
          </label>
          <span>Rows per page:</span>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="select-chevron rounded border border-red-800/50 bg-gray-800 px-2 py-1 pr-8 text-sm text-gray-300"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>
            {totalCount > 0
              ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalCount)} of ${totalCount}`
              : "0 results"}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded border border-red-800/50 bg-gray-800 px-3 py-1 text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous page"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="rounded border border-red-800/50 bg-gray-800 px-3 py-1 text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Badge sub-components ---

function StatusBadge({
  status,
  cancelAtPeriodEnd,
}: {
  status: string;
  cancelAtPeriodEnd: boolean;
}): JSX.Element {
  const config: Record<string, { label: string; className: string }> = {
    active: {
      label: cancelAtPeriodEnd ? "Canceling" : "Active",
      className: cancelAtPeriodEnd
        ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-400"
        : "border-green-400/30 bg-green-400/10 text-green-400",
    },
    canceled: {
      label: "Canceled",
      className: "border-gray-500/30 bg-gray-500/10 text-gray-400",
    },
    past_due: {
      label: "Past Due",
      className: "border-yellow-400/30 bg-yellow-400/10 text-yellow-400",
    },
    trialing: {
      label: "Trial",
      className: "border-blue-400/30 bg-blue-400/10 text-blue-400",
    },
    unpaid: {
      label: "Unpaid",
      className: "border-red-400/30 bg-red-400/10 text-red-400",
    },
    incomplete: {
      label: "Incomplete",
      className: "border-gray-500/30 bg-gray-500/10 text-gray-400",
    },
  };
  const { label, className } = config[status] ?? {
    label: status,
    className: "border-gray-500/30 bg-gray-500/10 text-gray-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function TierBadge({ tierName }: { tierName: string }): JSX.Element {
  const tierClass: Record<string, string> = {
    Pro: "border-red-400/30 bg-red-400/10 text-red-400",
    All: "border-purple-400/30 bg-purple-400/10 text-purple-400",
    Free: "border-gray-500/30 bg-gray-500/10 text-gray-400",
  };
  const className =
    tierClass[tierName] ?? "border-gray-500/30 bg-gray-500/10 text-gray-400";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {tierName}
    </span>
  );
}

function SubscriberTableSkeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading subscribers">
      <div className="flex gap-4 border-b border-red-800/50 px-4 py-3">
        {[120, 60, 70, 80, 60].map((w, i) => (
          <div key={i} className="h-4 rounded bg-gray-800" style={{ width: `${w}px` }} />
        ))}
      </div>
      {Array.from({ length: Math.min(rows, 10) }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-red-800/20 px-4 py-4"
        >
          <div className="h-8 w-8 rounded-full bg-gray-800" />
          <div className="h-4 w-40 rounded bg-gray-800" />
          <div className="h-5 w-12 rounded-full bg-gray-800" />
          <div className="h-5 w-14 rounded-full bg-gray-800" />
          <div className="h-4 w-20 rounded bg-gray-800" />
          <div className="ml-auto h-4 w-16 rounded bg-gray-800" />
        </div>
      ))}
      <span className="sr-only">Loading subscribers...</span>
    </div>
  );
}
