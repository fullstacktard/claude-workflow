/**
 * Deploy Router
 * REST API endpoints for triggering and monitoring GitHub Actions deploy pipelines.
 *
 * Endpoints:
 * - POST /api/deploy/trigger     - Trigger a workflow_dispatch deploy
 * - GET  /api/deploy/status/:runId - Poll deploy run status with per-job details
 * - GET  /api/deploy/history     - List recent deploy workflow runs
 */

import type { Request, Response, Router } from "express-serve-static-core";
import express from "express";

// HTTP status codes (following project convention - each route file has its own)
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_ACCEPTED = 202;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const HTTP_STATUS_INTERNAL_ERROR = 500;

const GITHUB_API = "https://api.github.com";
const OWNER = "fullstacktard";
const REPO = "claude-workflow";
const WORKFLOW_FILE = "admin-deploy.yml";

/** Timeout for GitHub API requests */
const GITHUB_API_TIMEOUT_MS = 10_000;

/** Delay before polling for the run ID after dispatch */
const POST_DISPATCH_DELAY_MS = 3000;

// ───────────────────────────── Types ──────────────────────────────

/** Valid deploy targets */
type DeployTarget = "worker" | "npm" | "landing";

/** Valid npm version bump levels */
type BumpType = "none" | "patch" | "minor" | "major";

/** Request body for POST /trigger */
interface TriggerDeployBody {
  targets: DeployTarget[];
  bumpType: BumpType;
  dryRun: boolean;
  changeSummary: string;
}

/** Per-job status in a workflow run */
interface JobStatus {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** Workflow run status response */
interface DeployRunStatus {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  jobs: JobStatus[];
  createdAt: string;
  updatedAt: string;
}

/** Deploy history entry */
interface DeployHistoryEntry {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  displayTitle: string;
  actor: string;
}

/** Dependencies for the deploy router */
export interface DeployRouterConfig {
  /**
   * GitHub PAT with actions:write permission.
   * Read from environment variable GITHUB_DEPLOY_PAT at startup.
   * Never exposed to the browser.
   */
  githubToken: string;
}

// ───────────────────────────── Helpers ──────────────────────────────

/**
 * Helper: Make an authenticated GitHub API request with timeout.
 */
async function githubFetch(
  url: string,
  githubToken: string,
  options: RequestInit = {},
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ───────────────────────────── Router Factory ──────────────────────────────

/**
 * Create deploy router with GitHub token dependency.
 *
 * Factory pattern follows existing route conventions (health.ts, stats.ts).
 * Mounts at /api/deploy and provides /trigger, /status/:runId, /history sub-routes.
 */
export function createDeployRouter(config: DeployRouterConfig): Router {
  const router: Router = express.Router() as Router;

  /**
   * POST /api/deploy/trigger
   * Triggers a GitHub Actions workflow_dispatch for the admin-deploy pipeline.
   * Returns 202 Accepted with the run ID (or null if run not found yet).
   */
  router.post("/trigger", async (req: Request, res: Response): Promise<void> => {
    if (config.githubToken === "") {
      res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
        error: "Deploy not configured: GITHUB_DEPLOY_PAT environment variable is missing",
      });
      return;
    }

    try {
      const body = req.body as TriggerDeployBody;

      // Validate targets
      const validTargets = new Set<DeployTarget>(["worker", "npm", "landing"]);
      const targets = body.targets?.filter((t) => validTargets.has(t));
      if (!targets || targets.length === 0) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          error: "At least one valid target required (worker, npm, landing)",
        });
        return;
      }

      // Validate bump type
      const validBumps: BumpType[] = ["none", "patch", "minor", "major"];
      const bumpType = validBumps.includes(body.bumpType) ? body.bumpType : "none";

      // Trigger the workflow
      const dispatchRes = await githubFetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        config.githubToken,
        {
          method: "POST",
          body: JSON.stringify({
            ref: "main",
            inputs: {
              targets: targets.join(","),
              bump_type: bumpType,
              dry_run: String(body.dryRun === true),
              change_summary: body.changeSummary ?? "",
            },
          }),
        },
      );

      if (!dispatchRes.ok) {
        const errorText = await dispatchRes.text();
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          error: `GitHub API error: ${String(dispatchRes.status)}`,
          details: errorText,
        });
        return;
      }

      // Wait briefly then try to find the newly created run
      await new Promise((resolve) => setTimeout(resolve, POST_DISPATCH_DELAY_MS));

      const runsRes = await githubFetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/runs?event=workflow_dispatch&per_page=1`,
        config.githubToken,
      );

      let runId: number | null = null;
      if (runsRes.ok) {
        const runsData = (await runsRes.json()) as {
          workflow_runs?: Array<{ id: number; status: string }>;
        };
        runId = runsData.workflow_runs?.[0]?.id ?? null;
      }

      res.status(HTTP_STATUS_ACCEPTED).json({
        message: "Deploy triggered successfully",
        runId,
        targets,
        bumpType,
        dryRun: body.dryRun === true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to trigger deploy",
        details: message,
      });
    }
  });

  /**
   * GET /api/deploy/status/:runId
   * Polls a specific workflow run for status and per-job details.
   */
  router.get("/status/:runId", async (req: Request, res: Response): Promise<void> => {
    if (config.githubToken === "") {
      res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
        error: "Deploy not configured: GITHUB_DEPLOY_PAT environment variable is missing",
      });
      return;
    }

    try {
      const rawRunId = req.params.runId;
      const runIdStr = Array.isArray(rawRunId) ? rawRunId[0] : rawRunId;
      const runId = Number.parseInt(runIdStr ?? "", 10);
      if (Number.isNaN(runId)) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "Invalid run ID" });
        return;
      }

      // Fetch run status
      const runRes = await githubFetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/runs/${String(runId)}`,
        config.githubToken,
      );

      if (!runRes.ok) {
        res.status(runRes.status).json({
          error: `GitHub API error: ${String(runRes.status)}`,
        });
        return;
      }

      const run = (await runRes.json()) as {
        id: number;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
        updated_at: string;
      };

      // Fetch job details
      const jobsRes = await githubFetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/runs/${String(runId)}/jobs`,
        config.githubToken,
      );

      let jobs: JobStatus[] = [];
      if (jobsRes.ok) {
        const jobsData = (await jobsRes.json()) as {
          jobs?: Array<{
            name: string;
            status: string;
            conclusion: string | null;
            started_at: string | null;
            completed_at: string | null;
          }>;
        };
        jobs =
          jobsData.jobs?.map((j) => ({
            name: j.name,
            status: j.status,
            conclusion: j.conclusion,
            startedAt: j.started_at,
            completedAt: j.completed_at,
          })) ?? [];
      }

      const result: DeployRunStatus = {
        runId: run.id,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
        jobs,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      };

      res.status(HTTP_STATUS_OK).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to fetch deploy status",
        details: message,
      });
    }
  });

  /**
   * GET /api/deploy/history
   * Returns recent admin-deploy workflow runs for deploy history display.
   * Query params: ?limit=10 (default 10, max 30)
   */
  router.get("/history", async (req: Request, res: Response): Promise<void> => {
    if (config.githubToken === "") {
      res.status(HTTP_STATUS_SERVICE_UNAVAILABLE).json({
        error: "Deploy not configured: GITHUB_DEPLOY_PAT environment variable is missing",
      });
      return;
    }

    try {
      const limit = Math.min(Number.parseInt(req.query.limit as string, 10) || 10, 30);

      const runsRes = await githubFetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${String(limit)}`,
        config.githubToken,
      );

      if (!runsRes.ok) {
        res.status(runsRes.status).json({
          error: `GitHub API error: ${String(runsRes.status)}`,
        });
        return;
      }

      const runsData = (await runsRes.json()) as {
        workflow_runs?: Array<{
          id: number;
          status: string;
          conclusion: string | null;
          html_url: string;
          created_at: string;
          updated_at: string;
          display_title: string;
          actor?: { login: string };
        }>;
      };

      const history: DeployHistoryEntry[] =
        runsData.workflow_runs?.map((run) => ({
          runId: run.id,
          status: run.status,
          conclusion: run.conclusion,
          htmlUrl: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          displayTitle: run.display_title,
          actor: run.actor?.login ?? "unknown",
        })) ?? [];

      res.status(HTTP_STATUS_OK).json(history);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({
        error: "Failed to fetch deploy history",
        details: message,
      });
    }
  });

  return router;
}
