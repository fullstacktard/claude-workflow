/**
 * AdminLayout
 *
 * Wraps all admin routes with:
 * - AdminAuthProvider (login gate)
 * - Left sidebar navigation (w-56)
 * - Main content area with <Outlet />
 *
 * Sidebar sections:
 *   Overview, Revenue, Subscribers, Features, Pricing, Deploy
 */

import { Link, Outlet, useLocation } from "react-router-dom";
import {
  CreditCard,
  LayoutDashboard,
  Lock,
  Package,
  Rocket,
  Tags,
  Users,
} from "lucide-react";

import {
  AdminAuthProvider,
  AdminLogoutButton,
} from "../contexts/AdminAuthContext";

/* -- Types --------------------------------------------------------------- */

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

/* -- Navigation Items ---------------------------------------------------- */

const navItems: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/revenue", label: "Revenue", icon: CreditCard },
  { to: "/admin/subscribers", label: "Subscribers", icon: Users },
  { to: "/admin/features", label: "Features", icon: Package },
  { to: "/admin/pricing", label: "Pricing", icon: Tags },
  { to: "/admin/deploy", label: "Deploy", icon: Rocket },
];

/* -- Sidebar ------------------------------------------------------------- */

function AdminSidebar(): JSX.Element {
  const location = useLocation();

  /**
   * Determine if a nav item is active.
   * For "/admin" (Overview), only match exact path.
   * For sub-routes, match prefix.
   */
  const isActive = (to: string): boolean => {
    if (to === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(to);
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-4">
        <Lock size={16} className="text-red-400" aria-hidden="true" />
        <span className="font-mono text-sm font-semibold text-gray-100">
          Admin Panel
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Admin navigation">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs transition-colors ${
                    active
                      ? "bg-red-900/30 text-red-400"
                      : "text-gray-400 hover:bg-red-900/20 hover:text-gray-300"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    size={14}
                    className={active ? "text-red-400" : "text-gray-500"}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer -- logout */}
      <div className="border-t border-gray-800 px-2 py-2">
        <AdminLogoutButton />
      </div>
    </aside>
  );
}

/* -- Layout -------------------------------------------------------------- */

/**
 * AdminLayout renders the full admin shell:
 * 1. AdminAuthProvider gates access (shows login if no token)
 * 2. Sidebar + content area side by side
 * 3. <Outlet /> renders the active admin route's page
 */
export function AdminLayout(): JSX.Element {
  return (
    <AdminAuthProvider>
      <div className="flex h-full bg-gray-950">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </AdminAuthProvider>
  );
}
