/**
 * KPICards - Revenue KPI metric cards with inline sparklines
 *
 * Displays: MRR, Active Subscribers, Churn Rate, ARPU
 * Each card includes a SparkChart showing trend over selected period.
 */

import {
  BarChart,
  Bar,
  ResponsiveContainer,
} from "recharts";

interface KPIMetric {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down" | "flat";
  sparkData: Array<{ v: number }>;
  accent?: boolean;
}

interface KPICardsProps {
  mrr: number; // in cents
  mrrHistory: number[]; // array of MRR values for sparkline
  subscribers: number;
  subscriberHistory: number[];
  churnRate: number; // 0-100
  churnHistory: number[];
  arpu: number; // in cents
  arpuHistory: number[];
  previousMrr?: number;
  previousSubscribers?: number;
  previousChurnRate?: number;
  previousArpu?: number;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatCurrencyDecimal(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatChange(
  current: number,
  previous: number | undefined,
  isPercentage = false,
): { text: string; direction: "up" | "down" | "flat" } {
  if (previous === undefined || previous === 0) {
    return { text: "--", direction: "flat" };
  }
  const diff = current - previous;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  if (isPercentage) {
    return {
      text: `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%`,
      direction,
    };
  }
  return {
    text: `${diff > 0 ? "+" : ""}${(diff / 100).toFixed(0)}`,
    direction,
  };
}

function SparkChart({
  data,
  color,
}: {
  data: Array<{ v: number }>;
  color: string;
}): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={32}>
      <BarChart
        data={data}
        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
      >
        <Bar dataKey="v" fill={color} radius={[1, 1, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MetricCard({
  label,
  value,
  change,
  direction,
  sparkData,
  accent = false,
}: KPIMetric): JSX.Element {
  const directionColor =
    direction === "up"
      ? "text-green-400"
      : direction === "down"
        ? "text-red-400"
        : "text-gray-500";
  const arrow =
    direction === "up" ? "\u2191" : direction === "down" ? "\u2193" : "";

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          accent ? "text-green-400" : "text-gray-100"
        }`}
      >
        {value}
      </div>
      <div className={`mt-0.5 text-xs font-medium ${directionColor}`}>
        {arrow} {change}
      </div>
      <div className="mt-2">
        <SparkChart
          data={sparkData}
          color={accent ? "#4ade80" : "#f87171"}
        />
      </div>
    </div>
  );
}

export function KPICards(props: KPICardsProps): JSX.Element {
  const mrrChange = formatChange(props.mrr, props.previousMrr);
  const subChange = formatChange(
    props.subscribers,
    props.previousSubscribers,
  );
  const churnChange = formatChange(
    props.churnRate,
    props.previousChurnRate,
    true,
  );
  const arpuChange = formatChange(props.arpu, props.previousArpu);

  const metrics: KPIMetric[] = [
    {
      label: "Monthly Recurring Revenue",
      value: formatCurrency(props.mrr),
      change: mrrChange.text,
      direction: mrrChange.direction,
      sparkData: props.mrrHistory.map((v) => ({ v })),
      accent: true,
    },
    {
      label: "Active Subscribers",
      value: String(props.subscribers),
      change: subChange.text,
      direction: subChange.direction,
      sparkData: props.subscriberHistory.map((v) => ({ v })),
    },
    {
      label: "Churn Rate",
      value: `${props.churnRate.toFixed(1)}%`,
      change: churnChange.text,
      direction:
        churnChange.direction === "up"
          ? "down"
          : churnChange.direction === "down"
            ? "up"
            : "flat",
      sparkData: props.churnHistory.map((v) => ({ v })),
    },
    {
      label: "ARPU",
      value: formatCurrencyDecimal(props.arpu),
      change: arpuChange.text,
      direction: arpuChange.direction,
      sparkData: props.arpuHistory.map((v) => ({ v })),
      accent: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((m) => (
        <MetricCard key={m.label} {...m} />
      ))}
    </div>
  );
}
