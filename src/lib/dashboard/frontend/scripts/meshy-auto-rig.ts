/**
 * Meshy Auto-Rigging Script
 *
 * Batch processes GLB character models through Meshy's auto-rigging API.
 * Outputs rigged models with walk/run animations.
 *
 * Usage:
 *   MESHY_API_KEY=your_key npx tsx scripts/meshy-auto-rig.ts
 *
 * Get API key: https://www.meshy.ai/api (free tier available)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// =============================================================================
// Configuration
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MESHY_API_KEY = process.env.MESHY_API_KEY;
const MESHY_API_BASE = "https://api.meshy.ai/openapi/v1";

// Character height in meters (for consistent scaling)
const CHARACTER_HEIGHT_METERS = 1.7;

// Input/output directories
const INPUT_DIR = path.join(__dirname, "../public/models/medieval/characters");
const OUTPUT_DIR = path.join(__dirname, "../public/models/medieval/rigged");

// Models to process (actual files in characters directory)
const MODELS_TO_RIG = [
  "base-retardio.glb",
  "blaxk.glb",
  "caroline.glb",
  "jocker.glb",  // Already rigged - skip if exists
  "retardio-red.glb",
  "sbf.glb",
  "shrek.glb",
  "spider.glb",
  "vape.glb",
  "yakub.glb",
];

// Poll interval for checking task status (ms)
const POLL_INTERVAL_MS = 5000;

// Maximum time to wait for a task (ms)
const MAX_WAIT_TIME_MS = 300000; // 5 minutes

// =============================================================================
// Types
// =============================================================================

interface RiggingTaskResponse {
  result: string;
  id?: string;
}

interface RiggingTaskStatus {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  progress: number;
  result?: {
    rigged_character_glb_url?: string;
    rigged_character_fbx_url?: string;
    basic_animations?: {
      walking_glb_url?: string;
      walking_fbx_url?: string;
      running_glb_url?: string;
      running_fbx_url?: string;
    };
  };
  task_error?: {
    message: string;
  };
}

// =============================================================================
// API Functions
// =============================================================================

async function createRiggingTask(modelUrl: string): Promise<string> {
  const response = await fetch(`${MESHY_API_BASE}/rigging`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_url: modelUrl,
      height_meters: CHARACTER_HEIGHT_METERS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create rigging task: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as RiggingTaskResponse;
  if (!data.result) {
    throw new Error("No task ID returned from Meshy API");
  }

  return data.result;
}

async function getTaskStatus(taskId: string): Promise<RiggingTaskStatus> {
  const response = await fetch(`${MESHY_API_BASE}/rigging/${taskId}`, {
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get task status: ${response.status} - ${error}`);
  }

  return (await response.json()) as RiggingTaskStatus;
}

async function waitForCompletion(taskId: string): Promise<RiggingTaskStatus> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
    const status = await getTaskStatus(taskId);

    console.log(`  Status: ${status.status} (${status.progress}%)`);

    if (status.status === "SUCCEEDED") {
      return status;
    }

    if (status.status === "FAILED" || status.status === "EXPIRED") {
      throw new Error(`Task failed: ${status.task_error?.message || "Unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Task timed out");
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

// =============================================================================
// Main Processing
// =============================================================================

async function processModel(modelName: string): Promise<void> {
  const inputPath = path.join(INPUT_DIR, modelName);
  const baseName = path.basename(modelName, ".glb");

  console.log(`\nProcessing: ${modelName}`);

  // Check if input exists
  if (!fs.existsSync(inputPath)) {
    console.log(`  ⚠️  Input file not found: ${inputPath}`);
    return;
  }

  // For local files, we need to upload to a public URL first
  // Option 1: Use a file hosting service
  // Option 2: Use Meshy's data URI format (base64)

  // Using base64 data URI for local files
  const fileBuffer = fs.readFileSync(inputPath);
  const base64Data = fileBuffer.toString("base64");
  const dataUri = `data:model/gltf-binary;base64,${base64Data}`;

  console.log(`  Creating rigging task...`);
  const taskId = await createRiggingTask(dataUri);
  console.log(`  Task ID: ${taskId}`);

  console.log(`  Waiting for completion...`);
  const result = await waitForCompletion(taskId);

  // Download results
  const outputSubDir = path.join(OUTPUT_DIR, baseName);
  fs.mkdirSync(outputSubDir, { recursive: true });

  console.log(`  Downloading rigged model...`);
  if (result.result?.rigged_character_glb_url) {
    await downloadFile(
      result.result.rigged_character_glb_url,
      path.join(outputSubDir, `${baseName}_rigged.glb`)
    );
  }

  console.log(`  Downloading walking animation...`);
  if (result.result?.basic_animations?.walking_glb_url) {
    await downloadFile(
      result.result.basic_animations.walking_glb_url,
      path.join(outputSubDir, `${baseName}_walk.glb`)
    );
  }

  console.log(`  Downloading running animation...`);
  if (result.result?.basic_animations?.running_glb_url) {
    await downloadFile(
      result.result.basic_animations.running_glb_url,
      path.join(outputSubDir, `${baseName}_run.glb`)
    );
  }

  console.log(`  ✅ Done: ${baseName}`);
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Meshy Auto-Rigging Script");
  console.log("=".repeat(60));

  if (!MESHY_API_KEY) {
    console.error("\n❌ Error: MESHY_API_KEY environment variable not set");
    console.error("\nGet your API key from: https://www.meshy.ai/api");
    console.error("Then run: MESHY_API_KEY=your_key npx tsx scripts/meshy-auto-rig.ts");
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\nInput directory: ${INPUT_DIR}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Character height: ${CHARACTER_HEIGHT_METERS}m`);
  console.log(`Models to process: ${MODELS_TO_RIG.length}`);

  // Process models sequentially (to avoid rate limits)
  let successCount = 0;
  let failCount = 0;

  for (const model of MODELS_TO_RIG) {
    try {
      await processModel(model);
      successCount++;
    } catch (error) {
      console.error(`  ❌ Failed: ${error instanceof Error ? error.message : error}`);
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Complete! ✅ ${successCount} succeeded, ❌ ${failCount} failed`);
  console.log("=".repeat(60));
}

// Run
main().catch(console.error);
