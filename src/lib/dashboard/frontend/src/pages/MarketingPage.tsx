/**
 * MarketingPage Component
 *
 * Main page for the marketing agent system. Provides three top-level sections:
 * 1. Campaigns: Master-detail layout with campaign list (left) and detail/create (right)
 * 2. Email: Email campaign dashboard with creation flow, templates, preview, and metrics
 * 3. Marketing Tools: Full-width CompetitorPanel with competitors, brand voice, content tabs
 *
 * The Campaigns section uses the same 12-column grid layout as XAccountsPage:
 * - Left panel (lg:col-span-4): Campaign list with create button
 * - Right panel (lg:col-span-8): Campaign detail view or create form
 *
 * @module pages/MarketingPage
 */

import { useCallback, useState } from "react";

import { useCompetitors } from "../hooks/useCompetitors";
import { useCampaigns } from "../hooks/useCampaigns";
import { useCampaignDetail } from "../hooks/useCampaignDetail";
import { CompetitorPanel } from "../components/marketing/CompetitorPanel";
import { CampaignList } from "../components/marketing/CampaignList";
import { CampaignDetailView } from "../components/marketing/CampaignDetail";
import { CampaignCreateForm } from "../components/marketing/CampaignCreateForm";
import { EmailCampaignDashboard } from "../components/marketing/EmailCampaignDashboard";
import { TerminalCard } from "../components/TerminalCard";
import { dashboardFetch } from "../utils/dashboard-fetch";
import type { AddCompetitorFormData } from "../types/marketing";

type PageTab = "campaigns" | "email" | "tools";

const TAB_CONFIG: Array<{ id: PageTab; label: string }> = [
  { id: "campaigns", label: "Campaigns" },
  { id: "email", label: "Email" },
  { id: "tools", label: "Marketing Tools" },
];

export function MarketingPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<PageTab>("campaigns");

  // ── Competitors state ──
  const { competitors, loading, error, refetch } = useCompetitors();

  const handleAddCompetitor = useCallback(
    async (data: AddCompetitorFormData): Promise<void> => {
      const response = await dashboardFetch("/api/marketing/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to add competitor");
      }
      await refetch();
    },
    [refetch]
  );

  const handleRemoveCompetitor = useCallback(
    async (id: string): Promise<void> => {
      const response = await dashboardFetch(`/api/marketing/competitors/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to remove competitor");
      }
      await refetch();
    },
    [refetch]
  );

  const handleScrapeCompetitor = useCallback(
    async (handle: string): Promise<void> => {
      const response = await dashboardFetch(
        `/api/marketing/competitors/${handle}/scrape`,
        { method: "POST", timeoutMs: 30_000 }
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Scrape failed");
      }
      await refetch();
    },
    [refetch]
  );

  const handleScrapeAll = useCallback(async (): Promise<void> => {
    const response = await dashboardFetch(
      "/api/marketing/competitors/scrape-all",
      { method: "POST", timeoutMs: 60_000 }
    );
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? "Scrape all failed");
    }
    await refetch();
  }, [refetch]);

  // ── Campaigns state ──
  const {
    campaigns,
    loading: campaignsLoading,
    error: campaignsError,
    createCampaign,
    updateCampaign,
  } = useCampaigns();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const {
    campaign: selectedCampaign,
    analytics: campaignAnalytics,
    loading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useCampaignDetail(selectedCampaignId);

  const handleCreateCampaign = useCallback(
    async (params: {
      name: string;
      platforms: string[];
      description?: string;
      goal?: string;
      start_date?: string;
      end_date?: string;
      auto_create_posts?: boolean;
      post_content?: string;
    }): Promise<void> => {
      const result = await createCampaign(params);
      if (result) {
        setShowCreateForm(false);
        setSelectedCampaignId(result.id);
      }
    },
    [createCampaign]
  );

  const handleStatusChange = useCallback(
    async (newStatus: "draft" | "active" | "completed"): Promise<void> => {
      if (!selectedCampaignId) return;
      await updateCampaign(selectedCampaignId, { status: newStatus });
      await refetchDetail();
    },
    [selectedCampaignId, updateCampaign, refetchDetail]
  );

  return (
    <div className="flex h-full flex-col bg-gray-950 p-3 sm:p-6 gap-3 overflow-hidden">
      {/* Tab navigation */}
      <div
        className="flex shrink-0 gap-1 rounded-lg border border-gray-700 bg-gray-900 p-1"
        role="tablist"
        aria-label="Marketing sections"
      >
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? "bg-gray-700 text-gray-200"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "campaigns" && (
        <div
          id="panel-campaigns"
          role="tabpanel"
          aria-labelledby="tab-campaigns"
          className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0"
        >
          {/* Left Panel: Campaign list */}
          <div className="lg:col-span-4 flex flex-col min-h-0">
            <TerminalCard
              command="ls"
              filename="campaigns/"
              headerText={`${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""}`}
              headerActions={
                <button
                  onClick={() => {
                    setShowCreateForm(true);
                    setSelectedCampaignId(null);
                  }}
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                >
                  + New
                </button>
              }
              className="flex-1 min-h-0"
            >
              {campaignsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-gray-500">Loading campaigns...</span>
                </div>
              ) : campaignsError ? (
                <div className="py-4 text-center text-sm text-red-400">
                  Error: {campaignsError.message}
                </div>
              ) : campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <p className="text-sm">No campaigns yet</p>
                  <button
                    onClick={() => {
                      setShowCreateForm(true);
                      setSelectedCampaignId(null);
                    }}
                    className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700"
                  >
                    Create your first campaign
                  </button>
                </div>
              ) : (
                <CampaignList
                  campaigns={campaigns}
                  selectedId={selectedCampaignId}
                  onSelect={(id) => {
                    setSelectedCampaignId(id);
                    setShowCreateForm(false);
                  }}
                />
              )}
            </TerminalCard>
          </div>

          {/* Right Panel: Detail or Create form */}
          <div className="lg:col-span-8 flex flex-col min-h-0">
            <TerminalCard
              command="cat"
              filename={
                showCreateForm
                  ? "new-campaign.json"
                  : selectedCampaign
                    ? `${selectedCampaign.name.toLowerCase().replace(/\s+/g, "-")}.json`
                    : "campaign-detail.json"
              }
              className="flex-1 min-h-0"
            >
              {showCreateForm ? (
                <CampaignCreateForm
                  onSubmit={handleCreateCampaign}
                  onCancel={() => setShowCreateForm(false)}
                />
              ) : detailLoading ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-gray-500">Loading campaign details...</span>
                </div>
              ) : detailError ? (
                <div className="py-4 text-center text-sm text-red-400">
                  Error: {detailError.message}
                </div>
              ) : selectedCampaign ? (
                <CampaignDetailView
                  campaign={selectedCampaign}
                  analytics={campaignAnalytics}
                  onStatusChange={(status) => void handleStatusChange(status)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <p className="text-sm">Select a campaign to view details</p>
                  <p className="mt-1 text-xs text-gray-600">
                    or click &quot;+ New&quot; to create one
                  </p>
                </div>
              )}
            </TerminalCard>
          </div>
        </div>
      )}

      {activeTab === "email" && (
        <div
          id="panel-email"
          role="tabpanel"
          aria-labelledby="tab-email"
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <EmailCampaignDashboard />
        </div>
      )}

      {activeTab === "tools" && (
        <div
          id="panel-tools"
          role="tabpanel"
          aria-labelledby="tab-tools"
          className="flex-1 min-h-0"
        >
          <CompetitorPanel
            competitors={competitors}
            loading={loading}
            error={error}
            onAddCompetitor={handleAddCompetitor}
            onRemoveCompetitor={handleRemoveCompetitor}
            onScrapeCompetitor={handleScrapeCompetitor}
            onScrapeAll={handleScrapeAll}
            className="h-full"
          />
        </div>
      )}
    </div>
  );
}
