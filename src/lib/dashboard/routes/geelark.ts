/**
 * GeeLark Router
 * REST API endpoints for GeeLark cloud phone management:
 * - List phones
 * - Launch/stop/destroy phones
 * - Create X accounts via cloud phone
 * - Check async job status
 * - Take screenshots
 *
 * All operations proxy through McpToolClient -> mcp-proxy -> geelark-mcp (stdio).
 */

import type { Request, Response, Router } from "express-serve-static-core";

import express from "express";

import {
  handleMcpError,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
} from "./shared/mcp-error-handler.js";
import type { McpErrorResponse, McpRouterDeps } from "./shared/mcp-error-handler.js";

/**
 * Create GeeLark router with dependencies.
 *
 * Route map:
 *   GET  /phones                       -> geelark_list_phones
 *   POST /phones/launch                -> geelark_launch_phone
 *   POST /phones/:id/stop              -> geelark_stop_phone
 *   POST /phones/:id/destroy           -> geelark_destroy_phone
 *   POST /accounts/create              -> geelark_create_x_account
 *   POST /accounts/:id/login           -> geelark_login_x_account
 *   POST /accounts/:id/tweet           -> geelark_post_tweet
 *   POST /accounts/:id/health          -> geelark_check_account_health
 *   POST /accounts/:id/refresh-cookies -> geelark_refresh_cookies
 *   GET  /jobs/:id                     -> geelark_check_job_status
 *   POST /phones/:id/screenshot        -> geelark_take_screenshot
 */
export function createGeelarkRouter({
  mcpToolClient,
}: McpRouterDeps): Router {
  const router: Router = express.Router() as Router;

  // GET /api/geelark/phones - List cloud phones
  router.get("/phones", (_req: Request, res: Response): void => {
    const handleListPhones = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool("geelark_list_phones");
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "list GeeLark phones");
      }
    };
    void handleListPhones();
  });

  // POST /api/geelark/phones/launch - Launch a cloud phone
  router.post("/phones/launch", (req: Request, res: Response): void => {
    const handleLaunch = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool(
          "geelark_launch_phone",
          req.body as Record<string, unknown>,
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "launch GeeLark phone");
      }
    };
    void handleLaunch();
  });

  // POST /api/geelark/phones/:id/stop - Stop a cloud phone
  router.post("/phones/:id/stop", (req: Request, res: Response): void => {
    const handleStop = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool("geelark_stop_phone", {
          phone_id: req.params.id,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "stop GeeLark phone");
      }
    };
    void handleStop();
  });

  // POST /api/geelark/phones/:id/destroy - Destroy a cloud phone
  router.post("/phones/:id/destroy", (req: Request, res: Response): void => {
    const handleDestroy = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool("geelark_destroy_phone", {
          phone_id: req.params.id,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "destroy GeeLark phone");
      }
    };
    void handleDestroy();
  });

  // POST /api/geelark/accounts/create - Start X account creation via cloud phone
  // phone_id is optional: the MCP tool pipeline auto-creates a phone when omitted
  router.post("/accounts/create", (req: Request, res: Response): void => {
    const handleCreate = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool(
          "geelark_create_x_account",
          req.body as Record<string, unknown>,
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "create X account via GeeLark");
      }
    };
    void handleCreate();
  });

  // GET /api/geelark/jobs/:id - Check async job status
  router.get("/jobs/:id", (req: Request, res: Response): void => {
    const handleJobStatus = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool(
          "geelark_check_job_status",
          { job_id: req.params.id },
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "check GeeLark job status");
      }
    };
    void handleJobStatus();
  });

  // POST /api/geelark/phones/:id/screenshot - Take screenshot of phone
  router.post(
    "/phones/:id/screenshot",
    (req: Request, res: Response): void => {
      const handleScreenshot = async (): Promise<void> => {
        try {
          const result = await mcpToolClient.callTool(
            "geelark_take_screenshot",
            { phone_id: req.params.id },
          );
          res.status(HTTP_STATUS_OK).json(result);
        } catch (error) {
          handleMcpError(res, error, "take GeeLark screenshot");
        }
      };
      void handleScreenshot();
    },
  );

  // GET /api/geelark/screenshots/:taskId - Poll screenshot capture status
  router.get(
    "/screenshots/:taskId",
    (req: Request, res: Response): void => {
      const handleScreenshotStatus = async (): Promise<void> => {
        try {
          const result = await mcpToolClient.callTool(
            "geelark_screenshot_result",
            { task_id: req.params.taskId },
          );
          res.status(HTTP_STATUS_OK).json(result);
        } catch (error) {
          handleMcpError(res, error, "check GeeLark screenshot status");
        }
      };
      void handleScreenshotStatus();
    },
  );

  // POST /api/geelark/jobs/:id/retry - Retry a failed job by starting a new creation
  router.post("/jobs/:id/retry", (req: Request, res: Response): void => {
    const handleRetry = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool(
          "geelark_create_x_account",
          req.body as Record<string, unknown>,
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "retry GeeLark job");
      }
    };
    void handleRetry();
  });

  // POST /api/geelark/accounts/:id/login - Login to X account on cloud phone
  router.post("/accounts/:id/login", (req: Request, res: Response): void => {
    const { phone_id } = req.body as { phone_id?: string };
    if (!phone_id) {
      const body: McpErrorResponse = {
        error: "Validation error",
        message: "phone_id is required",
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(body);
      return;
    }

    const handleLogin = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool(
          "geelark_login_x_account",
          { account_id: req.params.id, phone_id },
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "login to X account via GeeLark");
      }
    };
    void handleLogin();
  });

  // POST /api/geelark/accounts/:id/tweet - Post tweet from X account on cloud phone
  router.post("/accounts/:id/tweet", (req: Request, res: Response): void => {
    const { phone_id, text } = req.body as {
      phone_id?: string;
      text?: string;
    };
    if (!phone_id) {
      const body: McpErrorResponse = {
        error: "Validation error",
        message: "phone_id is required",
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(body);
      return;
    }
    if (!text || text.trim().length === 0) {
      const body: McpErrorResponse = {
        error: "Validation error",
        message: "text is required and must be non-empty",
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(body);
      return;
    }
    const MAX_TWEET_LENGTH = 280;
    if (text.length > MAX_TWEET_LENGTH) {
      const body: McpErrorResponse = {
        error: "Validation error",
        message: `text must be ${String(MAX_TWEET_LENGTH)} characters or fewer (got ${String(text.length)})`,
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(body);
      return;
    }

    const handleTweet = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool("geelark_post_tweet", {
          account_id: req.params.id,
          phone_id,
          text,
        });
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "post tweet via GeeLark");
      }
    };
    void handleTweet();
  });

  // POST /api/geelark/accounts/:id/health - Check X account health on cloud phone
  router.post("/accounts/:id/health", (req: Request, res: Response): void => {
    const { phone_id } = req.body as { phone_id?: string };
    if (!phone_id) {
      const body: McpErrorResponse = {
        error: "Validation error",
        message: "phone_id is required",
      };
      res.status(HTTP_STATUS_BAD_REQUEST).json(body);
      return;
    }

    const handleHealth = async (): Promise<void> => {
      try {
        const result = await mcpToolClient.callTool(
          "geelark_check_account_health",
          { account_id: req.params.id, phone_id },
        );
        res.status(HTTP_STATUS_OK).json(result);
      } catch (error) {
        handleMcpError(res, error, "check X account health via GeeLark");
      }
    };
    void handleHealth();
  });

  // POST /api/geelark/accounts/:id/refresh-cookies - Refresh cookies (synchronous)
  router.post(
    "/accounts/:id/refresh-cookies",
    (req: Request, res: Response): void => {
      const { phone_id } = req.body as { phone_id?: string };
      if (!phone_id) {
        const body: McpErrorResponse = {
          error: "Validation error",
          message: "phone_id is required",
        };
        res.status(HTTP_STATUS_BAD_REQUEST).json(body);
        return;
      }

      const handleRefreshCookies = async (): Promise<void> => {
        try {
          const result = await mcpToolClient.callTool(
            "geelark_refresh_cookies",
            { account_id: req.params.id, phone_id },
          );
          res.status(HTTP_STATUS_OK).json(result);
        } catch (error) {
          handleMcpError(res, error, "refresh cookies via GeeLark");
        }
      };
      void handleRefreshCookies();
    },
  );

  return router;
}
