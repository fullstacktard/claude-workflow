/**
 * BrandVoiceCard Component
 *
 * Summary card displaying brand voice name, tone tags, personality traits,
 * example count, emoji/hashtag policy, and date info.
 * Used in the brand voice list sidebar.
 *
 * @module components/marketing/BrandVoiceCard
 */

import { Trash2 } from "lucide-react";

import type { BrandVoiceSummary } from "../../types/marketing";
import {
  EMOJI_POLICY_LABELS,
  HASHTAG_STRATEGY_LABELS,
  formatRelativeTime,
} from "../../types/marketing";

interface BrandVoiceCardProps {
  voice: BrandVoiceSummary;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function BrandVoiceCard({
  voice,
  isSelected,
  onSelect,
  onDelete,
}: BrandVoiceCardProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(voice.id)}
      className={`w-full text-left rounded-md border p-3 transition-colors ${
        isSelected
          ? "border-red-600 bg-red-900/20"
          : "border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900"
      }`}
      aria-pressed={isSelected}
    >
      {/* Header: name + delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-white truncate">{voice.name}</h3>
          {voice.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{voice.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(voice.id);
          }}
          className="shrink-0 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/30 transition-colors"
          title="Delete brand voice"
          aria-label={`Delete ${voice.name}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tone tags */}
      {voice.tone.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {voice.tone.slice(0, 4).map((t) => (
            <span
              key={t}
              className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-cyan-900/40 text-cyan-400 border border-cyan-800/40"
            >
              {t}
            </span>
          ))}
          {voice.tone.length > 4 && (
            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
              +{voice.tone.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Personality traits */}
      {voice.personality_traits.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {voice.personality_traits.slice(0, 3).map((t) => (
            <span
              key={t}
              className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-purple-900/40 text-purple-400 border border-purple-800/40"
            >
              {t}
            </span>
          ))}
          {voice.personality_traits.length > 3 && (
            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
              +{voice.personality_traits.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer: policies + date */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500 font-mono">
        <div className="flex items-center gap-2">
          <span>{EMOJI_POLICY_LABELS[voice.emoji_policy]}</span>
          <span className="text-gray-700">|</span>
          <span>{HASHTAG_STRATEGY_LABELS[voice.hashtag_strategy]}</span>
        </div>
        <span>{formatRelativeTime(voice.updated_at)}</span>
      </div>
    </button>
  );
}
