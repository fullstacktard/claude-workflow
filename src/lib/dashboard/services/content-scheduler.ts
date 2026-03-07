/**
 * ContentSchedulerService - Automated content calendar publishing service
 *
 * Polls the marketing calendar for posts due for publishing and dispatches
 * them to their target platforms via MCP tools. Uses croner for cron-based
 * scheduling with overrun protection.
 *
 * Events:
 * - 'post-publishing': { postId, platform } - Post is being published
 * - 'post-published': { postId, platform, publishedAt } - Post published successfully
 * - 'post-failed': { postId, platform, error } - Post publishing failed
 *
 * @example
 * const scheduler = new ContentSchedulerService(mcpToolClient, {
 *   xAccountId: process.env.MARKETING_X_ACCOUNT_ID,
 * });
 * scheduler.start();
 */

import { EventEmitter } from "node:events";

import { Cron } from "croner";

import type { McpToolClient } from "./mcp-tool-client.js";
import { systemLogger } from "./system-logger.js";

/** Platform-specific MCP tool mapping */
const PLATFORM_PUBLISH_TOOLS: Record<string, string> = {
  x: "x_post_tweet",
  linkedin: "marketing_publish_linkedin", // stub - future implementation
  email: "marketing_publish_email", // stub - future implementation
};

/** Post data returned from marketing_list_posts MCP tool */
interface ScheduledPost {
  id: string;
  content: string;
  platform: string;
  scheduled_at: string;
  status: string;
  campaign_id?: string;
  metadata?: Record<string, unknown>;
}

/** Events emitted by the scheduler */
export interface PostPublishingEvent {
  postId: string;
  platform: string;
}

export interface PostPublishedEvent {
  postId: string;
  platform: string;
  publishedAt: string;
}

export interface PostFailedEvent {
  postId: string;
  platform: string;
  error: string;
}

/** Configuration options */
export interface ContentSchedulerOptions {
  /** Cron expression for poll interval (default: every 5 minutes) */
  pollExpression?: string;
  /** Account ID to use for X platform publishing */
  xAccountId?: string;
}

const DEFAULT_POLL_EXPRESSION = "*/5 * * * *"; // Every 5 minutes

/**
 * ContentSchedulerService polls the marketing calendar for scheduled posts
 * and publishes them to their target platforms at the scheduled time.
 *
 * Follows the same lifecycle pattern as UsageMonitor:
 * - Extends EventEmitter for event-based communication
 * - Constructor accepts dependencies and options
 * - start() / stop() lifecycle methods
 * - Safe to call start() multiple times (stops existing job first)
 */
export class ContentSchedulerService extends EventEmitter {
  private readonly mcpToolClient: McpToolClient;
  private readonly pollExpression: string;
  private readonly xAccountId: string | undefined;
  private cronJob: Cron | undefined;

  constructor(
    mcpToolClient: McpToolClient,
    options: ContentSchedulerOptions = {},
  ) {
    super();
    this.mcpToolClient = mcpToolClient;
    this.pollExpression = options.pollExpression ?? DEFAULT_POLL_EXPRESSION;
    this.xAccountId = options.xAccountId;
  }

  /**
   * Start the scheduler. Safe to call multiple times (stops existing job first).
   */
  public start(): void {
    if (this.cronJob !== undefined) {
      this.stop();
    }

    systemLogger.info("ContentScheduler", "Starting content scheduler", {
      pollExpression: this.pollExpression,
    });

    this.cronJob = new Cron(this.pollExpression, { protect: true }, () => {
      void this.pollAndPublish();
    });
  }

  /**
   * Stop the scheduler and clean up.
   */
  public stop(): void {
    if (this.cronJob !== undefined) {
      this.cronJob.stop();
      this.cronJob = undefined;
    }
    this.removeAllListeners();
    systemLogger.info("ContentScheduler", "Stopped content scheduler");
  }

  /**
   * Poll for due posts and publish them.
   * Protected by croner's overrun protection - won't overlap.
   */
  private async pollAndPublish(): Promise<void> {
    try {
      const now = new Date().toISOString();

      // Query for scheduled posts that are due
      const result = await this.mcpToolClient.callTool<{
        total: number;
        posts: ScheduledPost[];
      }>("marketing_list_posts", {
        status: "scheduled",
        end_date: now, // Posts scheduled at or before now
      });

      const duePosts = result.posts.filter(
        (p) =>
          p.scheduled_at &&
          new Date(p.scheduled_at).getTime() <= Date.now(),
      );

      if (duePosts.length === 0) {
        return;
      }

      systemLogger.info(
        "ContentScheduler",
        `Found ${String(duePosts.length)} posts due for publishing`,
      );

      // Process each post sequentially to avoid overwhelming platform APIs
      for (const post of duePosts) {
        await this.publishPost(post);
      }
    } catch (error) {
      systemLogger.error("ContentScheduler", "Error during poll cycle", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Publish a single post: transition to publishing, dispatch, then update status.
   */
  private async publishPost(post: ScheduledPost): Promise<void> {
    const { id: postId, content, platform } = post;

    try {
      // Step 1: Transition to 'publishing'
      await this.mcpToolClient.callTool("marketing_transition_post_status", {
        id: postId,
        status: "publishing",
      });

      this.emit("post-publishing", {
        postId,
        platform,
      } satisfies PostPublishingEvent);

      // Step 2: Dispatch to platform-specific publishing tool
      const toolName = PLATFORM_PUBLISH_TOOLS[platform];
      if (!toolName) {
        throw new Error(
          `No publishing tool configured for platform: ${platform}`,
        );
      }

      await this.dispatchToPlatform(toolName, platform, content);

      // Step 3: Transition to 'published'
      const publishedAt = new Date().toISOString();
      await this.mcpToolClient.callTool("marketing_transition_post_status", {
        id: postId,
        status: "published",
        published_at: publishedAt,
      });

      this.emit("post-published", {
        postId,
        platform,
        publishedAt,
      } satisfies PostPublishedEvent);
      systemLogger.info(
        "ContentScheduler",
        `Published post ${postId} to ${platform}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Transition to 'failed' with error message
      try {
        await this.mcpToolClient.callTool(
          "marketing_transition_post_status",
          {
            id: postId,
            status: "failed",
            error_message: errorMessage,
          },
        );
      } catch (transitionError) {
        systemLogger.error(
          "ContentScheduler",
          `Failed to transition post ${postId} to failed state`,
          {
            error:
              transitionError instanceof Error
                ? transitionError.message
                : String(transitionError),
          },
        );
      }

      this.emit("post-failed", {
        postId,
        platform,
        error: errorMessage,
      } satisfies PostFailedEvent);
      systemLogger.error(
        "ContentScheduler",
        `Failed to publish post ${postId}`,
        { error: errorMessage },
      );
    }
  }

  /**
   * Dispatch content to the appropriate platform publishing tool.
   */
  private async dispatchToPlatform(
    toolName: string,
    platform: string,
    content: string,
  ): Promise<void> {
    switch (platform) {
    case "x": {
      if (!this.xAccountId) {
        throw new Error(
          "No X account ID configured for publishing. Set MARKETING_X_ACCOUNT_ID environment variable.",
        );
      }
      await this.mcpToolClient.callTool(toolName, {
        account_id: this.xAccountId,
        text: content,
      });
      break;
    }
    case "linkedin":
    case "email": {
      // Stub: These platforms are not yet implemented
      throw new Error(
        `Publishing to ${platform} is not yet implemented`,
      );
    }
    default: {
      throw new Error(`Unknown platform: ${platform}`);
    }
    }
  }
}
