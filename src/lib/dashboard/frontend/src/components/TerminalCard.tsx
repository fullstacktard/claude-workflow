/**
 * TerminalCard Component
 * Reusable terminal-style card with command prompt header
 * Matches fst.wtf terminal aesthetic exactly
 *
 * Layout (matching portfolio pattern):
 * >_ command filename           <-- prompt line ABOVE container (red icon, gray command, red-300 filename)
 * ┌─────────────────────────────┐
 * │ headerText    headerActions │ <-- header inside bordered container
 * ├─────────────────────────────┤
 * │ children                    │ <-- card content
 * └─────────────────────────────┘
 *
 * @example
 * <TerminalCard
 *   command="cat"
 *   filename="README.md"
 *   headerText="system information"
 *   headerActions={<button>Action</button>}
 * >
 *   <p>Card content here</p>
 * </TerminalCard>
 */

import type { ReactNode } from "react";
import { Terminal } from "lucide-react";

/**
 * Props for TerminalCard component
 */
interface TerminalCardProps {
  /** Additional CSS classes */
  className?: string;
  /** Terminal command (e.g., "cat", "ls -la") */
  command: string;
  /** Filename/path to display after command (e.g., "README.md", "~/logs") */
  filename?: string;
  /** Header content inside the card (optional, shown in header row inside container) */
  headerText?: ReactNode;
  /** Optional actions to render on the right side of the header (inside container) */
  headerActions?: ReactNode;
  /** Optional actions to render on the right side of the prompt line (above container) */
  promptActions?: ReactNode;
  /** Card content */
  children: ReactNode;
  /** Allow content to overflow body (for dropdowns, prevents clipping) */
  allowOverflow?: boolean;
  /** Enable row dividers (border-t between siblings) for row layouts */
  divideRows?: boolean;
  /** Remove padding from body content */
  noPadding?: boolean;
}

/**
 * TerminalCard - Terminal-style card matching fst.wtf design
 *
 * Layout (matching portfolio pattern):
 * >_ command filename           <-- prompt line ABOVE container
 * ┌─────────────────────────────┐
 * │ headerText    headerActions │ <-- header inside bordered container
 * ├─────────────────────────────┤
 * │ children                    │ <-- card content
 * └─────────────────────────────┘
 */
export function TerminalCard({
  className = "",
  command,
  filename,
  headerText,
  headerActions,
  promptActions,
  children,
  allowOverflow = false,
  divideRows = false,
  noPadding = false,
}: TerminalCardProps): JSX.Element {
  // Combine with flex layout for full-height support
  // Pure Tailwind: font-mono relative isolate flex flex-col min-h-0 z-0 + pointer-events cascade
  const combinedClassName = `font-mono relative isolate flex flex-col min-h-0 z-0 pointer-events-none ${className}`.trim();
  // Use overflow-visible when allowOverflow is true to prevent dropdown clipping
  // Apply divide-y divide-red-800 when divideRows is true
  // Always hide scrollbar with scrollbar-hide class (must remain in CSS - non-standard scrollbar hiding)
  const bodyClassName = [
    allowOverflow ? "overflow-visible" : "overflow-auto scrollbar-hide",
    "flex-1 min-h-0 text-sm text-gray-300 flex flex-col",
    noPadding ? "" : "p-4",
    divideRows ? "[&>*+*]:border-t [&>*+*]:border-red-800" : "",
  ].filter(Boolean).join(" ");

  // Show header row if either headerText or headerActions is provided
  const showHeader = headerText !== undefined || headerActions !== undefined;

  return (
    <div className={combinedClassName}>
      {/* Terminal prompt line - ABOVE the bordered container (portfolio pattern) */}
      {/* Pure Tailwind: flex items-center gap-2 mb-2 shrink-0 + pointer-events cascade */}
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0 pointer-events-none [&>*]:pointer-events-auto">
        <div className="flex items-center gap-2">
          <Terminal className="w-3 h-3 sm:w-4 sm:h-4 text-red-400" />
          <span className="text-gray-400 text-xs sm:text-sm">{command}</span>
          {filename && (
            <span className="text-red-300 text-xs sm:text-sm font-mono">{filename}</span>
          )}
        </div>
        {promptActions && (
          <div className="flex items-center gap-2 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            {promptActions}
          </div>
        )}
      </div>

      {/* Bordered container starts here */}
      {/* Pure Tailwind: border border-red-800 rounded bg-gray-900/80 flex flex-col flex-1 min-h-0 relative z-[1] pointer-events-auto */}
      <div className="border border-red-800 rounded bg-gray-900/80 flex flex-col flex-1 min-h-0 relative z-[1] pointer-events-auto">
        {/* Header row inside container (headerText on left, headerActions on right) */}
        {showHeader && (
          // Pure Tailwind: bg-gray-900 px-3 sm:px-4 py-2 border-b border-red-800 flex items-center justify-between gap-2 rounded-t shrink-0 relative z-10 isolate pointer-events-auto
          <div className="bg-gray-900 px-3 sm:px-4 py-1.5 border-b border-red-800 flex items-center justify-between gap-2 rounded-t shrink-0 relative z-10 isolate pointer-events-auto">
            <div className="text-gray-400 text-xs sm:text-sm min-w-0 flex-1">
              {headerText ?? ""}
            </div>
            {headerActions && (
              <div className="flex items-center gap-1.5 shrink-0 [&_button]:pointer-events-auto [&_button]:relative [&_button]:z-[1] [&_[role=switch]]:pointer-events-auto [&_[role=switch]]:relative [&_[role=switch]]:z-[1] [&_input]:pointer-events-auto [&_input]:relative [&_input]:z-[1] [&_select]:pointer-events-auto [&_select]:relative [&_select]:z-[1] [&_a]:pointer-events-auto [&_a]:relative [&_a]:z-[1]">
                {headerActions}
              </div>
            )}
          </div>
        )}
        {/* Content area */}
        <div className={bodyClassName}>
          {children}
        </div>
      </div>
    </div>
  );
}
