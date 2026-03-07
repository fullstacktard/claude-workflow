/**
 * ContentComposer Component
 *
 * Form for AI content generation with topic input, platform selector,
 * brand voice dropdown, additional instructions textarea, and generate button.
 *
 * @module components/marketing/ContentComposer
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { dashboardFetch } from "../../utils/dashboard-fetch";
import type {
  BrandVoiceSummary,
  ContentGenerationRequest,
  ContentPlatform,
} from "../../types/marketing";
import { PLATFORM_LABELS } from "../../types/marketing";

const PLATFORMS: ContentPlatform[] = ["twitter", "linkedin", "email"];

interface ContentComposerProps {
  onGenerate: (request: ContentGenerationRequest) => Promise<void>;
  isGenerating: boolean;
}

export function ContentComposer({
  onGenerate,
  isGenerating,
}: ContentComposerProps): JSX.Element {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<ContentPlatform>("twitter");
  const [brandVoiceId, setBrandVoiceId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [brandVoices, setBrandVoices] = useState<BrandVoiceSummary[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await dashboardFetch("/api/marketing/brand-voices");
      if (res.ok) {
        const data = (await res.json()) as { voices: BrandVoiceSummary[] };
        setBrandVoices(data.voices ?? []);
        if (data.voices?.length > 0 && !brandVoiceId) {
          setBrandVoiceId(data.voices[0].id);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isDisabled = topic.trim().length === 0 || brandVoiceId === "" || isGenerating;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isDisabled) return;
    await onGenerate({
      topic: topic.trim(),
      platform,
      brand_voice_id: brandVoiceId,
      key_message: instructions.trim() || undefined,
    });
  }, [topic, platform, brandVoiceId, instructions, isDisabled, onGenerate]);

  return (
    <div className="space-y-4">
      {/* Topic input */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor="content-topic">
          Topic
        </label>
        <input
          id="content-topic"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Enter the topic for your content..."
          className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
          disabled={isGenerating}
        />
      </div>

      {/* Platform selector */}
      <div>
        <span className="block text-xs font-medium text-gray-400 mb-1">Platform</span>
        <div className="flex items-center gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              disabled={isGenerating}
              className={`h-7 px-3 text-xs rounded-md transition-colors border border-red-800 whitespace-nowrap ${
                platform === p
                  ? "bg-red-600 text-white"
                  : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
              }`}
              aria-pressed={platform === p}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Brand voice dropdown */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor="brand-voice-select">
          Brand Voice
        </label>
        <select
          id="brand-voice-select"
          value={brandVoiceId}
          onChange={(e) => setBrandVoiceId(e.target.value)}
          disabled={isGenerating || brandVoices.length === 0}
          className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white font-mono focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
        >
          {brandVoices.length === 0 && <option value="">No voices configured</option>}
          {brandVoices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {/* Additional instructions */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor="content-instructions">
          Additional Instructions <span className="text-gray-600">(optional)</span>
        </label>
        <textarea
          id="content-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Any specific angle, tone override, or key message..."
          rows={2}
          disabled={isGenerating}
          className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white font-mono placeholder-gray-600 resize-y focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
        />
      </div>

      {/* Generate button */}
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => void handleSubmit()}
        className={`w-full h-9 px-4 text-sm rounded-md transition-colors border flex items-center justify-center gap-2 ${
          isDisabled
            ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
            : "border-red-600 bg-red-700 text-white hover:bg-red-600"
        }`}
      >
        {isGenerating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
        {isGenerating ? "Generating..." : "Generate Content"}
      </button>
    </div>
  );
}
