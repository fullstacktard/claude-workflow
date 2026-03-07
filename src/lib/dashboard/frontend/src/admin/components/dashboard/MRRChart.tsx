/**
 * MRRChart - Monthly Recurring Revenue line chart over time
 *
 * Uses Recharts LineChart with dark theme styling.
 * X-axis: date labels, Y-axis: dollar amounts.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MRRDataPoint {
  date: string; // formatted label e.g. "Jan 25"
  mrr: number; // in dollars (already divided by 100)
}

interface MRRChartProps {
  data: MRRDataPoint[];
  height?: number;
}

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "6px",
  fontSize: "12px",
};

export function MRRChart({
  data,
  height = 300,
}: MRRChartProps): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-4 text-sm font-semibold text-gray-200">
        MRR Over Time
      </h3>
      {data.length === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-gray-500"
          style={{ height }}
        >
          No MRR data available for this period.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
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
              tickFormatter={(value: number) =>
                `$${value.toLocaleString()}`
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "#9CA3AF" }}
              formatter={(value: number) => [
                `$${value.toLocaleString()}`,
                "MRR",
              ]}
            />
            <Line
              type="monotone"
              dataKey="mrr"
              stroke="#f87171"
              strokeWidth={2}
              dot={{ fill: "#f87171", r: 3 }}
              activeDot={{ r: 5, fill: "#ef4444" }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
