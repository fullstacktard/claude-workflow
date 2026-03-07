/**
 * Sparkline generation utility for data visualization
 * Used by orchestration analytics and monitor commands
 */

// Thresholds for number formatting
const BILLION_THRESHOLD = 1_000_000_000;
const MILLION_THRESHOLD = 1_000_000;
const THOUSAND_THRESHOLD = 1000;
const DECIMAL_PLACES = 1;

/**
 * Format number with 'k' suffix for readability
 * @param count - Raw number
 * @returns Formatted number (e.g., "45.2k" or "450")
 */
export function formatNumber(count: number): string {
  if (!count || count === 0) return "0";
  if (count >= BILLION_THRESHOLD) {
    return `${(count / BILLION_THRESHOLD).toFixed(DECIMAL_PLACES)}B`;
  }
  if (count >= MILLION_THRESHOLD) {
    return `${(count / MILLION_THRESHOLD).toFixed(DECIMAL_PLACES)}M`;
  }
  if (count >= THOUSAND_THRESHOLD) {
    return `${(count / THOUSAND_THRESHOLD).toFixed(DECIMAL_PLACES)}k`;
  }
  return String(count);
}

// Constants for sparkline generation
const DEFAULT_EMPTY_SPARKLINE_WIDTH = 10;

/**
 * Generate ASCII sparkline from data array
 *
 * Uses Unicode block characters to create compact line charts:
 * ▁ ▂ ▃ ▄ ▅ ▆ ▇ █
 *
 * @param data - Array of numeric values
 * @param maxWidth - Maximum width (number of characters)
 * @returns Sparkline string using Unicode blocks
 *
 * @example
 * generateSparkline([10, 20, 15, 30, 25], 5)
 * // => "▂▆▄█▇"
 *
 * generateSparkline([0, 0, 0], 3)
 * // => "▁▁▁" (all zeros show minimum)
 */
export function generateSparkline(data: number[], maxWidth: number): string {
  // Unicode block characters from minimum to maximum
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

  // Handle empty data
  if (data.length === 0) {
    return "▁".repeat(Math.min(maxWidth, DEFAULT_EMPTY_SPARKLINE_WIDTH));
  }

  // Take last maxWidth points
  const points = data.slice(-maxWidth);

  // Find min and max for normalization
  const max = Math.max(...points, 1);  // Avoid division by zero
  const min = Math.min(...points, 0);
  const range = max - min || 1;  // Avoid division by zero

  // Map each value to a block character
  return points
    .map((val: number) => {
      const normalized = Math.max(0, Math.min(1, (val - min) / range));
      const blockIdx = Math.floor(normalized * (blocks.length - 1));
      return blocks[blockIdx];
    })
    .join("");
}