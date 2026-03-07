/**
 * SkillComplianceIndicator Component
 *
 * Displays compliance metrics between expected skills and skills actually used
 * during execution.
 *
 * Color coding:
 * - >= 80%: Green (good compliance)
 * - 50-79%: Yellow (partial compliance)
 * - < 50%: Red (poor compliance)
 */

import { useMemo } from "react";
import { Check, X } from "lucide-react";

interface SkillComplianceIndicatorProps {
  /** Skills expected from the agent */
  expectedSkills: string[];
  /** Skills actually invoked during agent execution */
  usedSkills: string[];
  /** Show compact version without skill list */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface ComplianceMetrics {
  matchedSkills: string[];
  matchedCount: number;
  totalCount: number;
  percentage: number;
  usedSet: Set<string>;
}

/**
 * Get progress bar color class based on compliance percentage
 */
function getBarColorClass(percentage: number): string {
  if (percentage >= 80) {
    return "bg-green-600";
  }
  if (percentage >= 50) {
    return "bg-yellow-600";
  }
  return "bg-red-600";
}

/**
 * Get text color class based on compliance percentage
 */
function getTextColorClass(percentage: number): string {
  if (percentage >= 80) {
    return "text-green-600";
  }
  if (percentage >= 50) {
    return "text-yellow-600";
  }
  return "text-red-600";
}

/**
 * SkillComplianceIndicator displays the percentage of expected skills that were used,
 * with a visual progress bar and optional skill list.
 */
export function SkillComplianceIndicator({
  expectedSkills,
  usedSkills,
  compact = false,
  className = "",
}: SkillComplianceIndicatorProps): JSX.Element {
  // Calculate compliance metrics
  const metrics = useMemo((): ComplianceMetrics => {
    const usedSet = new Set(usedSkills);
    const matchedSkills = expectedSkills.filter((s) => usedSet.has(s));
    const percentage =
      expectedSkills.length > 0
        ? Math.round((matchedSkills.length / expectedSkills.length) * 100)
        : 100; // 100% if no skills expected

    return {
      matchedSkills,
      matchedCount: matchedSkills.length,
      totalCount: expectedSkills.length,
      percentage,
      usedSet,
    };
  }, [expectedSkills, usedSkills]);

  const barColorClass = getBarColorClass(metrics.percentage);
  const textColorClass = getTextColorClass(metrics.percentage);

  // If no expected skills, show placeholder
  if (expectedSkills.length === 0) {
    return (
      <div className={`space-y-2 ${className}`.trim()}>
        <p className="text-gray-500 text-sm italic">
          No expected skills declared
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {/* Progress Bar */}
      <div className="bg-gray-800/50 rounded-full h-2 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
          style={{ width: `${metrics.percentage}%` }}
        />
      </div>

      {/* Text Summary */}
      <p className="text-gray-400 text-sm mb-2">
        <span className="font-mono">
          {metrics.matchedCount}/{metrics.totalCount}
        </span>{" "}
        expected skills used{" "}
        <span className={`font-mono ${textColorClass}`}>
          ({metrics.percentage}%)
        </span>
      </p>

      {/* Skills List (unless compact mode) */}
      {!compact && (
        <ul className="flex flex-wrap gap-2">
          {expectedSkills.map((skill) => {
            const isUsed = metrics.usedSet.has(skill);
            return (
              <li
                key={skill}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                  isUsed
                    ? "bg-green-900/30 text-green-400 border-1 border-green-800/50"
                    : "bg-yellow-900/20 text-yellow-400/70 border-1 border-yellow-800/30 opacity-70"
                }`}
              >
                {isUsed ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <X className="w-3 h-3" />
                )}
                {skill}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
