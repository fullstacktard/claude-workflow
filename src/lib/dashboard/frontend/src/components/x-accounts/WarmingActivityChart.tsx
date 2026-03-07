/**
 * WarmingActivityChart - Recharts BarChart for daily warming action visualization
 *
 * Shows actions_today vs max_actions as a horizontal stacked bar chart.
 * The "done" portion is green, the "remaining" portion is dark gray.
 *
 * Uses Recharts v2.15 API: BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer.
 *
 * @module components/x-accounts/WarmingActivityChart
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

/** Props for WarmingActivityChart */
interface WarmingActivityChartProps {
  /** Number of actions performed today */
  actionsToday: number;
  /** Maximum actions allowed for current phase */
  maxActions: number;
  /** Chart height in pixels */
  height?: number;
  /** Additional CSS classes */
  className?: string;
}

/** Color for completed actions bar */
const COLOR_DONE = "#22c55e"; // green-500
/** Color for remaining actions bar */
const COLOR_REMAINING = "#374151"; // gray-700

/**
 * WarmingActivityChart renders a horizontal stacked bar showing
 * today's action count vs the phase maximum.
 *
 * When maxActions is 0 (should not happen in normal flow),
 * displays a fallback message instead.
 */
export function WarmingActivityChart({
  actionsToday,
  maxActions,
  height = 48,
  className = "",
}: WarmingActivityChartProps): JSX.Element {
  // Guard: no chart when max is 0
  if (maxActions <= 0) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ height }}
      >
        <span className="text-xs text-gray-500">Unlimited actions</span>
      </div>
    );
  }

  const capped = Math.min(actionsToday, maxActions);
  const remaining = maxActions - capped;

  const data = [{ name: "Today", done: capped, remaining }];

  return (
    <div className={className}>
      {/* Header: label + count */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Actions Today</span>
        <span className="text-xs font-mono text-gray-300">
          {actionsToday}/{maxActions}
        </span>
      </div>

      {/* Recharts horizontal bar */}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
          barCategoryGap={0}
        >
          <XAxis type="number" domain={[0, maxActions]} hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #374151",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#9CA3AF" }}
            itemStyle={{ color: "#E5E7EB" }}
            formatter={(value: number, name: string) => {
              const label = name === "done" ? "Completed" : "Remaining";
              return [value, label];
            }}
          />
          <Bar
            dataKey="done"
            stackId="actions"
            barSize={20}
            radius={[4, 0, 0, 4]}
          >
            <Cell fill={COLOR_DONE} />
          </Bar>
          <Bar
            dataKey="remaining"
            stackId="actions"
            barSize={20}
            radius={[0, 4, 4, 0]}
          >
            <Cell fill={COLOR_REMAINING} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
