/**
 * CampaignDetailView Component
 *
 * Renders the full campaign detail panel including:
 * - Campaign header with name, goal, description, and status action buttons
 * - Linked posts timeline grouped by platform (X -> LinkedIn -> Email)
 * - Aggregate campaign metrics panel with per-platform breakdown
 *
 * Status actions use a two-click confirmation pattern:
 * - First click shows "Confirm ..." label
 * - Second click executes the status transition
 *
 * @module components/marketing/CampaignDetail
 */

import { useState } from "react";
import type { CampaignDetail as CampaignDetailType } from "../../hooks/useCampaignDetail";
import type { CampaignAnalytics, LinkedPost } from "../../hooks/useCampaignDetail";

interface CampaignDetailProps {
  campaign: CampaignDetailType;
  analytics: CampaignAnalytics | null;
  onStatusChange: (status: "draft" | "active" | "completed") => void;
}

const POST_STATUS_COLORS: Record<string, string> = {
  draft: "text-gray-400 bg-gray-600",
  approved: "text-yellow-300 bg-yellow-600",
  scheduled: "text-amber-300 bg-amber-600",
  publishing: "text-blue-300 bg-blue-600 animate-pulse",
  published: "text-green-300 bg-green-600",
  failed: "text-red-300 bg-red-600",
};

const PLATFORM_LABELS: Record<string, { name: string; color: string }> = {
  x: { name: "X / Twitter", color: "border-l-blue-500" },
  linkedin: { name: "LinkedIn", color: "border-l-sky-500" },
  email: { name: "Email", color: "border-l-emerald-500" },
};

export function CampaignDetailView({
  campaign,
  analytics,
  onStatusChange,
}: CampaignDetailProps): JSX.Element {
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  const handleStatusAction = (newStatus: "draft" | "active" | "completed"): void => {
    if (showConfirm === newStatus) {
      onStatusChange(newStatus);
      setShowConfirm(null);
    } else {
      setShowConfirm(newStatus);
    }
  };

  // Group linked posts by platform in display order
  const platformOrder: Array<"x" | "linkedin" | "email"> = ["x", "linkedin", "email"];
  const postsByPlatform = new Map<string, LinkedPost>();
  for (const post of campaign.linked_posts ?? []) {
    postsByPlatform.set(post.platform, post);
  }

  return (
    <div className="space-y-4">
      {/* Campaign Header */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{campaign.name}</h2>
            {campaign.goal && (
              <p className="mt-1 text-sm text-gray-400">Goal: {campaign.goal}</p>
            )}
            {campaign.description && (
              <p className="mt-1 text-sm text-gray-500">{campaign.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            {campaign.status === "draft" && (
              <button
                onClick={() => handleStatusAction("active")}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                  showConfirm === "active"
                    ? "bg-green-600 text-white"
                    : "border border-green-600 text-green-400 hover:bg-green-900/30"
                }`}
              >
                {showConfirm === "active" ? "Confirm Activate" : "Activate"}
              </button>
            )}
            {campaign.status === "active" && (
              <>
                <button
                  onClick={() => handleStatusAction("completed")}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    showConfirm === "completed"
                      ? "bg-blue-600 text-white"
                      : "border border-blue-600 text-blue-400 hover:bg-blue-900/30"
                  }`}
                >
                  {showConfirm === "completed" ? "Confirm Complete" : "Complete"}
                </button>
                <button
                  onClick={() => handleStatusAction("draft")}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    showConfirm === "draft"
                      ? "bg-gray-600 text-white"
                      : "border border-gray-600 text-gray-400 hover:bg-gray-800/50"
                  }`}
                >
                  {showConfirm === "draft" ? "Confirm Revert" : "Revert to Draft"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Date range row */}
        {(campaign.start_date || campaign.end_date) && (
          <div className="mt-3 flex items-center gap-4 border-t border-gray-800 pt-3 text-xs text-gray-500">
            {campaign.start_date && (
              <span>Start: {new Date(campaign.start_date).toLocaleDateString()}</span>
            )}
            {campaign.end_date && (
              <span>End: {new Date(campaign.end_date).toLocaleDateString()}</span>
            )}
          </div>
        )}
      </div>

      {/* Linked Posts Timeline */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-300">Platform Posts</h3>
        <div className="space-y-3">
          {platformOrder
            .filter((p) => campaign.platforms.includes(p))
            .map((platform) => {
              const post = postsByPlatform.get(platform);
              const info = PLATFORM_LABELS[platform] ?? {
                name: platform,
                color: "border-l-gray-500",
              };

              return (
                <div
                  key={platform}
                  className={`rounded-lg border border-gray-800 border-l-4 ${info.color} bg-gray-950 p-3`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-300">{info.name}</span>
                    {post ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          POST_STATUS_COLORS[post.status] ?? POST_STATUS_COLORS.draft
                        }`}
                      >
                        {post.status}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">No post linked</span>
                    )}
                  </div>
                  {post && (
                    <>
                      <p className="mt-2 line-clamp-3 text-sm text-gray-400">
                        {post.content}
                      </p>
                      {post.engagement_metrics && post.status === "published" && (
                        <div className="mt-2 flex gap-3 text-xs text-gray-600">
                          {post.engagement_metrics.impressions != null && (
                            <span>
                              {post.engagement_metrics.impressions.toLocaleString()} views
                            </span>
                          )}
                          {post.engagement_metrics.likes != null && (
                            <span>{post.engagement_metrics.likes} likes</span>
                          )}
                          {post.engagement_metrics.replies != null && (
                            <span>{post.engagement_metrics.replies} replies</span>
                          )}
                          {post.engagement_metrics.clicks != null && (
                            <span>{post.engagement_metrics.clicks} clicks</span>
                          )}
                        </div>
                      )}
                      {post.scheduled_at && post.status !== "published" && (
                        <p className="mt-1 text-xs text-gray-600">
                          Scheduled: {new Date(post.scheduled_at).toLocaleString()}
                        </p>
                      )}
                      {post.published_at && (
                        <p className="mt-1 text-xs text-gray-600">
                          Published: {new Date(post.published_at).toLocaleString()}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          {campaign.platforms.length === 0 && (
            <p className="py-2 text-center text-sm text-gray-500">No linked posts</p>
          )}
        </div>
      </div>

      {/* Aggregate Metrics */}
      {analytics && analytics.total_posts > 0 ? (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Campaign Metrics</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricTile label="Impressions" value={analytics.total_impressions} />
            <MetricTile label="Likes" value={analytics.total_likes} />
            <MetricTile label="Replies" value={analytics.total_replies} />
            <MetricTile label="Reposts" value={analytics.total_reposts} />
            <MetricTile label="Clicks" value={analytics.total_clicks} />
            <MetricTile
              label="Weighted Score"
              value={analytics.total_weighted_score}
              highlight
            />
          </div>

          {/* Per-platform breakdown */}
          {Object.keys(analytics.per_platform).length > 0 && (
            <div className="mt-3 border-t border-gray-800 pt-3">
              <h4 className="mb-2 text-xs uppercase tracking-wider text-gray-500">
                Per Platform
              </h4>
              <div className="space-y-2">
                {Object.entries(analytics.per_platform).map(([platform, metrics]) => (
                  <div
                    key={platform}
                    className="flex items-center justify-between rounded bg-gray-950 px-3 py-2"
                  >
                    <span className="text-xs font-medium capitalize text-gray-400">
                      {platform === "x" ? "X / Twitter" : platform}
                    </span>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>{metrics.impressions ?? 0} views</span>
                      <span>{metrics.likes ?? 0} likes</span>
                      <span className="font-mono text-red-400">
                        {metrics.weighted_score.toFixed(0)} ws
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <p className="text-center text-sm text-gray-500">
            No metrics available. Metrics appear after campaign posts are published.
          </p>
        </div>
      )}
    </div>
  );
}

/** Metric tile sub-component */
function MetricTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-mono text-lg ${highlight ? "text-red-400" : "text-gray-200"}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
