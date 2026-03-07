/**
 * AgentInvocationCard Component
 *
 * Displays agent invocation event with expectedSkills compliance tracking.
 * Shows what skills an agent declared vs what it actually used,
 * enabling compliance monitoring for agent behavior.
 *
 * Sections:
 * - Header: Agent name and truncated toolUseId
 * - Expected Skills: Uses SkillComplianceIndicator for compliance visualization
 * - Additional Skills: Skills used but not in expectedSkills
 */

import { useMemo } from "react";
import { Bot } from "lucide-react";

import { SkillComplianceIndicator } from "./SkillComplianceIndicator";

/**
 * Event type for agent invocation
 */
export interface AgentInvocationEvent {
  type: "agent_invocation";
  ts: string;
  session: string;
  agent: string;
  toolUseId: string;
  expectedSkills?: string[];
  prompt?: string;
}

/**
 * Event type for skill invocation
 */
export interface SkillInvocationEvent {
  type: "skill_invocation";
  ts: string;
  session: string;
  skill: string;
  agentContext?: string;
}

interface AgentInvocationCardProps {
  /** The agent invocation event */
  event: AgentInvocationEvent;
  /** All skill invocation events (will be filtered by agentContext) */
  skillEvents: SkillInvocationEvent[];
  /** Optional: Additional CSS classes */
  className?: string;
}

/**
 * Truncate a string to specified length with ellipsis
 */
function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return `${str.slice(0, length)}...`;
}

/**
 * AgentInvocationCard displays agent invocation events with skill compliance tracking.
 * It filters skill events by agentContext to determine which skills were actually used
 * by this specific agent.
 */
export function AgentInvocationCard({
  event,
  skillEvents,
  className = "",
}: AgentInvocationCardProps): JSX.Element {
  // Memoize expectedSkills to prevent dependency array changes on every render
  const expectedSkills = useMemo(() => event.expectedSkills ?? [], [event.expectedSkills]);

  // Filter skill events to get skills used by this specific agent
  const usedSkills = useMemo(() => {
    return skillEvents
      .filter((s) => s.agentContext === event.agent)
      .map((s) => s.skill);
  }, [skillEvents, event.agent]);

  // Deduplicate used skills (same skill might be invoked multiple times)
  const uniqueUsedSkills = useMemo(() => {
    return [...new Set(usedSkills)];
  }, [usedSkills]);

  // Find skills that were used but not in expectedSkills
  const additionalSkills = useMemo(() => {
    return uniqueUsedSkills.filter((skill) => !expectedSkills.includes(skill));
  }, [uniqueUsedSkills, expectedSkills]);

  return (
    <div
      className={`bg-gray-900/50 rounded-lg border border-red-800/30 overflow-hidden ${className}`.trim()}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-red-800/30">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-red-400" />
          <h4 className="text-white font-medium">{event.agent}</h4>
        </div>
        <span className="text-gray-500 text-xs font-mono">
          {truncate(event.toolUseId, 12)}
        </span>
      </header>

      {/* Expected Skills Section */}
      {expectedSkills.length > 0 ? (
        <section className="px-4 py-3">
          <h5 className="text-gray-400 text-xs font-medium mb-2 uppercase tracking-wide">
            Expected Skills
          </h5>
          <SkillComplianceIndicator
            expectedSkills={expectedSkills}
            usedSkills={uniqueUsedSkills}
          />
        </section>
      ) : (
        <section className="px-4 py-3">
          <p className="text-gray-500 text-sm italic">
            No expected skills declared
          </p>
        </section>
      )}

      {/* Additional Skills Used (skills used but not in expectedSkills) */}
      {additionalSkills.length > 0 && (
        <section className="px-4 py-3 border-t border-red-800/30">
          <h5 className="text-gray-400 text-xs font-medium mb-2 uppercase tracking-wide">
            Additional Skills Used
          </h5>
          <div className="flex flex-wrap gap-1">
            {additionalSkills.map((skill) => (
              <span
                key={skill}
                className="px-2 py-1 bg-gray-800/50 text-gray-400 text-xs rounded border border-gray-700"
              >
                {skill}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
