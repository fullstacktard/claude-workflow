/**
 * Clipboard Upload Route
 *
 * Handles image paste from browser clipboard (Windows screenshot -> terminal).
 * Saves raw image binary to a shared directory accessible by Claude sessions.
 *
 * POST /api/clipboard/upload
 * - Content-Type: image/png (or image/*)
 * - Body: raw binary image data
 * - Returns: { path: "<host-path-to-image>" }
 */

import express from "express";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Request, Response, Router } from "express-serve-static-core";

/** Directory for clipboard images (matches Claude Code clipboard convention) */
const CLIPBOARD_DIR_NAME = ".cache/claude-clipboard-images";

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_ERROR = 500;

export function createClipboardRouter(): Router {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- express v5 types
  const router: Router = express.Router() as Router;

  // Parse raw binary body for image/* content types
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- express v5 types
  router.use(express.raw({ type: "image/*", limit: "10mb" }) as Parameters<Router["use"]>[0]);

  router.post("/upload", (req: Request, res: Response) => {
    try {
      const body = req.body as Buffer | undefined;
      if (!body || body.length === 0) {
        res.status(HTTP_STATUS_BAD_REQUEST).json({ error: "No image data" });
        return;
      }

      // Determine home directory inside container
      const homeDir = process.env.HOME ?? "/home/dashboard";
      const clipboardDir = join(homeDir, CLIPBOARD_DIR_NAME);

      // Ensure directory exists
      if (!existsSync(clipboardDir)) {
        mkdirSync(clipboardDir, { recursive: true });
      }

      // Count existing images for sequential naming
      const existing = readdirSync(clipboardDir).filter((f) => f.startsWith("image_"));
      const index = existing.length + 1;
      const timestamp = Date.now();
      const filename = `image_${String(index)}_${String(timestamp)}.png`;
      const containerPath = join(clipboardDir, filename);

      // Write image
      writeFileSync(containerPath, body);

      // Return host path so the terminal can reference the file.
      // HOST_HOME maps to the host's actual home directory.
      const hostHome = process.env.HOST_HOME ?? homeDir;
      const hostPath = join(hostHome, CLIPBOARD_DIR_NAME, filename);

      res.status(HTTP_STATUS_OK).json({ path: hostPath });
    } catch (error) {
      console.error("[clipboard] Upload error:", error);
      res.status(HTTP_STATUS_INTERNAL_ERROR).json({ error: "Upload failed" });
    }
  });

  return router;
}
