/**
 * RecentEventsTable - Table showing latest subscription events
 *
 * Columns: Time, Event Type, Customer, Tier, Amount, Status
 * Follows the TopPostsTable pattern from AnalyticsPage.tsx.
 */

interface SubscriptionEvent {
  id: string;
  timestamp: string;
  type:
    | "subscription.created"
    | "subscription.canceled"
    | "subscription.updated";
  customerEmail: string;
  tier: string;
  amountCents: number;
  status: "active" | "canceled" | "churned" | "upgraded";
}

interface RecentEventsTableProps {
  events: SubscriptionEvent[];
}

const EVENT_LABELS: Record<string, string> = {
  "subscription.created": "New",
  "subscription.canceled": "Canceled",
  "subscription.updated": "Updated",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/10 text-green-400",
  canceled: "bg-red-500/10 text-red-400",
  churned: "bg-gray-500/10 text-gray-400",
  upgraded: "bg-blue-500/10 text-blue-400",
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function RecentEventsTable({
  events,
}: RecentEventsTableProps): JSX.Element {
  const thClass =
    "border-b border-gray-800 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500";
  const tdClass = "border-b border-gray-800 px-3 py-2 text-sm";

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">
          Recent Subscription Events
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={thClass}>Time</th>
              <th className={thClass}>Event</th>
              <th className={thClass}>Customer</th>
              <th className={thClass}>Tier</th>
              <th className={`${thClass} text-right`}>Amount</th>
              <th className={`${thClass} text-center`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="border-b border-gray-800 p-6 text-center text-sm text-gray-500"
                >
                  No recent subscription events.
                </td>
              </tr>
            ) : (
              events.map((event, idx) => (
                <tr
                  key={event.id}
                  className={
                    idx % 2 === 0
                      ? "bg-transparent"
                      : "bg-gray-900/50"
                  }
                >
                  <td
                    className={`${tdClass} text-gray-500 tabular-nums`}
                  >
                    {formatRelativeTime(event.timestamp)}
                  </td>
                  <td
                    className={`${tdClass} font-medium text-gray-200`}
                  >
                    {EVENT_LABELS[event.type] ?? event.type}
                  </td>
                  <td
                    className={`${tdClass} font-mono text-xs text-red-400`}
                    title={event.customerEmail}
                  >
                    {event.customerEmail.length > 24
                      ? event.customerEmail.slice(0, 24) + "..."
                      : event.customerEmail}
                  </td>
                  <td className={`${tdClass} text-gray-200`}>
                    {event.tier}
                  </td>
                  <td
                    className={`${tdClass} text-right tabular-nums text-gray-200`}
                  >
                    ${(event.amountCents / 100).toFixed(2)}/mo
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        STATUS_STYLES[event.status] ??
                        "bg-gray-500/10 text-gray-400"
                      }`}
                    >
                      {event.status}
                    </span>
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
