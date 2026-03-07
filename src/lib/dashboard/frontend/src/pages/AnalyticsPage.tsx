/**
 * AnalyticsPage Component
 *
 * Engagement analytics dashboard showing aggregate stats, top posts,
 * posting insights (best days/hours/content types), and competitor benchmarks.
 *
 * @module pages/AnalyticsPage
 */

import { useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";

import { useEngagementAnalytics } from "../hooks/useEngagementAnalytics";
import type {
  EngagementStats,
  TopPost,
  PostingInsights,
  CompetitorBenchmark,
} from "../hooks/useEngagementAnalytics";

/* ── Constants ────────────────────────────────────────────────────── */

const PERIOD_OPTIONS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
] as const;

const PLATFORM_OPTIONS = [
  { label: "All", value: undefined },
  { label: "X", value: "x" },
  { label: "LinkedIn", value: "linkedin" },
  { label: "Email", value: "email" },
] as const;

/* ── Helper components ──────────────────────────────────────────── */

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div
        className={`text-[28px] font-bold tabular-nums ${accent ? "text-green-400" : "text-gray-100"}`}
      >
        {value}
      </div>
    </div>
  );
}

function PillSelector<T extends string | number | undefined>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ label: string; value: T }>;
  value: T;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="flex gap-1">
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 ${
              isActive
                ? "border-red-600 bg-red-900/20 text-red-400"
                : "border-gray-700 bg-transparent text-gray-400 hover:border-gray-600 hover:text-gray-300"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function BarVisualization({
  value,
  maxValue,
  label,
  sublabel,
}: {
  value: number;
  maxValue: number;
  label: string;
  sublabel: string;
}): JSX.Element {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="text-gray-200">{label}</span>
        <span className="text-gray-500">{sublabel}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-red-500 transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}

/* ── Stats Overview ─────────────────────────────────────────────── */

function StatsOverview({ stats }: { stats: EngagementStats }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total Posts" value={String(stats.total_posts)} />
      <StatCard
        label="Avg Score"
        value={stats.avg_weighted_score.toFixed(1)}
        accent
      />
      <StatCard
        label="Total Engagement"
        value={stats.total_engagement.toLocaleString()}
      />
      <StatCard
        label="Engagement Rate"
        value={`${stats.avg_engagement_rate.toFixed(2)}%`}
        accent
      />
    </div>
  );
}

/* ── Top Posts Table ─────────────────────────────────────────────── */

function TopPostsTable({ posts }: { posts: TopPost[] }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">Top Posts</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-gray-800 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                #
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Post ID
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Platform
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Score
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Likes
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Replies
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                RTs
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Impressions
              </th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="border-b border-gray-800 p-6 text-center text-sm text-gray-500"
                >
                  No posts found for this period.
                </td>
              </tr>
            ) : (
              posts.map((post, idx) => (
                <tr
                  key={post.id}
                  className={idx % 2 === 0 ? "bg-transparent" : "bg-gray-900/50"}
                >
                  <td className="border-b border-gray-800 px-3 py-2 text-center text-sm text-gray-500">
                    {idx + 1}
                  </td>
                  <td
                    className="border-b border-gray-800 px-3 py-2 font-mono text-xs text-red-400"
                    title={post.post_id}
                  >
                    {post.post_id.length > 16
                      ? post.post_id.slice(0, 16) + "..."
                      : post.post_id}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        post.platform === "x"
                          ? "bg-sky-500/10 text-sky-400"
                          : post.platform === "linkedin"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-gray-500/10 text-gray-400"
                      }`}
                    >
                      {post.platform}
                    </span>
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm font-semibold tabular-nums text-green-400">
                    {post.weighted_score.toFixed(1)}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {post.likes.toLocaleString()}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {post.replies.toLocaleString()}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {post.retweets.toLocaleString()}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {post.impressions.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Posting Insights Panel ─────────────────────────────────────── */

function InsightsPanel({
  insights,
}: {
  insights: PostingInsights;
}): JSX.Element {
  const maxDayScore = Math.max(
    ...insights.best_days.map((d) => d.avg_score),
    1,
  );
  const maxHourScore = Math.max(
    ...insights.best_hours.map((h) => h.avg_score),
    1,
  );

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-4 text-sm font-semibold text-gray-200">
        Posting Insights
      </h3>

      {/* Best Days */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Best Days
        </div>
        {insights.best_days.length === 0 ? (
          <div className="text-xs text-gray-500">No data available.</div>
        ) : (
          insights.best_days.map((day) => (
            <BarVisualization
              key={day.day_of_week}
              label={day.day_of_week}
              sublabel={`${day.avg_score.toFixed(1)} avg (${String(day.post_count)} posts)`}
              value={day.avg_score}
              maxValue={maxDayScore}
            />
          ))
        )}
      </div>

      {/* Best Hours */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Best Hours
        </div>
        {insights.best_hours.length === 0 ? (
          <div className="text-xs text-gray-500">No data available.</div>
        ) : (
          insights.best_hours.slice(0, 8).map((hour) => (
            <BarVisualization
              key={hour.hour}
              label={`${String(hour.hour).padStart(2, "0")}:00`}
              sublabel={`${hour.avg_score.toFixed(1)} avg (${String(hour.post_count)} posts)`}
              value={hour.avg_score}
              maxValue={maxHourScore}
            />
          ))
        )}
      </div>

      {/* Content Types */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Content Types
        </div>
        {insights.content_types.length === 0 ? (
          <div className="text-xs text-gray-500">No data available.</div>
        ) : (
          insights.content_types.map((ct) => (
            <div
              key={ct.type}
              className="flex items-center justify-between border-b border-gray-800 py-1.5 text-xs"
            >
              <span className="font-medium text-gray-200">{ct.type}</span>
              <span className="text-gray-500">
                {String(ct.post_count)} posts | avg {ct.avg_score.toFixed(1)} |{" "}
                {ct.avg_engagement_rate.toFixed(2)}%
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Competitor Benchmarks ──────────────────────────────────────── */

function BenchmarksPanel({
  benchmarks,
}: {
  benchmarks: CompetitorBenchmark[];
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">
          Competitor Benchmarks
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-gray-800 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Competitor
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Posts
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Avg Score
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Eng. Rate
              </th>
              <th className="border-b border-gray-800 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Post Freq.
              </th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="border-b border-gray-800 p-6 text-center text-sm text-gray-500"
                >
                  No competitor data available.
                </td>
              </tr>
            ) : (
              benchmarks.map((bm) => (
                <tr key={bm.competitor_id}>
                  <td className="border-b border-gray-800 px-3 py-2 font-mono text-xs text-red-400">
                    {bm.competitor_id}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {String(bm.total_posts)}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm font-semibold tabular-nums text-green-400">
                    {bm.avg_weighted_score.toFixed(1)}
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {bm.avg_engagement_rate.toFixed(2)}%
                  </td>
                  <td className="border-b border-gray-800 px-3 py-2 text-right text-sm tabular-nums text-gray-200">
                    {bm.posting_frequency.toFixed(1)}/day
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────── */

export function AnalyticsPage(): JSX.Element {
  const [days, setDays] = useState(30);
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const { stats, topPosts, insights, benchmarks, loading, error, refetch } =
    useEngagementAnalytics(days, platform);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-950 p-3 text-gray-100 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BarChart3 size={22} className="text-red-400" />
          <h1 className="text-xl font-bold text-gray-100">
            Engagement Analytics
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PillSelector
            options={PERIOD_OPTIONS}
            value={days}
            onChange={setDays}
          />
          <PillSelector
            options={PLATFORM_OPTIONS}
            value={platform}
            onChange={setPlatform}
          />
          <button
            type="button"
            onClick={refetch}
            title="Refresh data"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-gray-700 bg-transparent text-gray-400 transition-colors duration-150 hover:bg-gray-800 hover:text-gray-200"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Loading State ───────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">
          Loading analytics data...
        </div>
      )}

      {/* ── Error State ─────────────────────────────────────────── */}
      {!loading && error && (
        <div className="mb-4 rounded-lg border border-red-800/50 bg-red-900/20 p-4">
          <div className="mb-1 text-sm font-semibold text-red-400">
            Failed to load analytics
          </div>
          <div className="text-[13px] text-gray-400">{error.message}</div>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 cursor-pointer rounded-md border border-gray-700 bg-gray-900 px-3.5 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="flex flex-col gap-4">
          {/* Stats cards */}
          {stats && <StatsOverview stats={stats} />}

          {/* Top Posts table */}
          <TopPostsTable posts={topPosts} />

          {/* Two-column: Insights + Benchmarks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {insights && <InsightsPanel insights={insights} />}
            <BenchmarksPanel benchmarks={benchmarks} />
          </div>
        </div>
      )}
    </div>
  );
}
