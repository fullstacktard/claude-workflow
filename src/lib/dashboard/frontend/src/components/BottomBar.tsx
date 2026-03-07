/**
 * BottomBar Component
 * Persistent bottom navigation bar with page tabs and service health indicators.
 * Fixed at viewport bottom, always visible across all pages.
 *
 * Left section: Navigation tabs using React Router Link + useLocation for active state
 * Right section: Service health dots (green/red/yellow) + live clock display (HH:MM:SS)
 */

import { Link, useLocation } from "react-router-dom";
import { BarChart3, CalendarDays, Clock, Code2, LayoutDashboard, Mail, Megaphone, Monitor, Users } from "lucide-react";

import { useClock } from "../hooks/useClock";
import { useServiceHealth } from "../hooks/useServiceHealth";
import type { ServiceStatus } from "../hooks/useServiceHealth";

interface NavTab {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const navTabs: NavTab[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tmux", label: "TMUX", icon: Monitor },
{ to: "/x-ops", label: "X Ops", icon: Users },
  { to: "/email-accounts", label: "Email", icon: Mail },
  { to: "/code", label: "Code", icon: Code2 },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/content-calendar", label: "Calendar", icon: CalendarDays },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

/** Map service status to Tailwind dot color classes */
function getStatusColor(status: ServiceStatus): string {
  switch (status) {
    case "healthy":
      return "bg-green-500";
    case "unhealthy":
      return "bg-red-500";
    case "checking":
      return "bg-yellow-500 animate-pulse";
  }
}

function getStatusLabel(status: ServiceStatus): string {
  switch (status) {
    case "healthy":
      return "Connected";
    case "unhealthy":
      return "Unreachable";
    case "checking":
      return "Checking...";
  }
}

export function BottomBar(): JSX.Element {
  const location = useLocation();
  const time = useClock();
  const health = useServiceHealth();
  return (
    <nav
      className="flex h-10 shrink-0 items-center border-t border-red-800 bg-gray-900 px-2 sm:px-4 gap-2 sm:gap-4 overflow-x-auto"
      role="navigation"
      aria-label="Bottom navigation"
    >
      {/* Page navigation tabs */}
      {navTabs.map((tab) => {
        const isActive =
          tab.to === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.to);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`flex items-center gap-1 sm:gap-1.5 rounded px-1.5 sm:px-2.5 py-1 text-[10px] sm:text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
              isActive
                ? "bg-red-900/30 text-red-400"
                : "text-gray-400 hover:bg-red-900/20 hover:text-gray-300"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={14} className={isActive ? "text-red-400" : "text-gray-500"} />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label === "Dashboard" ? "Home" : tab.label}</span>
          </Link>
        );
      })}

      {/* Spacer pushes counts + health + clock to the right */}
      <div className="flex-1 min-w-0" />

      {/* Service status dots - compact on mobile */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0" role="status" aria-label="Service health status">
        <div className="flex items-center gap-1" title={`Dashboard: ${getStatusLabel(health.dashboard)}`}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${getStatusColor(health.dashboard)}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline font-mono text-xs text-gray-400">WS</span>
        </div>
        <div className="flex items-center gap-1" title={`MCP Proxy: ${getStatusLabel(health.mcpProxy)}`}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${getStatusColor(health.mcpProxy)}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline font-mono text-xs text-gray-400">MCP</span>
        </div>
        <div className="flex items-center gap-1" title={`Claude Proxy: ${getStatusLabel(health.claudeProxy)}`}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${getStatusColor(health.claudeProxy)}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline font-mono text-xs text-gray-400">Proxy</span>
        </div>
        <div className="flex items-center gap-1" title={`Code Server: ${getStatusLabel(health.codeServer)}`}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${getStatusColor(health.codeServer)}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline font-mono text-xs text-gray-400">Code</span>
        </div>
      </div>

      {/* Divider - hide on mobile */}
      <div className="hidden sm:block h-4 w-px bg-red-900/50" aria-hidden="true" />

      {/* Clock - hide on mobile to save space */}
      <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-gray-400 shrink-0" aria-label={`Current time: ${time}`}>
        <Clock size={12} aria-hidden="true" />
        <span className="tabular-nums">{time}</span>
      </div>
    </nav>
  );
}
