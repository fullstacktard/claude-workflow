/**
 * AdminDashboardPage
 *
 * Overview page for the admin panel. Displays:
 * - Welcome header with admin context
 * - Quick stats cards (placeholder data)
 * - Navigation cards linking to admin sections
 */

import { Link } from "react-router-dom";
import {
  CreditCard,
  Package,
  Rocket,
  Tags,
  TrendingUp,
  Users,
} from "lucide-react";

/* -- Types --------------------------------------------------------------- */

interface StatCardProps {
  label: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
}

interface NavCardProps {
  to: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

/* -- Stat Card ----------------------------------------------------------- */

function StatCard({ label, value, trend, trendUp }: StatCardProps): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
      <p className="font-mono text-xs uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-[28px] font-bold tabular-nums text-gray-100">
        {value}
      </p>
      {trend !== undefined && (
        <p
          className={`mt-1 flex items-center gap-1 font-mono text-xs ${
            trendUp === true ? "text-green-400" : "text-red-400"
          }`}
        >
          <TrendingUp
            size={12}
            className={trendUp === true ? "" : "rotate-180"}
            aria-hidden="true"
          />
          <span>{trend}</span>
        </p>
      )}
    </div>
  );
}

/* -- Nav Card ------------------------------------------------------------ */

function NavCard({ to, label, description, icon: Icon }: NavCardProps): JSX.Element {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-700 hover:bg-gray-800/50"
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon
          size={16}
          className="text-gray-500 transition-colors group-hover:text-red-400"
          aria-hidden="true"
        />
        <h3 className="font-mono text-sm font-medium text-gray-100">
          {label}
        </h3>
      </div>
      <p className="font-mono text-xs text-gray-500">{description}</p>
    </Link>
  );
}

/* -- Page ---------------------------------------------------------------- */

/** Placeholder stats -- will be replaced with real API data */
const stats: StatCardProps[] = [
  { label: "Total Revenue", value: "$0", trend: "--", trendUp: true },
  { label: "Active Subscribers", value: "0", trend: "--", trendUp: true },
  { label: "Pro Licenses", value: "0" },
  { label: "Deployments", value: "0" },
];

/** Navigation cards for admin sections */
const navCards: NavCardProps[] = [
  {
    to: "/admin/revenue",
    label: "Revenue",
    description: "View revenue metrics, MRR, and payment history",
    icon: CreditCard,
  },
  {
    to: "/admin/subscribers",
    label: "Subscribers",
    description: "Manage subscriber accounts and entitlements",
    icon: Users,
  },
  {
    to: "/admin/features",
    label: "Features",
    description: "Configure feature flags and pro module access",
    icon: Package,
  },
  {
    to: "/admin/pricing",
    label: "Pricing",
    description: "Manage pricing tiers, plans, and trial settings",
    icon: Tags,
  },
  {
    to: "/admin/deploy",
    label: "Deploy",
    description: "Release management and deployment controls",
    icon: Rocket,
  },
];

export function AdminDashboardPage(): JSX.Element {
  return (
    <div className="p-6">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="font-mono text-xl font-bold text-gray-100">
          Admin Overview
        </h1>
        <p className="mt-1 font-mono text-sm text-gray-500">
          claude-workflow administration dashboard
        </p>
      </div>

      {/* Quick stats */}
      <section aria-label="Quick statistics" className="mb-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-gray-500">
          Quick Stats
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </section>

      {/* Navigation cards */}
      <section aria-label="Admin sections">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-gray-500">
          Sections
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {navCards.map((card) => (
            <NavCard key={card.to} {...card} />
          ))}
        </div>
      </section>
    </div>
  );
}
