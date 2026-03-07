/**
 * Init module - preflight detection for the guided init flow.
 *
 * Re-exports all public types and functions from the preflight module
 * for clean imports: `import { preflight } from "./init/index.js"`
 */

export {
  checkBinary,
  checkGhAuth,
  detectPlatform,
  preflight,
} from "./preflight.js";

export type {
  BinaryInfo,
  GhAuthStatus,
  ParsedVersion,
  PlatformType,
  PreflightResult,
} from "./preflight.js";
