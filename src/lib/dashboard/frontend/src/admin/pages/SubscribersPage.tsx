/**
 * SubscribersPage
 *
 * Main subscriber management page for the admin panel.
 * Provides searchable, filterable, paginated table of subscriptions
 * with a slide-over detail panel for viewing license keys and
 * managing revocations.
 */

import { useState, useEffect, useCallback, type JSX } from "react";
import { Search, X } from "lucide-react";
import { useSubscribers } from "../hooks/useSubscribers";
import { useLicenses } from "../hooks/useLicenses";
import { SubscriberTable } from "../components/subscribers/SubscriberTable";
import { SubscriberDetail } from "../components/subscribers/SubscriberDetail";
import type { Subscription } from "../types/admin";

/**
 * Debounce hook -- delays updating the output value until
 * the input has been stable for `delayMs` milliseconds.
 */
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type StatusFilter = "all" | "active" | "canceled" | "past_due";
type TierFilter = "all" | "Free" | "Pro" | "All";

export function SubscribersPage(): JSX.Element {
  // Search & filter state
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Detail panel state
  const [selectedSubscription, setSelectedSubscription] =
    useState<Subscription | null>(null);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, tierFilter, pageSize]);

  // Fetch subscribers
  const { subscriptions, totalCount, loading, error, refetch } = useSubscribers({
    search: debouncedSearch || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    productName: tierFilter === "all" ? undefined : tierFilter,
    page,
    limit: pageSize,
  });

  // Fetch licenses for selected subscriber
  const {
    licenses,
    loading: licensesLoading,
    revokeLicense,
    refetch: refetchLicenses,
  } = useLicenses(selectedSubscription?.customer_id ?? null);

  const handleRowClick = useCallback((sub: Subscription): void => {
    setSelectedSubscription(sub);
  }, []);

  const handleCloseDetail = useCallback((): void => {
    setSelectedSubscription(null);
  }, []);

  const handleRevoke = useCallback(
    async (licenseKeyId: string): Promise<void> => {
      await revokeLicense(licenseKeyId);
      void refetchLicenses();
    },
    [revokeLicense, refetchLicenses],
  );

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-100">Subscribers</h1>
        <p className="mt-1 text-sm text-gray-400">
          Manage subscriptions and license keys
        </p>
      </div>

      {/* Search and Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-md border border-red-800/50 bg-gray-900 py-2 pl-10 pr-8 text-sm text-gray-100 placeholder:text-gray-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-400/50"
            aria-label="Search subscribers by email"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
            className="select-chevron rounded-md border border-red-800/50 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-400/50"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="canceled">Canceled</option>
            <option value="past_due">Past Due</option>
          </select>

          <label htmlFor="tier-filter" className="sr-only">
            Filter by tier
          </label>
          <select
            id="tier-filter"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as TierFilter)}
            className="select-chevron rounded-md border border-red-800/50 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-400/50"
          >
            <option value="all">All Tiers</option>
            <option value="Free">Free</option>
            <option value="Pro">Pro</option>
            <option value="All">All</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="mb-4 flex items-center justify-between rounded-md border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-400"
          role="alert"
        >
          <span>Failed to load subscribers: {error.message}</span>
          <button
            onClick={() => void refetch()}
            className="text-xs text-red-400 underline hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Subscriber Table */}
      <div className="overflow-hidden rounded-lg border border-red-800/50 bg-gray-900">
        <SubscriberTable
          subscriptions={subscriptions}
          loading={loading}
          onRowClick={handleRowClick}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Detail Panel (slide-over) */}
      {selectedSubscription && (
        <SubscriberDetail
          subscription={selectedSubscription}
          licenses={licenses}
          licensesLoading={licensesLoading}
          onClose={handleCloseDetail}
          onRevoke={handleRevoke}
        />
      )}
    </div>
  );
}
