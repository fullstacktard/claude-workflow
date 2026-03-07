/**
 * ViralTweetCard Component
 * Displays a viral tweet with engagement metrics and action buttons.
 *
 * @module components/trends/ViralTweetCard
 */

import type { ViralTweet } from "../../types/trend";

interface ViralTweetCardProps {
  tweet: ViralTweet;
  onGenerateReply?: (tweetId: string) => void;
}

export function ViralTweetCard({
  tweet,
  onGenerateReply,
}: ViralTweetCardProps): JSX.Element {
  return (
    <div className="border border-red-800 rounded bg-gray-900/60 p-3">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-red-300 text-xs font-mono shrink-0">
          @{tweet.authorHandle}
        </span>
        <span className="text-gray-500 text-xs font-mono">
          {new Date(tweet.createdAt).toLocaleDateString()}
        </span>
        {tweet.relatedTrend !== null && (
          <span className="ml-auto text-xs font-mono bg-cyan-900/30 text-cyan-400 rounded px-1.5 py-0.5">
            {tweet.relatedTrend}
          </span>
        )}
      </div>
      <p className="text-gray-200 text-sm mb-3 line-clamp-3">{tweet.text}</p>
      <div className="flex items-center gap-4 text-xs font-mono text-gray-400 mb-2">
        <span title="Likes">
          <span className="text-red-400">{"\u2665"}</span>{" "}
          {tweet.likes.toLocaleString()}
        </span>
        <span title="Retweets">
          <span className="text-green-400">{"\u21BB"}</span>{" "}
          {tweet.retweets.toLocaleString()}
        </span>
        <span title="Replies">
          <span className="text-cyan-400">{"\u21A9"}</span>{" "}
          {tweet.replies.toLocaleString()}
        </span>
      </div>
      {onGenerateReply !== undefined && (
        <div className="flex gap-2">
          <button
            onClick={() => onGenerateReply(tweet.id)}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-mono px-2 py-1 border border-cyan-800 rounded hover:bg-cyan-900/20 transition-colors"
            type="button"
          >
            [Generate Reply]
          </button>
        </div>
      )}
    </div>
  );
}
