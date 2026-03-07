/**
 * ContentTypeDistribution Component
 *
 * Per-competitor content type breakdown as stacked horizontal bars.
 * Shows what percentage of each competitor's posts are single, thread,
 * media, article, etc. Terminal aesthetic with color-coded legend.
 *
 * @module components/analytics/ContentTypeDistribution
 */

import type { CompetitorContentType } from "./types";

interface ContentTypeDistributionProps {
  data: CompetitorContentType[];
}

/** Color mapping for content types. Falls back to gray for unknown types. */
const TYPE_COLORS: Record<string, string> = {
  single: "bg-blue-500/60",
  thread: "bg-emerald-500/60",
  media: "bg-amber-500/60",
  article: "bg-purple-500/60",
};

/**
 * Collects all unique content types across all competitors for the legend.
 */
function getUniqueTypes(data: CompetitorContentType[]): string[] {
  const seen = new Set<string>();
  for (const competitor of data) {
    for (const t of competitor.types) {
      seen.add(t.type);
    }
  }
  return Array.from(seen);
}

/**
 * Renders per-competitor stacked horizontal bars showing content type
 * distribution. Displays empty state when no data is available.
 */
export function ContentTypeDistribution({
  data,
}: ContentTypeDistributionProps): JSX.Element {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-600">
        No content type data available
      </div>
    );
  }

  const uniqueTypes = getUniqueTypes(data);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {uniqueTypes.map((type) => {
          const color = TYPE_COLORS[type] ?? "bg-gray-600";
          return (
            <div key={type} className="flex items-center gap-1">
              <div className={`h-2.5 w-2.5 rounded-sm ${color}`} />
              <span className="capitalize text-gray-500">{type}</span>
            </div>
          );
        })}
      </div>

      {/* Stacked bars per competitor */}
      {data.map((competitor) => {
        const total =
          competitor.types.reduce((sum, t) => sum + t.count, 0) || 1;
        return (
          <div key={competitor.competitor_id} className="space-y-1">
            <span className="font-mono text-xs text-gray-400">
              @{competitor.competitor_id}
            </span>
            <div className="flex h-4 overflow-hidden rounded bg-gray-800">
              {competitor.types.map((t) => {
                const pct = (t.count / total) * 100;
                const color = TYPE_COLORS[t.type] ?? "bg-gray-600";
                return (
                  <div
                    key={t.type}
                    className={`${color} transition-all duration-300`}
                    style={{ width: `${String(pct)}%` }}
                    title={`${t.type}: ${String(t.count)} posts (${pct.toFixed(0)}%)`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
