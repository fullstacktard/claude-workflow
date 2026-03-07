/**
 * EmailMetricsPanel Component
 *
 * Displays delivery metrics for a sent email campaign.
 * Shows total sent, delivered, opened, clicked, and bounced
 * counts with percentage bars.
 *
 * @module components/marketing/EmailMetricsPanel
 */

import type { EmailCampaignMetrics } from "../../types/marketing";

interface EmailMetricsPanelProps {
  metrics: EmailCampaignMetrics | null;
}

interface MetricCardProps {
  label: string;
  count: number;
  percentage: number;
  barColor: string;
  textColor: string;
}

function MetricCard({
  label,
  count,
  percentage,
  barColor,
  textColor,
}: MetricCardProps): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${textColor}`}>
        {count.toLocaleString()}
      </p>
      <div className="mt-1 h-1.5 w-full rounded-full bg-gray-800">
        <div
          className={`h-1.5 rounded-full ${barColor}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-600">{percentage.toFixed(1)}%</p>
    </div>
  );
}

export function EmailMetricsPanel({
  metrics,
}: EmailMetricsPanelProps): JSX.Element {
  if (!metrics) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <p className="text-center text-sm text-gray-500">
          No delivery metrics available. Metrics appear after a campaign is sent.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-300">
        Delivery Metrics
      </h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard
          label="Sent"
          count={metrics.total_sent}
          percentage={100}
          barColor="bg-gray-500"
          textColor="text-gray-300"
        />
        <MetricCard
          label="Delivered"
          count={metrics.delivered}
          percentage={metrics.delivered_pct}
          barColor="bg-green-500"
          textColor="text-green-400"
        />
        <MetricCard
          label="Opened"
          count={metrics.opened}
          percentage={metrics.opened_pct}
          barColor="bg-blue-500"
          textColor="text-blue-400"
        />
        <MetricCard
          label="Clicked"
          count={metrics.clicked}
          percentage={metrics.clicked_pct}
          barColor="bg-purple-500"
          textColor="text-purple-400"
        />
        <MetricCard
          label="Bounced"
          count={metrics.bounced}
          percentage={metrics.bounced_pct}
          barColor="bg-red-500"
          textColor="text-red-400"
        />
      </div>
    </div>
  );
}
