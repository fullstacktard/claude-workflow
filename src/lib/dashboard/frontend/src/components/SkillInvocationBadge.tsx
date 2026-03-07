/**
 * SkillInvocationBadge Component
 *
 * Compact badge display for skill invocation.
 * Shows skill name and optional agent context.
 */

/**
 * Skill invocation event data structure
 */
export interface SkillInvocationBadgeEvent {
  type: "skill_invocation";
  skill: string;
  agentContext?: string;
}

interface SkillInvocationBadgeProps {
  /** The skill invocation event */
  event: SkillInvocationBadgeEvent;
  /** Show compact version without context */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * SkillInvocationBadge displays a skill invocation as a compact inline badge.
 */
export function SkillInvocationBadge({
  event,
  compact = false,
  className = "",
}: SkillInvocationBadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs bg-gray-800/50 border border-gray-700 ${className}`.trim()}
    >
      {/* Skill Name */}
      <span className="text-gray-200 font-medium">
        {event.skill}
      </span>

      {/* Agent Context (if present and not compact) */}
      {!compact && event.agentContext && (
        <span className="text-gray-500">
          <span className="mx-1">in</span>
          <span className="text-gray-400">{event.agentContext}</span>
        </span>
      )}
    </span>
  );
}
