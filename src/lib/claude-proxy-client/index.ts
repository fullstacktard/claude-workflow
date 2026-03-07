/**
 * Backward compatibility re-exports for claude-proxy
 * Consumers can continue importing from this location
 *
 * This file re-exports all public APIs from the claude-proxy package,
 * which has been extracted to packages/claude-proxy/.
 *
 * @example
 * // Import from this compatibility layer:
 * import { loadClaudeProxyConfig } from '../claude-proxy-client/index.js';
 *
 * // Or use the claude-proxy package:
 * import { loadClaudeProxyConfig } from 'claude-proxy';
 */
export * from "@fst/claude-proxy";
