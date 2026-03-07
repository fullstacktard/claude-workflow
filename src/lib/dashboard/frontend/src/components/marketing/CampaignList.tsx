/**
 * CampaignList Component
 *
 * Renders a list of campaign cards with status badges, platform icons,
 * date range, and post count. Supports selection via callback.
 *
 * Status badge colors:
 * - draft: grey
 * - active: green with pulse animation
 * - completed: blue
 *
 * @module components/marketing/CampaignList
 */

import type { CampaignSummary } from "../../hooks/useCampaigns";

interface CampaignListProps {
  campaigns: CampaignSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_STYLES: Record<
  CampaignSummary["status"],
  { bg: string; text: string; label: string }
> = {
  draft: { bg: "bg-gray-600", text: "text-gray-300", label: "Draft" },
  active: { bg: "bg-green-600 animate-pulse", text: "text-green-300", label: "Active" },
  completed: { bg: "bg-blue-600", text: "text-blue-300", label: "Completed" },
};

const PLATFORM_ICONS: Record<string, string> = {
  x: "X",
  linkedin: "in",
  email: "@",
};

export function CampaignList({
  campaigns,
  selectedId,
  onSelect,
}: CampaignListProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {campaigns.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">No campaigns yet</p>
      ) : (
        campaigns.map((campaign) => {
          const isSelected = campaign.id === selectedId;
          const status = STATUS_STYLES[campaign.status];
          const postCount = Object.values(campaign.post_ids).filter(Boolean).length;

          return (
            <button
              key={campaign.id}
              onClick={() => onSelect(campaign.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? "border-blue-500 bg-blue-900/20"
                  : "border-gray-700 bg-gray-900 hover:border-gray-600"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium text-gray-200">
                  {campaign.name}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${status.bg} ${status.text}`}
                >
                  {status.label}
                </span>
              </div>

              {/* Platform icons row */}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex gap-1">
                  {campaign.platforms.map((p) => (
                    <span
                      key={p}
                      className="inline-flex h-5 w-5 items-center justify-center rounded bg-gray-800 text-xs text-gray-400"
                      title={p}
                    >
                      {PLATFORM_ICONS[p] ?? p.charAt(0)}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-gray-600">
                  {postCount}/{campaign.platforms.length} posts
                </span>
              </div>

              {/* Date range */}
              <p className="mt-1 text-xs text-gray-600">
                {campaign.start_date
                  ? `${new Date(campaign.start_date).toLocaleDateString()}${
                      campaign.end_date
                        ? ` - ${new Date(campaign.end_date).toLocaleDateString()}`
                        : ""
                    }`
                  : `Created ${new Date(campaign.created_at).toLocaleDateString()}`}
              </p>
            </button>
          );
        })
      )}
    </div>
  );
}
