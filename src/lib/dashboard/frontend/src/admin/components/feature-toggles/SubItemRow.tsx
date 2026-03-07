/**
 * SubItemRow Component
 *
 * Renders a single sub-item (agent, skill, command, or workflow) with
 * per-tier checkboxes. Memoized to prevent re-renders from sibling changes.
 *
 * Each sub-item type has a distinct icon and color-coded badge:
 *   - Agent:   Bot icon,      sky-400
 *   - Skill:   Zap icon,      amber-400
 *   - Command: Terminal icon,  green-400
 *   - Workflow: GitBranch icon, purple-400
 */

import { memo } from "react";
import { Bot, Zap, Terminal, GitBranch } from "lucide-react";

import type { SubItemType, TierName } from "../../types/featureToggle";
import { TIERS, TIER_HIERARCHY } from "../../types/featureToggle";
import type { ToggleAction } from "../../hooks/useFeatureMatrix";
import { TierCheckbox } from "./TierCheckbox";

const TYPE_CONFIG: Record<
  SubItemType,
  {
    icon: typeof Bot;
    color: string;
    bgColor: string;
    label: string;
  }
> = {
  agents: {
    icon: Bot,
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    label: "Agent",
  },
  skills: {
    icon: Zap,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    label: "Skill",
  },
  commands: {
    icon: Terminal,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    label: "Cmd",
  },
  workflows: {
    icon: GitBranch,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    label: "Flow",
  },
};

interface SubItemRowProps {
  groupId: string;
  type: SubItemType;
  itemId: string;
  requiredTier: TierName;
  toggles: Record<string, boolean>;
  dispatch: React.Dispatch<ToggleAction>;
}

export const SubItemRow = memo(function SubItemRow({
  groupId,
  type,
  itemId,
  requiredTier,
  toggles,
  dispatch,
}: SubItemRowProps): JSX.Element {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;
  const requiredLevel = TIER_HIERARCHY[requiredTier] ?? 0;

  return (
    <div className="flex items-center border-b border-gray-800/50 py-1.5 pl-10 pr-4">
      {/* Type badge + item name */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${config.bgColor} ${config.color}`}
        >
          <Icon size={10} />
          {config.label}
        </span>
        <span className="truncate text-xs text-gray-300" title={itemId}>
          {itemId}
        </span>
      </div>

      {/* Per-tier checkboxes */}
      <div className="flex items-center gap-6">
        {TIERS.map((tier: TierName) => {
          const key = `${groupId}:${type}:${itemId}:${tier}`;
          const tierLevel = TIER_HIERARCHY[tier];
          const locked = tierLevel < requiredLevel;

          return (
            <div key={tier} className="flex w-16 justify-center">
              <TierCheckbox
                checked={Boolean(toggles[key])}
                locked={locked}
                lockTooltip={`Requires ${requiredTier} tier or higher`}
                ariaLabel={`${itemId} ${type} in ${tier} tier`}
                onChange={(checked: boolean) =>
                  dispatch({ type: "TOGGLE_ITEM", key, value: checked })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
