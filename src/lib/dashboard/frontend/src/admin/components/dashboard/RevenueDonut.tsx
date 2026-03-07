/**
 * RevenueDonut - Donut chart showing revenue breakdown by tier
 *
 * Uses Recharts PieChart with innerRadius for donut effect.
 * Center shows total revenue. Labels show tier percentages.
 */

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface TierRevenue {
  name: string; // "Pro", "Free", etc.
  value: number; // revenue in dollars
  color: string; // hex color
}

interface RevenueDonutProps {
  data: TierRevenue[];
  height?: number;
}

const TIER_COLORS: Record<string, string> = {
  Pro: "#f87171", // red-400
  Free: "#fbbf24", // amber-400
  Other: "#6b7280", // gray-500
};

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "6px",
  fontSize: "12px",
};

export function RevenueDonut({
  data,
  height = 280,
}: RevenueDonutProps): JSX.Element {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-4 text-sm font-semibold text-gray-200">
        Revenue by Tier
      </h3>
      {data.length === 0 || total === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-gray-500"
          style={{ height }}
        >
          No revenue data available.
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                strokeWidth={0}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={
                      entry.color ||
                      TIER_COLORS[entry.name] ||
                      "#6b7280"
                    }
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: "#9CA3AF" }}
                formatter={(value: number, name: string) => [
                  `$${value.toLocaleString()} (${
                    total > 0
                      ? ((value / total) * 100).toFixed(1)
                      : 0
                  }%)`,
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center total overlay */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Total
            </div>
            <div className="text-xl font-bold tabular-nums text-gray-100">
              ${total.toLocaleString()}
            </div>
          </div>
        </div>
      )}
      {/* Tier legend */}
      <div className="mt-3 flex flex-wrap justify-center gap-4">
        {data.map((entry) => (
          <div
            key={entry.name}
            className="flex items-center gap-1.5 text-xs text-gray-400"
          >
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor:
                  entry.color ||
                  TIER_COLORS[entry.name] ||
                  "#6b7280",
              }}
            />
            <span>{entry.name}</span>
            <span className="font-medium text-gray-300">
              {total > 0
                ? ((entry.value / total) * 100).toFixed(0)
                : 0}
              %
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
