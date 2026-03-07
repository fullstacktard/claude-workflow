/**
 * ContentRefinementPanel Component
 *
 * Side-by-side view of original and refined content.
 * User provides refinement instructions, submits to
 * POST /api/marketing/refine-content, and sees the result.
 *
 * @module components/marketing/ContentRefinementPanel
 */

import { useCallback, useState } from "react";
import { ArrowLeft, Loader2, Wand2 } from "lucide-react";

import type { GeneratedContent, RefinementRequest } from "../../types/marketing";

interface ContentRefinementPanelProps {
  originalContent: GeneratedContent;
  onRefine: (request: RefinementRequest) => Promise<GeneratedContent | null>;
  onBack: () => void;
}

export function ContentRefinementPanel({
  originalContent,
  onRefine,
  onBack,
}: ContentRefinementPanelProps): JSX.Element {
  const [instructions, setInstructions] = useState("");
  const [refinedContent, setRefinedContent] = useState<GeneratedContent | null>(null);
  const [isRefining, setIsRefining] = useState(false);

  const isDisabled = instructions.trim().length === 0 || isRefining;

  const handleRefine = useCallback(async (): Promise<void> => {
    if (isDisabled) return;
    setIsRefining(true);
    const result = await onRefine({
      content: originalContent.text,
      platform: originalContent.platform,
      brand_voice_id: originalContent.brand_voice_id,
      instructions: instructions.trim(),
    });
    if (result !== null) {
      setRefinedContent(result);
    }
    setIsRefining(false);
  }, [isDisabled, onRefine, originalContent, instructions]);

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to results
      </button>

      {/* Side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-gray-800 rounded-md bg-gray-900/50">
          <div className="px-3 py-1.5 border-b border-gray-800">
            <span className="text-xs text-gray-400 font-mono">Original</span>
          </div>
          <div className="p-3">
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
              {originalContent.text}
            </p>
          </div>
        </div>

        <div className="border border-gray-800 rounded-md bg-gray-900/50">
          <div className="px-3 py-1.5 border-b border-gray-800">
            <span className="text-xs text-gray-400 font-mono">Refined</span>
          </div>
          <div className="p-3">
            {refinedContent !== null ? (
              <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                {refinedContent.text}
              </p>
            ) : (
              <p className="text-sm text-gray-600 italic">
                Refined content will appear here...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Refinement instructions */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor="refine-instructions">
          Refinement Instructions
        </label>
        <textarea
          id="refine-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Make it more concise, add a call to action, change the tone..."
          rows={3}
          disabled={isRefining}
          className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white font-mono placeholder-gray-600 resize-y focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
        />
      </div>

      {/* Refine button */}
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => void handleRefine()}
        className={`w-full h-9 px-4 text-sm rounded-md transition-colors border flex items-center justify-center gap-2 ${
          isDisabled
            ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
            : "border-red-600 bg-transparent text-red-400 hover:bg-red-700 hover:text-white"
        }`}
      >
        {isRefining ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Wand2 className="w-4 h-4" />
        )}
        {isRefining ? "Refining..." : "Refine Content"}
      </button>
    </div>
  );
}
