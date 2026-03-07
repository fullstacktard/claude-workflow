/**
 * DraftsPage Component
 *
 * Full draft review queue page with card grid layout, status filter tabs,
 * batch approve/reject, inline editing, optimistic updates with rollback,
 * and a toggle between grid and schedule timeline views.
 *
 * REST API: GET /api/drafts, PATCH /api/drafts/:id, POST /api/drafts/:id/approve,
 *           POST /api/drafts/:id/reject, POST /api/drafts/batch
 *
 * @module pages/DraftsPage
 */

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";

import { BatchActions } from "../components/drafts/BatchActions";
import { DraftCard } from "../components/drafts/DraftCard";
import { DraftFilters } from "../components/drafts/DraftFilters";
import { ScheduleTimeline } from "../components/drafts/ScheduleTimeline";
import { TerminalCard } from "../components/TerminalCard";
import { useConfirm } from "../contexts/ConfirmationContext";
import { useToast } from "../contexts/ToastContext";
import { useDrafts } from "../hooks/useDrafts";
import { usePersonas } from "../hooks/usePersonas";
import type { DraftFilterState, DraftStatus } from "../types/draft";
import { dashboardFetch } from "../utils/dashboard-fetch";

export function DraftsPage(): JSX.Element {
  const [filters, setFilters] = useState<DraftFilterState>({
    status: "all",
    personaId: null,
    dateRange: null,
  });
  const [viewMode, setViewMode] = useState<"grid" | "timeline">("grid");

  const { drafts, loading, error, setDrafts, refetch } = useDrafts(filters);
  const { personas } = usePersonas();
  const confirm = useConfirm();
  const { addToast } = useToast();

  // --- Single draft actions ---

  const handleApprove = useCallback(
    async (id: string): Promise<void> => {
      // Optimistic update
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: "approved" as DraftStatus, _optimistic: true } : d,
        ),
      );
      try {
        const res = await dashboardFetch(`/api/drafts/${id}/approve`, { method: "POST" });
        if (!res.ok) {
          const body = (await res.json()) as { message?: string };
          throw new Error(body.message ?? "Approve failed");
        }
        setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, _optimistic: false } : d)));
      } catch (err) {
        // Rollback
        setDrafts((prev) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, status: "pending" as DraftStatus, _optimistic: false }
              : d,
          ),
        );
        addToast(err instanceof Error ? err.message : "Failed to approve draft", "error");
      }
    },
    [setDrafts, addToast],
  );

  const handleReject = useCallback(
    async (id: string): Promise<void> => {
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: "rejected" as DraftStatus, _optimistic: true } : d,
        ),
      );
      try {
        const res = await dashboardFetch(`/api/drafts/${id}/reject`, { method: "POST" });
        if (!res.ok) {
          const body = (await res.json()) as { message?: string };
          throw new Error(body.message ?? "Reject failed");
        }
        setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, _optimistic: false } : d)));
      } catch (err) {
        setDrafts((prev) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, status: "pending" as DraftStatus, _optimistic: false }
              : d,
          ),
        );
        addToast(err instanceof Error ? err.message : "Failed to reject draft", "error");
      }
    },
    [setDrafts, addToast],
  );

  const handleEdit = useCallback(
    async (id: string, newText: string): Promise<void> => {
      try {
        const res = await dashboardFetch(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: newText }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { message?: string };
          addToast(body.message ?? "Failed to save edit", "error");
          return;
        }
        setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, text: newText } : d)));
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to save edit", "error");
      }
    },
    [setDrafts, addToast],
  );

  // --- Batch actions ---

  const handleBatchApprove = useCallback(async (): Promise<void> => {
    const pendingIds = drafts.filter((d) => d.status === "pending").map((d) => d.id);
    if (pendingIds.length === 0) return;

    const confirmed = await confirm({
      title: "Approve All Pending",
      message: `Approve ${pendingIds.length} pending draft(s)?`,
      confirmLabel: "Approve All",
      variant: "default",
    });
    if (!confirmed) return;

    // Optimistic batch update
    setDrafts((prev) =>
      prev.map((d) =>
        pendingIds.includes(d.id)
          ? { ...d, status: "approved" as DraftStatus, _optimistic: true }
          : d,
      ),
    );
    try {
      const res = await dashboardFetch("/api/drafts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", ids: pendingIds }),
      });
      if (!res.ok) throw new Error("Batch approve failed");
      setDrafts((prev) =>
        prev.map((d) => (pendingIds.includes(d.id) ? { ...d, _optimistic: false } : d)),
      );
      addToast(`${pendingIds.length} drafts approved`, "success");
    } catch {
      setDrafts((prev) =>
        prev.map((d) =>
          pendingIds.includes(d.id)
            ? { ...d, status: "pending" as DraftStatus, _optimistic: false }
            : d,
        ),
      );
      addToast("Batch approve failed", "error");
    }
  }, [drafts, setDrafts, confirm, addToast]);

  const handleBatchReject = useCallback(async (): Promise<void> => {
    const pendingIds = drafts.filter((d) => d.status === "pending").map((d) => d.id);
    if (pendingIds.length === 0) return;

    const confirmed = await confirm({
      title: "Reject All Pending",
      message: `Reject ${pendingIds.length} pending draft(s)? This cannot be undone.`,
      confirmLabel: "Reject All",
      variant: "destructive",
    });
    if (!confirmed) return;

    setDrafts((prev) =>
      prev.map((d) =>
        pendingIds.includes(d.id)
          ? { ...d, status: "rejected" as DraftStatus, _optimistic: true }
          : d,
      ),
    );
    try {
      const res = await dashboardFetch("/api/drafts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", ids: pendingIds }),
      });
      if (!res.ok) throw new Error("Batch reject failed");
      setDrafts((prev) =>
        prev.map((d) => (pendingIds.includes(d.id) ? { ...d, _optimistic: false } : d)),
      );
      addToast(`${pendingIds.length} drafts rejected`, "success");
    } catch {
      setDrafts((prev) =>
        prev.map((d) =>
          pendingIds.includes(d.id)
            ? { ...d, status: "pending" as DraftStatus, _optimistic: false }
            : d,
        ),
      );
      addToast("Batch reject failed", "error");
    }
  }, [drafts, setDrafts, confirm, addToast]);

  // --- Derived state ---

  const pendingCount = drafts.filter((d) => d.status === "pending").length;
  const filteredDrafts =
    filters.status === "all" ? drafts : drafts.filter((d) => d.status === filters.status);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden bg-gray-950 p-3 sm:p-6">
      <TerminalCard
        command="ls"
        filename="drafts/ --pending"
        headerText={`${filteredDrafts.length} drafts${filters.status !== "all" ? ` (${filters.status})` : ""}`}
        headerActions={
          <div className="flex items-center gap-2">
            <button
              onClick={(): void => void refetch()}
              className="text-xs text-gray-400 transition-colors hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              title="Refresh drafts"
              aria-label="Refresh drafts"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={(): void => setViewMode(viewMode === "grid" ? "timeline" : "grid")}
              className="text-xs text-gray-400 transition-colors hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              aria-label={`Switch to ${viewMode === "grid" ? "timeline" : "grid"} view`}
            >
              {viewMode === "grid" ? "Timeline" : "Grid"}
            </button>
          </div>
        }
        className="min-h-0 flex-1"
        noPadding
      >
        <div className="flex h-full min-h-0 flex-col">
          {/* Filter bar */}
          <DraftFilters
            filters={filters}
            onFiltersChange={setFilters}
            personas={personas.map((p) => ({ id: p.id, name: p.name }))}
          />

          {/* Batch actions */}
          <BatchActions
            pendingCount={pendingCount}
            onBatchApprove={handleBatchApprove}
            onBatchReject={handleBatchReject}
          />

          {/* Content area */}
          <div className="min-h-0 flex-1 overflow-auto p-4" id="draft-grid" role="tabpanel">
            {/* Loading state */}
            {loading && (
              <div className="flex h-32 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-red-400" />
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="py-4 text-center">
                <p className="text-sm text-red-400">Error loading drafts: {error.message}</p>
                <button
                  onClick={(): void => void refetch()}
                  className="mt-2 rounded border border-red-800/50 px-3 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/20 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/50"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Grid view */}
            {!loading && !error && viewMode === "grid" && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {filteredDrafts.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onEdit={handleEdit}
                  />
                ))}
                {filteredDrafts.length === 0 && (
                  <div className="col-span-full py-8 text-center text-sm text-gray-500">
                    No drafts found for current filters.
                  </div>
                )}
              </div>
            )}

            {/* Timeline view */}
            {!loading && !error && viewMode === "timeline" && (
              <ScheduleTimeline drafts={filteredDrafts} />
            )}
          </div>
        </div>
      </TerminalCard>
    </div>
  );
}
