/**
 * ContentPreviewCard Component
 *
 * Renders a single generated content item with platform-specific preview,
 * character count vs. platform limit, copy button, and action buttons.
 *
 * @module components/marketing/ContentPreviewCard
 */

import { useCallback, useState } from "react";
import { Check, Copy, Wand2 } from "lucide-react";

import type { GeneratedContent } from "../../types/marketing";
import { PLATFORM_LABELS, PLATFORM_CHAR_LIMITS } from "../../types/marketing";

function getCounterColor(length: number, limit: number | null): string {
  if (limit === null) return "text-gray-400";
  const ratio = length / limit;
  if (ratio >= 1) return "text-red-400";
  if (ratio >= 0.9) return "text-yellow-400";
  return "text-gray-400";
}

interface ContentPreviewCardProps {
  content: GeneratedContent;
  onRefine: () => void;
}

export function ContentPreviewCard({
  content,
  onRefine,
}: ContentPreviewCardProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const limit = PLATFORM_CHAR_LIMITS[content.platform];
  const charCount = content.text.length;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [content.text]);

  return (
    <div className="border border-gray-800 rounded-md bg-gray-900/50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-mono">
            {PLATFORM_LABELS[content.platform]}
          </span>
          {content.variation_label && (
            <span className="text-[10px] text-gray-500 font-mono px-1.5 py-0.5 rounded bg-gray-800">
              {content.variation_label}
            </span>
          )}
        </div>
        <span className={`text-xs font-mono ${getCounterColor(charCount, limit)}`}>
          {charCount}
          {limit !== null ? `/${limit}` : " chars"}
        </span>
      </div>

      {/* Content preview */}
      <div className="p-3 flex-1">
        {content.platform === "twitter" && (
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-700 shrink-0" />
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
              {content.text}
            </p>
          </div>
        )}

        {content.platform === "linkedin" && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-full bg-gray-700 shrink-0" />
              <div>
                <span className="text-xs text-gray-300 font-medium">Your Name</span>
                <span className="text-xs text-gray-500 block">Just now</span>
              </div>
            </div>
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
              {content.text}
            </p>
          </div>
        )}

        {content.platform === "email" && (
          <div>
            {content.subject && (
              <div className="border-b border-gray-700 pb-2 mb-2">
                <span className="text-xs text-gray-500">Subject: </span>
                <span className="text-sm text-gray-200">{content.subject}</span>
              </div>
            )}
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
              {content.text}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-800">
        <button
          type="button"
          onClick={onRefine}
          className="h-6 px-2 text-xs rounded transition-colors border border-gray-700 bg-transparent text-gray-500 hover:border-red-600 hover:text-red-400 flex items-center gap-1"
        >
          <Wand2 className="w-3 h-3" />
          Refine
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="h-6 px-2 text-xs rounded transition-colors border border-gray-700 bg-transparent text-gray-500 hover:border-gray-600 hover:text-gray-300 flex items-center gap-1"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}
