/**
 * useLicenses Hook
 *
 * Fetches license keys for a given customer from /api/admin/licenses.
 * Provides a revokeLicense mutation with optimistic UI update.
 * Follows the useMetrics/useCompetitors hook pattern.
 */

import { useCallback, useEffect, useState } from "react";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import type { LicenseKeyWithActivations, PaginatedResponse } from "../types/admin";

const LICENSES_URL = "/api/admin/licenses";

export interface UseLicensesResult {
  licenses: LicenseKeyWithActivations[];
  loading: boolean;
  error: Error | null;
  revokeLicense: (licenseKeyId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useLicenses(customerId: string | null): UseLicensesResult {
  const [licenses, setLicenses] = useState<LicenseKeyWithActivations[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchLicenses = useCallback(async (): Promise<void> => {
    if (!customerId) {
      setLicenses([]);
      return;
    }
    setLoading(true);
    try {
      const res = await dashboardFetch(
        `${LICENSES_URL}?customer_id=${encodeURIComponent(customerId)}`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as PaginatedResponse<LicenseKeyWithActivations>;
      setLicenses(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void fetchLicenses();
  }, [fetchLicenses]);

  const revokeLicense = useCallback(async (licenseKeyId: string): Promise<void> => {
    const res = await dashboardFetch(`${LICENSES_URL}/${licenseKeyId}/revoke`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
        error?: string;
      };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    // Optimistic update: mark the license as revoked in local state
    setLicenses((prev) =>
      prev.map((lic) =>
        lic.id === licenseKeyId ? { ...lic, status: "revoked" as const } : lic,
      ),
    );
  }, []);

  return { licenses, loading, error, revokeLicense, refetch: fetchLicenses };
}
