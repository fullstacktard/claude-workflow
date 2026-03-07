/**
 * TrendsPage Component
 *
 * Full-width trends view with trending topics table, sparklines,
 * viral tweets section, and quick-action buttons.
 *
 * Route: /x-ops/trends (nested under XOpsPage)
 *
 * @module pages/TrendsPage
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { TerminalCard } from "../components/TerminalCard";
import { Sparkline } from "../components/trends/Sparkline";
import { ViralTweetCard } from "../components/trends/ViralTweetCard";
import { useTrends } from "../hooks/useTrends";
import type { TrendRegion } from "../types/trend";

const REGIONS: { value: TrendRegion; label: string }[] = [
  { value: "us", label: "US" },
  { value: "global", label: "Global" },
  { value: "eu", label: "EU" },
  { value: "uk", label: "UK" },
];

export function TrendsPage(): JSX.Element {
  const navigate = useNavigate();
  const storedRegion = (localStorage.getItem("trends-region") as TrendRegion | null) ?? "us";
  const [region, setRegion] = useState<TrendRegion>(storedRegion);
  const { trends, viralTweets, loading, error, refetch } = useTrends({
    region,
    count: 20,
    includeViral: true,
  });

  function handleRegionChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const newRegion = e.target.value as TrendRegion;
    setRegion(newRegion);
    localStorage.setItem("trends-region", newRegion);
  }

  function handleGenerateTweet(trendName: string): void {
    // Navigate to personas page with trend context
    navigate(`/x-ops/personas?trend=${encodeURIComponent(trendName)}`);
  }

  function handleGenerateReply(_tweetId: string): void {
    // Navigate to personas page for reply generation
    navigate("/x-ops/personas");
  }

  return (
    <div className="flex h-full flex-col bg-gray-950 p-3 sm:p-6 gap-3 overflow-auto">
      {/* Trending Topics Section */}
      <TerminalCard
        command="curl"
        filename="api.x.com/trends"
        headerText={`trending topics (${region.toUpperCase()})`}
        headerActions={
          <div className="flex items-center gap-2">
            <select
              value={region}
              onChange={handleRegionChange}
              className="bg-gray-800 border border-red-800 text-gray-300 text-xs rounded px-1.5 py-0.5 font-mono focus:outline-none focus:border-red-600"
              aria-label="Select trend region"
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => void refetch()}
              className="text-xs text-gray-400 hover:text-red-400 font-mono"
              title="Refresh trends"
              type="button"
            >
              [refresh]
            </button>
          </div>
        }
        noPadding
        divideRows
      >
        {/* Loading state */}
        {loading && trends.length === 0 && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={`skeleton-${String(i)}`} className="h-5 bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        )}

        {/* Error state */}
        {error !== null && trends.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-gray-500 text-sm mb-2">Failed to load trends</p>
            <button
              onClick={() => void refetch()}
              className="text-xs text-red-400 hover:text-red-300 font-mono"
              type="button"
            >
              [retry]
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && error === null && trends.length === 0 && (
          <div className="p-6 text-center text-gray-500 text-sm font-mono">
            No trending topics found for {region.toUpperCase()}
          </div>
        )}

        {/* Trends table header */}
        {trends.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 text-xs font-mono text-gray-500 bg-gray-900/50">
            <span className="w-8 text-center">#</span>
            <span className="flex-1">Topic</span>
            <span className="w-16 text-right">Volume</span>
            <span className="w-16 text-right">Change</span>
            <span className="w-16 text-center">Trend</span>
            <span className="w-14 text-center hidden sm:block">Category</span>
            <span className="w-28 text-center">Action</span>
          </div>
        )}

        {/* Trend rows */}
        {trends.map((trend, index) => (
          <div
            key={trend.id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/50 transition-colors"
          >
            <span className="w-8 text-center text-gray-500 text-xs font-mono">
              {String(index + 1)}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-gray-200 text-sm font-mono truncate block">
                {trend.name}
              </span>
            </div>
            <span className="w-16 text-right text-gray-400 text-xs font-mono">
              {trend.tweetVolume !== null
                ? trend.tweetVolume >= 1000
                  ? `${String((trend.tweetVolume / 1000).toFixed(1))}K`
                  : String(trend.tweetVolume)
                : "---"}
            </span>
            <span
              className={`w-16 text-right text-xs font-mono ${
                trend.volumeChangePercent >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {trend.volumeChangePercent >= 0 ? "+" : ""}
              {String(trend.volumeChangePercent)}%
            </span>
            <div className="w-16 flex justify-center">
              <Sparkline
                values={trend.volumeHistory}
                width={60}
                height={16}
                lineColor="#22d3ee"
                lineWidth={1.5}
                fillColor="rgba(34,211,238,0.15)"
              />
            </div>
            <span className="w-14 text-center hidden sm:block">
              {trend.category !== null && (
                <span className="inline-block px-1.5 py-0.5 text-xs font-mono bg-gray-800 text-gray-300 rounded">
                  {trend.category}
                </span>
              )}
            </span>
            <div className="w-28 flex justify-center gap-1">
              <button
                onClick={() => handleGenerateTweet(trend.name)}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-mono px-1"
                title={`Generate tweet about ${trend.name}`}
                type="button"
              >
                [Tweet]
              </button>
            </div>
          </div>
        ))}
      </TerminalCard>

      {/* Viral Tweets Section */}
      <TerminalCard
        command="grep"
        filename="viral_tweets.log"
        headerText="viral tweets"
      >
        {/* Loading state for viral tweets */}
        {loading && viralTweets.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={`viral-skeleton-${String(i)}`}
                className="h-32 bg-gray-800 rounded animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && viralTweets.length === 0 && (
          <p className="text-gray-500 text-sm font-mono">
            No viral tweets detected yet
          </p>
        )}

        {/* Viral tweet cards */}
        {viralTweets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {viralTweets.map((tweet) => (
              <ViralTweetCard
                key={tweet.id}
                tweet={tweet}
                onGenerateReply={handleGenerateReply}
              />
            ))}
          </div>
        )}
      </TerminalCard>
    </div>
  );
}
