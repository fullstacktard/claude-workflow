/**
 * Admin-only route definitions.
 * These routes are ONLY available in the admin build (admin-main.tsx).
 * They are NEVER imported by the public main.tsx entry point.
 *
 * Uses nested routing with AdminLayout as the parent element.
 * AdminLayout provides the auth gate + sidebar + <Outlet />.
 */

import { Route } from "react-router-dom";

import { AdminLayout } from "./components/AdminLayout";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SubscribersPage } from "./pages/SubscribersPage";
import { FeatureTogglesPage } from "./pages/FeatureTogglesPage";
import PricingPage from "./pages/PricingPage";
import { DeployPage } from "./pages/DeployPage";

/**
 * Returns admin route tree for inclusion in the top-level <Routes>.
 *
 * The parent "/admin" route renders AdminLayout which provides:
 *   - AdminAuthProvider (login gate)
 *   - Sidebar navigation
 *   - <Outlet /> for child routes
 *
 * Child routes render inside the <Outlet />.
 */
export function AdminRoutes(): JSX.Element {
  return (
    <Route element={<AdminLayout />} path="/admin">
      {/* Index route -- admin overview dashboard */}
      <Route element={<AdminDashboardPage />} index />

      {/* Revenue analytics */}
      <Route element={<DashboardPage />} path="revenue" />

      {/* Subscriber management */}
      <Route element={<SubscribersPage />} path="subscribers" />

      {/* Feature toggle matrix */}
      <Route element={<FeatureTogglesPage />} path="features" />

      {/* Pricing editor */}
      <Route element={<PricingPage />} path="pricing" />

      {/* Deploy pipeline */}
      <Route element={<DeployPage />} path="deploy" />
    </Route>
  );
}
