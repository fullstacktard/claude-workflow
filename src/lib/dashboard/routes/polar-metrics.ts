/**
 * Polar Metrics Router
 * REST API proxy for Polar.sh revenue analytics.
 * Calls Polar Metrics API directly with Bearer token auth.
 * Includes in-memory caching with 5-minute TTL.
 *
 * Route map:
 *   GET  /           -> Polar GET /v1/metrics/ (full proxy)
 *   GET  /summary    -> Polar GET /v1/metrics/ (curated KPIs, flat response)
 *
 * Auth: Requires CLAUDE_WORKFLOW_ADMIN_TOKEN via admin-auth middleware.
 * Cache: In-memory Map with 5-minute TTL, lazy eviction on miss.
 * Env:   POLAR_API_KEY - Polar Organization Access Token with metrics:read scope.
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";

import { createAdminAuthMiddleware } from "../middleware/admin-auth.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const POLAR_API_BASE = "https://api.polar.sh/v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const POLAR_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

// HTTP status codes (project convention: each route file defines its own)
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const HTTP_STATUS_BAD_GATEWAY = 502;

// ─── TypeScript Interfaces ───────────────────────────────────────────────────

/** A single time period in the metrics response */
export interface MetricPeriod {
  timestamp: string;
  [metricSlug: string]: string | number | null | undefined;
}

/** Aggregated totals across the full date range */
export interface MetricsTotals {
  [metricSlug: string]: number | null | undefined;
}

/** Metadata about a metric describing how to format/display it */
export interface MetricMetadata {
  slug: string;
  display_name: string;
  type: "scalar" | "currency" | "currency_sub_cent" | "percentage";
}

/** Polar Metrics API response shape (GET /v1/metrics/) */
export interface PolarMetricsResponse {
  periods: MetricPeriod[];
  totals: MetricsTotals;
  metrics: Record<string, MetricMetadata>;
}

/** Summary response shape returned to frontend */
export interface KpiSummary {
  mrr: number;
  activeSubscriptions: number;
  revenue: number;
  churnRate: number;
  arpu: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
  periodStart: string;
  periodEnd: string;
}

// ─── Cache Infrastructure ────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  expiry: number;
}

const metricsCache = new Map<string, CacheEntry>();

/**
 * Build a deterministic cache key from query parameters.
 * Sorts param names to ensure consistent keys regardless of query param order.
 */
function buildCacheKey(params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    const val = params[key];
    if (Array.isArray(val)) {
      parts.push(`${key}=${[...val].sort().join(",")}`);
    } else {
      parts.push(`${key}=${val}`);
    }
  }
  return `polar-metrics:${parts.join("&")}`;
}

/**
 * Get cached data if still valid (not expired).
 * Lazily deletes expired entries.
 */
function getCached(key: string): unknown {
  const entry = metricsCache.get(key);
  if (!entry) return undefined;
  if (entry.expiry < Date.now()) {
    metricsCache.delete(key);
    return undefined;
  }
  return entry.data;
}

/**
 * Store data in cache with TTL.
 */
function setCache(key: string, data: unknown): void {
  metricsCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// ─── Curated KPI Metrics ─────────────────────────────────────────────────────

/** Curated KPI metrics for the summary endpoint */
const KPI_METRICS = [
  "monthly_recurring_revenue",
  "active_subscriptions",
  "revenue",
  "churn_rate",
  "average_revenue_per_user",
  "new_subscriptions",
  "churned_subscriptions",
] as const;

/** Valid Polar API interval values */
const VALID_INTERVALS = ["hour", "day", "week", "month", "year"];

// ─── Router Factory ──────────────────────────────────────────────────────────

/**
 * Create the Polar metrics router.
 *
 * Mounts two routes:
 *   GET /          - Full proxy to Polar GET /v1/metrics/
 *   GET /summary   - Curated KPIs with cents-to-dollars conversion
 *
 * Admin authentication is applied to all routes via createAdminAuthMiddleware.
 * If CLAUDE_WORKFLOW_ADMIN_TOKEN is not set, all requests receive 401.
 *
 * @returns Express Router instance
 */
export function createPolarMetricsRouter(): Router {
  const router: Router = express.Router() as Router;

  // Apply admin auth middleware when token is configured.
  // When not set (local dev), requests pass through unauthenticated —
  // server.ts controls whether this router is reachable at all.
  const adminToken = process.env["CLAUDE_WORKFLOW_ADMIN_TOKEN"];
  if (adminToken) {
    router.use(createAdminAuthMiddleware(adminToken));
  }

  // ─── GET / ── Full metrics proxy ─────────────────────────────────────────

  router.get("/", async (req: Request, res: Response): Promise<void> => {
    const apiKey = process.env["POLAR_API_KEY"];
    if (!apiKey) {
      res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
        error:
          "Polar API key not configured. Set POLAR_API_KEY environment variable.",
      });
      return;
    }

    const { start_date, end_date, interval, product_id, metrics, timezone } =
      req.query as Record<string, string | undefined>;

    // Validate required params
    if (!start_date || !end_date || !interval) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({
        error:
          "Missing required query parameters: start_date, end_date, interval",
      });
      return;
    }

    if (!VALID_INTERVALS.includes(interval)) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({
        error: `Invalid interval. Must be one of: ${VALID_INTERVALS.join(", ")}`,
      });
      return;
    }

    // Build cache key from all params
    const queryParams: Record<string, string | string[]> = {
      start_date,
      end_date,
      interval,
    };
    if (product_id) queryParams["product_id"] = product_id;
    if (timezone) queryParams["timezone"] = timezone;

    // Handle metrics as comma-separated or repeated params
    const metricsArr = metrics
      ? metrics.split(",").map((m) => m.trim())
      : [];
    if (metricsArr.length > 0) queryParams["metrics"] = metricsArr;

    const cacheKey = buildCacheKey(queryParams);
    const cached = getCached(cacheKey);
    if (cached) {
      res.status(HTTP_STATUS_OK).json(cached);
      return;
    }

    // Build Polar API URL
    const url = new URL(`${POLAR_API_BASE}/metrics/`);
    url.searchParams.set("start_date", start_date);
    url.searchParams.set("end_date", end_date);
    url.searchParams.set("interval", interval);
    if (product_id) url.searchParams.set("product_id", product_id);
    if (timezone) url.searchParams.set("timezone", timezone);
    for (const m of metricsArr) {
      url.searchParams.append("metrics", m);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        POLAR_REQUEST_TIMEOUT_MS,
      );

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const statusCode =
          response.status >= 400 && response.status < 500
            ? response.status
            : HTTP_STATUS_BAD_GATEWAY;
        res.status(statusCode).json({
          error: `Polar API error: ${String(response.status)}`,
          details: errorText,
        });
        return;
      }

      const data = (await response.json()) as PolarMetricsResponse;
      setCache(cacheKey, data);
      res.status(HTTP_STATUS_OK).json(data);
    } catch (error: unknown) {
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      res.status(HTTP_STATUS_BAD_GATEWAY).json({
        error: isTimeout
          ? "Polar API request timed out"
          : "Failed to reach Polar API",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ─── GET /summary ── Curated KPIs ────────────────────────────────────────

  router.get(
    "/summary",
    async (req: Request, res: Response): Promise<void> => {
      const apiKey = process.env["POLAR_API_KEY"];
      if (!apiKey) {
        res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
          error:
            "Polar API key not configured. Set POLAR_API_KEY environment variable.",
        });
        return;
      }

      const { start_date, end_date, interval, product_id } = req.query as Record<
        string,
        string | undefined
      >;

      if (!start_date || !end_date) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "Missing required query parameters: start_date, end_date",
        });
        return;
      }

      const effectiveInterval = interval ?? "day";

      const queryParams: Record<string, string | string[]> = {
        start_date,
        end_date,
        interval: effectiveInterval,
        metrics: [...KPI_METRICS],
        _route: "summary", // differentiates cache key from GET /
      };
      if (product_id) queryParams["product_id"] = product_id;

      const cacheKey = buildCacheKey(queryParams);
      const cached = getCached(cacheKey);
      if (cached) {
        res.status(HTTP_STATUS_OK).json(cached);
        return;
      }

      const url = new URL(`${POLAR_API_BASE}/metrics/`);
      url.searchParams.set("start_date", start_date);
      url.searchParams.set("end_date", end_date);
      url.searchParams.set("interval", effectiveInterval);
      if (product_id) url.searchParams.set("product_id", product_id);
      for (const m of KPI_METRICS) {
        url.searchParams.append("metrics", m);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          POLAR_REQUEST_TIMEOUT_MS,
        );

        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          const statusCode =
            response.status >= 400 && response.status < 500
              ? response.status
              : HTTP_STATUS_BAD_GATEWAY;
          res.status(statusCode).json({
            error: `Polar API error: ${String(response.status)}`,
            details: errorText,
          });
          return;
        }

        const raw = (await response.json()) as PolarMetricsResponse;
        const totals = raw.totals;

        // Convert cents to dollars for currency metrics
        const summary: KpiSummary = {
          mrr: ((totals["monthly_recurring_revenue"] as number) ?? 0) / 100,
          activeSubscriptions:
            (totals["active_subscriptions"] as number) ?? 0,
          revenue: ((totals["revenue"] as number) ?? 0) / 100,
          churnRate: (totals["churn_rate"] as number) ?? 0,
          arpu:
            ((totals["average_revenue_per_user"] as number) ?? 0) / 100,
          newSubscriptions:
            (totals["new_subscriptions"] as number) ?? 0,
          churnedSubscriptions:
            (totals["churned_subscriptions"] as number) ?? 0,
          periodStart: start_date,
          periodEnd: end_date,
        };

        setCache(cacheKey, summary);
        res.status(HTTP_STATUS_OK).json(summary);
      } catch (error: unknown) {
        const isTimeout =
          error instanceof Error && error.name === "AbortError";
        res.status(HTTP_STATUS_BAD_GATEWAY).json({
          error: isTimeout
            ? "Polar API request timed out"
            : "Failed to reach Polar API",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  return router;
}
