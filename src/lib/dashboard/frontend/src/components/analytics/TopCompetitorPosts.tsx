/**
 * TopCompetitorPosts Component
 *
 * Expandable list of highest-scoring competitor tweets.
 * Click a row to expand and see full engagement breakdown
 * (likes, replies, retweets, quotes, bookmarks).
 *
 * @module components/analytics/TopCompetitorPosts
 */

import { useState } from "react";

import type { CompetitorPost } from "./types";

interface TopCompetitorPostsProps {
  posts: CompetitorPost[];
}

/**
 * Formats a date string to a short locale display (e.g., "Mar 7").
 */
function formatPostDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Renders an expandable list of top competitor posts sorted by score.
 * Displays empty state when no data is available.
 */
export function TopCompetitorPosts({
  posts,
}: TopCompetitorPostsProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (posts.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-600">
        No competitor post data available
      </div>
    );
  }

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto">
      {posts.map((post) => {
        const postKey = `${post.competitor_id}-${post.tweet_id}`;
        const isExpanded = expandedId === postKey;

        return (
          <div key={postKey}>
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : postKey)}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left transition-colors hover:bg-gray-800/50"
              aria-expanded={isExpanded}
              aria-controls={`post-details-${postKey}`}
            >
              <span className="w-20 shrink-0 truncate font-mono text-xs text-gray-500">
                @{post.competitor_id}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-sm text-red-400">
                {post.weighted_score.toFixed(0)}
              </span>
              <span className="text-xs capitalize text-gray-600">
                {post.content_type}
              </span>
              <span className="ml-auto shrink-0 text-xs text-gray-700">
                {formatPostDate(post.posted_at)}
              </span>
              <span
                className="text-xs text-gray-600"
                aria-hidden="true"
              >
                {isExpanded ? "\u25B2" : "\u25BC"}
              </span>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div
                id={`post-details-${postKey}`}
                className="grid grid-cols-5 gap-2 px-3 pb-2 pl-8 text-xs text-gray-500"
              >
                <div>
                  <span className="block text-gray-600">Likes</span>
                  <span className="font-mono text-gray-300">
                    {post.likes.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-600">Replies</span>
                  <span className="font-mono text-gray-300">
                    {post.replies.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-600">Retweets</span>
                  <span className="font-mono text-gray-300">
                    {post.retweets.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-600">Quotes</span>
                  <span className="font-mono text-gray-300">
                    {post.quotes.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-600">Bookmarks</span>
                  <span className="font-mono text-gray-300">
                    {post.bookmarks.toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
