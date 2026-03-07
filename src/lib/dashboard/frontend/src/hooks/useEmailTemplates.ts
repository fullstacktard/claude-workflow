/**
 * useEmailTemplates Hook
 *
 * Fetches available email templates via REST for the template selector.
 *
 * @module hooks/useEmailTemplates
 */

import { useCallback, useEffect, useState } from "react";
import type { EmailTemplate } from "../types/marketing";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** REST endpoint for email templates */
const TEMPLATES_URL = "/api/marketing/email/templates";

/** Result shape returned by useEmailTemplates */
export interface UseEmailTemplatesResult {
  /** Available email templates */
  templates: EmailTemplate[];
  /** Loading state for initial REST fetch */
  loading: boolean;
  /** Error from REST fetch */
  error: Error | null;
  /** Re-fetch template list */
  refetch: () => Promise<void>;
}

/**
 * Hook providing email template data.
 *
 * On mount:
 * 1. Fetches template list via GET /api/marketing/email/templates
 * 2. Returns typed template array with HTML and thumbnail previews
 */
export function useEmailTemplates(): UseEmailTemplatesResult {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTemplates = useCallback(async (): Promise<void> => {
    try {
      const res = await dashboardFetch(TEMPLATES_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { templates: EmailTemplate[] };
      setTemplates(data.templates ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  return { templates, loading, error, refetch: fetchTemplates };
}
