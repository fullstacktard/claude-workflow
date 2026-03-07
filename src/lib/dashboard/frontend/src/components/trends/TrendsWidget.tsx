/**
 * TrendsWidget Component
 * Compact trending topics widget for HomePage with sparkline visualizations.
 * Displays 5-8 trends with volume change, sparkline, and quick post action.
 *
 * @module components/trends/TrendsWidget
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { TerminalCard } from "../TerminalCard";
import { Sparkline } from "./Sparkline";
import { useTrends } from "../../hooks/useTrends";
import type { TrendRegion } from "../../types/trend";

const REGIONS: { value: TrendRegion; label: string }[] = [
  { value: "us", label: "US" },
  { value: "global", label: "Global" },
  { value: "eu", label: "EU" },
  { value: "uk", label: "UK" },
];

interface TrendsWidgetProps {
  className?: string;
}

export function TrendsWidget({ className = "" }: TrendsWidgetProps): JSX.Element {
  const navigate = useNavigate();
  const storedRegion = (localStorage.getItem("trends-region") as TrendRegion | null) ?? "us";
  const [region, setRegion] = useState<TrendRegion>(storedRegion);
  const { trends, loading, error, refetch } = useTrends({ region, count: 8 });

  function handleRegionChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const newRegion = e.target.value as TrendRegion;
    setRegion(newRegion);
    localStorage.setItem("trends-region", newRegion);
  }

  return (
    <TerminalCard
      className={className}
      command="curl"
      filename="api.x.com/trends"
      headerText="trending topics"
      headerActions={
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
      }
      noPadding
      divideRows
    >
      {/* Loading state */}
      {loading && trends.length === 0 && (
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`skeleton-${String(i)}`} className="h-4 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error !== null && trends.length === 0 && (
        <div className="p-4 text-center">
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
        <div className="p-4 text-center text-gray-500 text-sm font-mono">
          No trending topics found
        </div>
      )}

      {/* Trend rows */}
      {trends.map((trend) => (
        <div
          key={trend.id}
          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <span className="text-gray-200 text-sm font-mono truncate block">
              {trend.name}
            </span>
          </div>
          <span
            className={`text-xs font-mono shrink-0 ${
              trend.volumeChangePercent >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {trend.volumeChangePercent >= 0 ? "+" : ""}
            {String(trend.volumeChangePercent)}%
          </span>
          <Sparkline
            values={trend.volumeHistory}
            width={60}
            height={16}
            lineColor="#22d3ee"
            lineWidth={1.5}
            fillColor="rgba(34,211,238,0.15)"
          />
          <button
            className="text-xs text-cyan-400 hover:text-cyan-300 font-mono shrink-0 px-1"
            title={`Post about ${trend.name}`}
            type="button"
            onClick={() => navigate(`/x-ops/personas?trend=${encodeURIComponent(trend.name)}`)}
          >
            [Post]
          </button>
        </div>
      ))}
    </TerminalCard>
  );
}
