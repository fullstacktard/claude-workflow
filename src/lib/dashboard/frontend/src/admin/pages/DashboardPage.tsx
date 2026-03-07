/**
 * DashboardPage - Revenue Analytics Dashboard
 *
 * Main admin page showing KPI cards, MRR chart, revenue donut,
 * subscriber area chart, and recent events table.
 *
 * Layout follows Stripe/Baremetrics pattern (Finding 4 in
 * docs/research/admin-analytics-charting.md).
 */

import { useState } from "react";
import { DollarSign, RefreshCw, Loader2 } from "lucide-react";

import { useMetrics } from "../hooks/useMetrics";
import { KPICards } from "../components/dashboard/KPICards";
import { MRRChart } from "../components/dashboard/MRRChart";
import { RevenueDonut } from "../components/dashboard/RevenueDonut";
import { SubscriberChart } from "../components/dashboard/SubscriberChart";
import { RecentEventsTable } from "../components/dashboard/RecentEventsTable";

const PERIOD_OPTIONS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
] as const;

function PillSelector({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ label: string; value: number }>;
  value: number;
  onChange: (v: number) => void;
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

export function DashboardPage(): JSX.Element {
  const [days, setDays] = useState(30);
  const { data, loading, refreshing, error, refetch } =
    useMetrics(days);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-950 p-3 text-gray-100 sm:p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <DollarSign size={22} className="text-red-400" />
          <h1 className="text-xl font-bold text-gray-100">
            Revenue Analytics
          </h1>
          {refreshing && (
            <Loader2
              size={14}
              className="animate-spin text-gray-500"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PillSelector
            options={PERIOD_OPTIONS}
            value={days}
            onChange={setDays}
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">
          Loading revenue data...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="mb-4 rounded-lg border border-red-800/50 bg-red-900/20 p-4">
          <div className="mb-1 text-sm font-semibold text-red-400">
            Failed to load revenue data
          </div>
          <div className="text-[13px] text-gray-400">
            {error.message}
          </div>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 cursor-pointer rounded-md border border-gray-700 bg-gray-900 px-3.5 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <div className="flex flex-col gap-4">
          {/* Row 1: KPI Cards */}
          <KPICards
            mrr={data.kpi.mrr}
            mrrHistory={data.timeSeries.map(
              (p) => p.mrr * 100,
            )}
            subscribers={data.kpi.activeSubscribers}
            subscriberHistory={data.timeSeries.map(
              (p) => p.subscribers,
            )}
            churnRate={data.kpi.churnRate}
            churnHistory={data.timeSeries.map(
              () => data.kpi.churnRate,
            )}
            arpu={data.kpi.arpu}
            arpuHistory={data.timeSeries.map(
              (p) =>
                (p.mrr * 100) /
                Math.max(p.subscribers, 1),
            )}
            previousMrr={data.previousKpi?.mrr}
            previousSubscribers={
              data.previousKpi?.activeSubscribers
            }
            previousChurnRate={
              data.previousKpi?.churnRate
            }
            previousArpu={data.previousKpi?.arpu}
          />

          {/* Row 2: MRR (2/3) + Revenue Donut (1/3) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <MRRChart
                data={data.timeSeries.map((p) => ({
                  date: p.date,
                  mrr: p.mrr,
                }))}
              />
            </div>
            <RevenueDonut data={data.revenueByTier} />
          </div>

          {/* Row 3: Subscriber Chart (full width) */}
          <SubscriberChart
            data={data.timeSeries.map((p) => ({
              date: p.date,
              free: p.free,
              pro: p.pro,
            }))}
          />

          {/* Row 4: Recent Events Table */}
          <RecentEventsTable events={data.recentEvents} />
        </div>
      )}
    </div>
  );
}
