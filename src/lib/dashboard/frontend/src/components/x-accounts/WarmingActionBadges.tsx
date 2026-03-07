/**
 * WarmingActionBadges - Colored badges for each warming action type
 *
 * Action types with Lucide icons and colors:
 * - browse: Eye icon (gray)
 * - like: Heart icon (pink)
 * - follow: UserPlus icon (blue)
 * - reply: MessageCircle icon (green)
 * - post: Edit3 icon (purple)
 *
 * @module components/x-accounts/WarmingActionBadges
 */

import { Eye, Heart, UserPlus, MessageCircle, Edit3 } from "lucide-react";
import type { ComponentType } from "react";

/** Warming action types matching the warming scheduler */
export type WarmingAction = "browse" | "like" | "follow" | "reply" | "post";

/** Visual configuration for a single action badge */
interface ActionConfig {
  label: string;
  icon: ComponentType<{ className?: string }>;
  bgClass: string;
  textClass: string;
}

/** Map each action type to its badge styling */
const ACTION_CONFIG: Record<WarmingAction, ActionConfig> = {
  browse: {
    label: "Browse",
    icon: Eye,
    bgClass: "bg-gray-700/50",
    textClass: "text-gray-300",
  },
  like: {
    label: "Like",
    icon: Heart,
    bgClass: "bg-pink-500/20",
    textClass: "text-pink-400",
  },
  follow: {
    label: "Follow",
    icon: UserPlus,
    bgClass: "bg-blue-500/20",
    textClass: "text-blue-400",
  },
  reply: {
    label: "Reply",
    icon: MessageCircle,
    bgClass: "bg-green-500/20",
    textClass: "text-green-400",
  },
  post: {
    label: "Post",
    icon: Edit3,
    bgClass: "bg-purple-500/20",
    textClass: "text-purple-400",
  },
};

/** Props for WarmingActionBadges */
interface WarmingActionBadgesProps {
  /** List of warming action types to display as badges */
  actions: WarmingAction[];
  /** Additional CSS classes */
  className?: string;
}

/**
 * WarmingActionBadges renders a row of colored pill badges
 * for each warming action type.
 */
export function WarmingActionBadges({
  actions,
  className = "",
}: WarmingActionBadgesProps): JSX.Element {
  return (
    <div
      className={`flex flex-wrap gap-1 ${className}`}
      role="list"
      aria-label="Allowed warming actions"
    >
      {actions.map((action) => {
        const config = ACTION_CONFIG[action];
        if (!config) return null;
        const IconComponent = config.icon;
        return (
          <span
            key={action}
            role="listitem"
            className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full text-xs ${config.bgClass} ${config.textClass}`}
          >
            <IconComponent className="w-3 h-3" aria-hidden="true" />
            {config.label}
          </span>
        );
      })}
    </div>
  );
}
