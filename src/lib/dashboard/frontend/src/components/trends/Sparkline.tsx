/**
 * Sparkline Component
 *
 * Lightweight inline SVG sparkline chart using <polyline> and an optional
 * filled <polygon>. No external dependencies -- pure React + SVG.
 *
 * @module components/trends/Sparkline
 */

interface SparklineProps {
  /** Array of numeric data points */
  values: number[];
  /** SVG width in pixels (default: 60) */
  width?: number;
  /** SVG height in pixels (default: 16) */
  height?: number;
  /** Stroke color for the line (default: "#22d3ee" -- cyan-400) */
  lineColor?: string;
  /** Stroke width (default: 1.5) */
  lineWidth?: number;
  /** Fill color below the line (default: "rgba(34,211,238,0.15)") */
  fillColor?: string;
  /** Additional CSS class */
  className?: string;
}

/**
 * Converts an array of values into SVG coordinate points.
 * Normalizes values to fit within the given width/height with 1px padding.
 */
function valuesToPoints(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `${String(width / 2)},${String(height / 2)}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // Avoid division by zero

  const padding = 1;
  const drawHeight = height - padding * 2;
  const stepX = (width - padding * 2) / (values.length - 1);

  return values
    .map((value, index) => {
      const x = padding + index * stepX;
      // Invert Y axis: high values = top of SVG
      const y = padding + drawHeight - ((value - min) / range) * drawHeight;
      return `${String(Math.round(x * 10) / 10)},${String(Math.round(y * 10) / 10)}`;
    })
    .join(" ");
}

export function Sparkline({
  values,
  width = 60,
  height = 16,
  lineColor = "#22d3ee",
  lineWidth = 1.5,
  fillColor = "rgba(34,211,238,0.15)",
  className,
}: SparklineProps): JSX.Element {
  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
      />
    );
  }

  const points = valuesToPoints(values, width, height);

  // Build polygon points for the filled area (line points + bottom-right + bottom-left)
  const padding = 1;
  const fillPoints = `${points} ${String(width - padding)},${String(height - padding)} ${String(padding)},${String(height - padding)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className={className}
      aria-hidden="true"
      role="img"
    >
      {/* Filled area below the line */}
      <polygon
        points={fillPoints}
        fill={fillColor}
        stroke="none"
      />
      {/* Line on top */}
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
