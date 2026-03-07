/**
 * EmailCampaignList Component
 *
 * Renders a scrollable list of email campaigns with status badges.
 * Each item is a button that selects the campaign for detail view.
 *
 * Status badge colors:
 * - draft: grey
 * - sending: blue with pulse animation
 * - sent: green
 * - scheduled: yellow
 *
 * @module components/marketing/EmailCampaignList
 */

import type { EmailCampaign } from "../../types/marketing";
import { CAMPAIGN_STATUS_STYLES } from "../../types/marketing";

interface EmailCampaignListProps {
  campaigns: EmailCampaign[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function EmailCampaignList({
  campaigns,
  selectedId,
  onSelect,
}: EmailCampaignListProps): JSX.Element {
  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-gray-500">No email campaigns yet</p>
        <p className="mt-1 text-xs text-gray-600">
          Create your first campaign to get started
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {campaigns.map((campaign) => {
        const isSelected = campaign.id === selectedId;
        const status = CAMPAIGN_STATUS_STYLES[campaign.status];

        return (
          <button
            key={campaign.id}
            type="button"
            onClick={() => onSelect(campaign.id)}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              isSelected
                ? "border-blue-500 bg-blue-900/20"
                : "border-gray-700 bg-gray-900 hover:border-gray-600"
            }`}
            aria-pressed={isSelected}
            aria-label={`Campaign: ${campaign.name || campaign.subject}, status: ${status.label}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-gray-200">
                {campaign.name || campaign.subject}
              </span>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${status.bg} ${status.text}`}
              >
                {status.label}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-gray-500">{campaign.subject}</p>
            <p className="mt-0.5 text-xs text-gray-600">
              {campaign.segmentName}
              {" \u00b7 "}
              {campaign.sentAt
                ? `Sent ${new Date(campaign.sentAt).toLocaleDateString()}`
                : campaign.scheduledAt
                  ? `Scheduled ${new Date(campaign.scheduledAt).toLocaleDateString()}`
                  : `Created ${new Date(campaign.createdAt).toLocaleDateString()}`}
            </p>
          </button>
        );
      })}
    </div>
  );
}
