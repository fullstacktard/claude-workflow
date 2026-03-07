/**
 * XOpsPage Component
 *
 * Wrapper page for all X/Twitter operations. Provides horizontal sub-navigation
 * tabs (Accounts, Personas, Drafts, Trends) and renders the active sub-page
 * via React Router's Outlet.
 *
 * Sub-navigation styling matches the BottomBar terminal aesthetic:
 * - Active: bg-red-900/30 text-red-400
 * - Inactive: text-gray-400 hover:text-gray-300
 * - Font: font-mono, text-xs
 *
 * @module pages/XOpsPage
 */

import { Link, Outlet, useLocation } from "react-router-dom";
import { FileText, TrendingUp, UserCircle, Users } from "lucide-react";

interface SubTab {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const subTabs: SubTab[] = [
  { to: "/x-ops/accounts", label: "Accounts", icon: Users },
  { to: "/x-ops/personas", label: "Personas", icon: UserCircle },
  { to: "/x-ops/drafts", label: "Drafts", icon: FileText },
  { to: "/x-ops/trends", label: "Trends", icon: TrendingUp },
];

export function XOpsPage(): JSX.Element {
  const location = useLocation();

  return (
    <div className="flex h-full flex-col bg-gray-950">
      {/* Sub-navigation tabs */}
      <nav
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-red-800/50 bg-gray-900/50 px-3 py-1 sm:px-4"
        role="navigation"
        aria-label="X Operations sub-navigation"
      >
        {subTabs.map((tab) => {
          const isActive = location.pathname.startsWith(tab.to);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 font-mono text-xs font-medium transition-colors ${
                isActive
                  ? "bg-red-900/30 text-red-400"
                  : "text-gray-400 hover:bg-red-900/20 hover:text-gray-300"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon
                size={14}
                className={isActive ? "text-red-400" : "text-gray-500"}
              />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Sub-page content rendered via Outlet */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
