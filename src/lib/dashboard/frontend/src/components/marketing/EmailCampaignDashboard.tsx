/**
 * EmailCampaignDashboard Component
 *
 * Top-level orchestrator for the email campaign feature.
 * Combines the campaign list sidebar with the campaign editor, preview,
 * template selector, and delivery metrics panels.
 *
 * Layout:
 * - Left column: Campaign list + "New Campaign" button
 * - Right column: Editor form / Campaign detail view depending on selection
 *   - When creating: Editor form + Template selector + Live preview
 *   - When viewing a sent campaign: Preview + Delivery metrics
 *
 * @module components/marketing/EmailCampaignDashboard
 */

import { useCallback, useState } from "react";
import { useEmailCampaigns } from "../../hooks/useEmailCampaigns";
import type { SendBroadcastParams } from "../../hooks/useEmailCampaigns";
import { useEmailAudiences } from "../../hooks/useEmailAudiences";
import { useEmailTemplates } from "../../hooks/useEmailTemplates";
import { EmailCampaignList } from "./EmailCampaignList";
import { EmailCampaignEditor } from "./EmailCampaignEditor";
import { EmailPreviewPanel } from "./EmailPreviewPanel";
import { EmailMetricsPanel } from "./EmailMetricsPanel";
import { EmailTemplateSelector } from "./EmailTemplateSelector";
import type { EmailTemplate } from "../../types/marketing";
import { LoadingSpinner } from "../LoadingSpinner";

type ViewMode = "list" | "create" | "detail";

export function EmailCampaignDashboard(): JSX.Element {
  const {
    campaigns,
    loading: campaignsLoading,
    error: campaignsError,
    sendBroadcast,
  } = useEmailCampaigns();

  const {
    audiences,
    loading: audiencesLoading,
  } = useEmailAudiences();

  const {
    templates,
    loading: templatesLoading,
  } = useEmailTemplates();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Live preview state (updated by editor callbacks)
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewText, setPreviewText] = useState("");

  const selectedCampaign =
    selectedCampaignId !== null
      ? campaigns.find((c) => c.id === selectedCampaignId) ?? null
      : null;

  const handleSelectCampaign = useCallback((id: string): void => {
    setSelectedCampaignId(id);
    setViewMode("detail");

    // Load selected campaign data into preview
    const campaign = campaigns.find((c) => c.id === id);
    if (campaign) {
      setPreviewHtml(campaign.html);
      setPreviewSubject(campaign.subject);
      setPreviewText(campaign.previewText);
    }
  }, [campaigns]);

  const handleNewCampaign = useCallback((): void => {
    setSelectedCampaignId(null);
    setViewMode("create");
    setPreviewHtml("");
    setPreviewSubject("");
    setPreviewText("");
  }, []);

  const handleBackToList = useCallback((): void => {
    setViewMode("list");
    setSelectedCampaignId(null);
    setPreviewHtml("");
    setPreviewSubject("");
    setPreviewText("");
  }, []);

  const handleSend = useCallback(
    async (
      params: SendBroadcastParams
    ): Promise<{ success: boolean; error?: string }> => {
      const result = await sendBroadcast(params);
      if (result.success) {
        setViewMode("list");
      }
      return result;
    },
    [sendBroadcast]
  );

  const handleTemplateSelect = useCallback((template: EmailTemplate): void => {
    setPreviewHtml(template.html);
  }, []);

  // Loading state
  if (campaignsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="md" text="Loading email campaigns..." />
      </div>
    );
  }

  // Error state
  if (campaignsError) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/20 p-4">
        <p className="text-sm text-red-300">
          Failed to load email campaigns: {campaignsError.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-md border border-red-700 px-3 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      {/* Left column: Campaign list */}
      <div className="flex w-full flex-col gap-3 lg:w-72 lg:shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">
            Email Campaigns
          </h2>
          <button
            type="button"
            onClick={handleNewCampaign}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
            aria-label="Create new email campaign"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <EmailCampaignList
            campaigns={campaigns}
            selectedId={selectedCampaignId}
            onSelect={handleSelectCampaign}
          />
        </div>
      </div>

      {/* Right column: Content area */}
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
        {viewMode === "list" && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-gray-500">
                Select a campaign or create a new one
              </p>
              <button
                type="button"
                onClick={handleNewCampaign}
                className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
              >
                Create Campaign
              </button>
            </div>
          </div>
        )}

        {viewMode === "create" && (
          <>
            {/* Back button */}
            <button
              type="button"
              onClick={handleBackToList}
              className="text-xs text-gray-500 transition-colors hover:text-gray-300"
              aria-label="Back to campaign list"
            >
              &larr; Back to list
            </button>

            {/* Template selector (grid view) */}
            <EmailTemplateSelector
              templates={templates}
              loading={templatesLoading}
              selectedId={null}
              onSelect={(template) => {
                handleTemplateSelect(template);
                // Handled by editor
              }}
            />

            {/* Two-column layout: Editor + Preview */}
            <div className="grid gap-4 xl:grid-cols-2">
              <EmailCampaignEditor
                audiences={audiences}
                audiencesLoading={audiencesLoading}
                templates={templates}
                templatesLoading={templatesLoading}
                onSend={handleSend}
                onTemplateSelect={handleTemplateSelect}
                onHtmlChange={setPreviewHtml}
                onSubjectChange={setPreviewSubject}
                onPreviewTextChange={setPreviewText}
              />

              <EmailPreviewPanel
                html={previewHtml}
                subject={previewSubject}
                previewText={previewText}
              />
            </div>
          </>
        )}

        {viewMode === "detail" && selectedCampaign !== null && (
          <>
            {/* Back button */}
            <button
              type="button"
              onClick={handleBackToList}
              className="text-xs text-gray-500 transition-colors hover:text-gray-300"
              aria-label="Back to campaign list"
            >
              &larr; Back to list
            </button>

            {/* Campaign detail header */}
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-100">
                    {selectedCampaign.name || selectedCampaign.subject}
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">
                    From: {selectedCampaign.from}
                    {" \u00b7 "}
                    Segment: {selectedCampaign.segmentName}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    selectedCampaign.status === "sent"
                      ? "bg-green-600 text-green-300"
                      : selectedCampaign.status === "sending"
                        ? "bg-blue-600 text-blue-300 animate-pulse"
                        : selectedCampaign.status === "scheduled"
                          ? "bg-yellow-600 text-yellow-300"
                          : "bg-gray-600 text-gray-300"
                  }`}
                >
                  {selectedCampaign.status.charAt(0).toUpperCase() +
                    selectedCampaign.status.slice(1)}
                </span>
              </div>
            </div>

            {/* Preview */}
            <EmailPreviewPanel
              html={selectedCampaign.html}
              subject={selectedCampaign.subject}
              previewText={selectedCampaign.previewText}
            />

            {/* Metrics (only for sent campaigns) */}
            {(selectedCampaign.status === "sent" ||
              selectedCampaign.status === "sending") && (
              <EmailMetricsPanel metrics={selectedCampaign.metrics} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
