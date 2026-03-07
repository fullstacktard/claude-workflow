/**
 * WarmingPhaseBar - 4-segment progress bar for warming schedule phases
 *
 * Segments are proportional to phase duration:
 * Cautious (0-3d) ~18% | Building (4-7d) ~18% | Engaging (8-14d) ~32% | Maturing (15-21d) ~32%
 *
 * Visual states per segment:
 * - Completed: fully filled with phase color
 * - Active: dimmed background with partial fill overlay
 * - Upcoming: dimmed background only
 *
 * @module components/x-accounts/WarmingPhaseBar
 */

/** Warming schedule phase definition (mirrors WARMING_SCHEDULES constant) */
interface PhaseConfig {
  label: string;
  dayRange: [number, number];
  maxActions: number;
  /** Segment fill color when completed or active */
  colorClass: string;
  /** Dimmed color for upcoming segments */
  dimmedClass: string;
}

const PHASES: PhaseConfig[] = [
  {
    label: "Cautious (0-3d)",
    dayRange: [0, 3],
    maxActions: 2,
    colorClass: "bg-blue-500",
    dimmedClass: "bg-blue-500/20",
  },
  {
    label: "Building (4-7d)",
    dayRange: [4, 7],
    maxActions: 5,
    colorClass: "bg-cyan-500",
    dimmedClass: "bg-cyan-500/20",
  },
  {
    label: "Engaging (8-14d)",
    dayRange: [8, 14],
    maxActions: 10,
    colorClass: "bg-green-500",
    dimmedClass: "bg-green-500/20",
  },
  {
    label: "Maturing (15-21d)",
    dayRange: [15, 21],
    maxActions: 15,
    colorClass: "bg-purple-500",
    dimmedClass: "bg-purple-500/20",
  },
];

const FULL_ACCESS_DAY = 21;
const TOTAL_DAYS = 22; // 0 through 21 inclusive

/** Props for WarmingPhaseBar */
interface WarmingPhaseBarProps {
  /** Current warming day (0-based). From WarmingProgress.day */
  day: number;
  /** Optional: compact mode for card view (hides labels) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/** Find which phase index the given day falls into. Returns -1 if past all phases. */
function getPhaseIndex(day: number): number {
  return PHASES.findIndex(
    (p) => day >= p.dayRange[0] && day <= p.dayRange[1]
  );
}

/**
 * WarmingPhaseBar renders a 4-segment progress bar showing warming phases.
 *
 * Each segment is proportionally sized to its phase duration:
 * - Cautious: 4 days / 22 total = ~18.18%
 * - Building: 4 days / 22 total = ~18.18%
 * - Engaging: 7 days / 22 total = ~31.82%
 * - Maturing: 7 days / 22 total = ~31.82%
 */
export function WarmingPhaseBar({
  day,
  compact = false,
  className = "",
}: WarmingPhaseBarProps): JSX.Element {
  const isFullAccess = day > FULL_ACCESS_DAY;
  const activePhaseIndex = isFullAccess ? PHASES.length : getPhaseIndex(day);

  return (
    <div
      className={`flex flex-col gap-1 ${className}`}
      role="progressbar"
      aria-valuenow={Math.min(day, FULL_ACCESS_DAY)}
      aria-valuemin={0}
      aria-valuemax={FULL_ACCESS_DAY}
      aria-label={
        isFullAccess
          ? "Warming complete - Full Access"
          : `Warming progress: Day ${day} of ${FULL_ACCESS_DAY}`
      }
    >
      {/* Day counter and Full Access badge */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono">
          {isFullAccess ? "Full Access" : `Day ${day} of ${FULL_ACCESS_DAY}`}
        </span>
        {isFullAccess && (
          <span className="text-xs px-1.5 py-px rounded-full bg-green-600 text-white">
            Full Access
          </span>
        )}
      </div>

      {/* Segmented bar */}
      <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
        {PHASES.map((phase, idx) => {
          const phaseDuration = phase.dayRange[1] - phase.dayRange[0] + 1;
          const widthPercent = (phaseDuration / TOTAL_DAYS) * 100;

          const isCompleted = idx < activePhaseIndex || isFullAccess;
          const isActive = idx === activePhaseIndex && !isFullAccess;

          let segmentClass: string;
          if (isCompleted) {
            segmentClass = phase.colorClass;
          } else {
            segmentClass = phase.dimmedClass;
          }

          const progressInPhase = isActive
            ? ((day - phase.dayRange[0]) / phaseDuration) * 100
            : 0;

          return (
            <div
              key={phase.label}
              className={`relative ${segmentClass} transition-all duration-300`}
              style={{ width: `${widthPercent}%` }}
              title={`${phase.label} (max ${phase.maxActions}/day)`}
            >
              {isActive && (
                <div
                  className={`absolute inset-0 ${phase.colorClass} rounded-r-sm transition-all duration-300`}
                  style={{ width: `${progressInPhase}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Phase labels (hidden in compact mode) */}
      {!compact && (
        <div className="flex gap-0.5">
          {PHASES.map((phase, idx) => {
            const phaseDuration = phase.dayRange[1] - phase.dayRange[0] + 1;
            const widthPercent = (phaseDuration / TOTAL_DAYS) * 100;
            const isActive = idx === activePhaseIndex && !isFullAccess;
            const isCompleted = idx < activePhaseIndex || isFullAccess;

            return (
              <div
                key={phase.label}
                className="text-center overflow-hidden"
                style={{ width: `${widthPercent}%` }}
              >
                <span
                  className={`text-xs truncate block ${
                    isActive
                      ? "text-white font-medium"
                      : isCompleted
                        ? "text-gray-400"
                        : "text-gray-600"
                  }`}
                >
                  {phase.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
