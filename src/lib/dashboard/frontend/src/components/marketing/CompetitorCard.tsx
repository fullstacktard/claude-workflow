/**
 * CompetitorCard Component
 *
 * Individual card showing competitor handle, follower count,
 * engagement metrics, category badge, and action buttons.
 *
 * @module components/marketing/CompetitorCard
 */

import { RefreshCw, Trash2 } from "lucide-react";
import type { Competitor } from "../../types/marketing";
import {
  CATEGORY_BADGE_COLORS,
  CATEGORY_LABELS,
  formatMetricCount,
  formatRelativeTime,
} from "../../types/marketing";

interface CompetitorCardProps {
  competitor: Competitor;
  onScrape: (handle: string) => void;
  onRemove: (id: string) => void;
  isScraping: boolean;
}

export function CompetitorCard({
  competitor,
  onScrape,
  onRemove,
  isScraping,
}: CompetitorCardProps): JSX.Element {
  const badgeColor = CATEGORY_BADGE_COLORS[competitor.category];
  const categoryLabel = CATEGORY_LABELS[competitor.category];

  return (
    <div className="w-full bg-gray-900/50 rounded-md p-3 border border-gray-800/50 hover:border-gray-600 transition-colors">
      {/* Row 1: Handle + Category badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-white text-sm font-medium truncate">
            @{competitor.handle}
          </span>
          {competitor.followerCount !== null && (
            <span className="text-gray-500 text-xs shrink-0">
              {formatMetricCount(competitor.followerCount)} followers
            </span>
          )}
        </div>
        <span
          className={`text-xs px-1.5 py-px rounded-full ${badgeColor} text-white shrink-0`}
        >
          {categoryLabel}
        </span>
      </div>

      {/* Row 2: Engagement metrics */}
      {competitor.engagement && (
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
          <span title="Avg likes">
            {formatMetricCount(competitor.engagement.avgLikes)} likes
          </span>
          <span title="Avg replies">
            {formatMetricCount(competitor.engagement.avgReplies)} replies
          </span>
          <span title="Avg retweets">
            {formatMetricCount(competitor.engagement.avgRetweets)} RTs
          </span>
        </div>
      )}

      {/* Row 3: Last scraped + Actions */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-gray-500 text-xs">
          Scraped: {formatRelativeTime(competitor.lastScrapedAt)}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onScrape(competitor.handle)}
            disabled={isScraping}
            className="p-1.5 text-gray-400 hover:text-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded focus:outline-none focus:ring-2 focus:ring-red-600"
            title="Scrape now"
            aria-label={`Scrape @${competitor.handle}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(competitor.id)}
            className="p-1.5 text-gray-400 hover:text-red-400 transition-colors rounded focus:outline-none focus:ring-2 focus:ring-red-600"
            title="Remove competitor"
            aria-label={`Remove @${competitor.handle}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
