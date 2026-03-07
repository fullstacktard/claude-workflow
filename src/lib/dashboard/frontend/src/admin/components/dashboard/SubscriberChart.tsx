/**
 * SubscriberChart - Stacked area chart showing subscriber counts by tier
 *
 * Uses Recharts AreaChart with stacked areas per tier.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SubscriberDataPoint {
  date: string;
  free: number;
  pro: number;
}

interface SubscriberChartProps {
  data: SubscriberDataPoint[];
  height?: number;
}

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "6px",
  fontSize: "12px",
};

export function SubscriberChart({
  data,
  height = 260,
}: SubscriberChartProps): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-4 text-sm font-semibold text-gray-200">
        Subscribers by Tier
      </h3>
      {data.length === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-gray-500"
          style={{ height }}
        >
          No subscriber data available.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={data}
            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={{ stroke: "#374151" }}
              tickLine={{ stroke: "#374151" }}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={{ stroke: "#374151" }}
              tickLine={{ stroke: "#374151" }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "#9CA3AF" }}
            />
            <Area
              type="monotone"
              dataKey="pro"
              stackId="subs"
              stroke="#f87171"
              fill="#f87171"
              fillOpacity={0.3}
              name="Pro"
            />
            <Area
              type="monotone"
              dataKey="free"
              stackId="subs"
              stroke="#6b7280"
              fill="#6b7280"
              fillOpacity={0.2}
              name="Free"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
