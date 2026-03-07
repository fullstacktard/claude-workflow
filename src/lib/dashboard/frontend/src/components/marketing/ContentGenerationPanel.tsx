/**
 * ContentGenerationPanel Component
 *
 * Top-level orchestrator for the content generation workflow.
 * Manages state for: composer form, generated content list,
 * variations, and refinement mode.
 *
 * Data flow:
 * 1. User fills ContentComposer and clicks Generate
 * 2. POST /api/marketing/generate-content via dashboardFetch
 * 3. Response rendered as ContentPreviewCard(s)
 * 4. User can copy, refine, or generate more variations
 * 5. Refine opens ContentRefinementPanel with side-by-side view
 *
 * @module components/marketing/ContentGenerationPanel
 */

import { useCallback, useState } from "react";

import type {
  ContentGenerationRequest,
  GeneratedContent,
  RefinementRequest,
} from "../../types/marketing";
import { dashboardFetch } from "../../utils/dashboard-fetch";
import { ContentComposer } from "./ContentComposer";
import { ContentPreviewCard } from "./ContentPreviewCard";
import { ContentRefinementPanel } from "./ContentRefinementPanel";

type PanelView = "compose" | "results" | "refine";

export function ContentGenerationPanel(): JSX.Element {
  const [view, setView] = useState<PanelView>("compose");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContents, setGeneratedContents] = useState<GeneratedContent[]>([]);
  const [selectedForRefine, setSelectedForRefine] = useState<GeneratedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<ContentGenerationRequest | null>(null);

  const handleGenerate = useCallback(async (request: ContentGenerationRequest): Promise<void> => {
    setIsGenerating(true);
    setError(null);
    setLastRequest(request);
    try {
      const response = await dashboardFetch("/api/marketing/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        timeoutMs: 60_000,
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        setError(body.message ?? "Content generation failed");
        return;
      }
      const data = (await response.json()) as { content?: GeneratedContent; contents?: GeneratedContent[] };
      const contents = data.contents ?? (data.content ? [data.content] : []);
      setGeneratedContents(contents);
      if (contents.length > 0) setView("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleGenerateVariations = useCallback(async (): Promise<void> => {
    if (lastRequest === null) return;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await dashboardFetch("/api/marketing/preview-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastRequest),
        timeoutMs: 60_000,
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        setError(body.message ?? "Variation generation failed");
        return;
      }
      const data = (await response.json()) as { variations?: GeneratedContent[]; contents?: GeneratedContent[] };
      const contents = data.variations ?? data.contents ?? [];
      setGeneratedContents(contents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variation generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [lastRequest]);

  const handleRefine = useCallback((content: GeneratedContent) => {
    setSelectedForRefine(content);
    setView("refine");
  }, []);

  const handleRefineSubmit = useCallback(
    async (request: RefinementRequest): Promise<GeneratedContent | null> => {
      setError(null);
      try {
        const response = await dashboardFetch("/api/marketing/refine-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          timeoutMs: 60_000,
        });
        if (!response.ok) {
          const body = (await response.json()) as { message?: string };
          setError(body.message ?? "Refinement failed");
          return null;
        }
        const data = (await response.json()) as { content?: GeneratedContent; refined?: GeneratedContent };
        return data.content ?? data.refined ?? null;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refinement failed");
        return null;
      }
    },
    [],
  );

  const handleBackToCompose = useCallback(() => {
    setView("compose");
    setError(null);
  }, []);

  const handleBackToResults = useCallback(() => {
    setView("results");
    setSelectedForRefine(null);
    setError(null);
  }, []);

  return (
    <div className="p-3 overflow-y-auto h-full">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Error display */}
        {error !== null && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {view === "compose" && (
          <ContentComposer onGenerate={handleGenerate} isGenerating={isGenerating} />
        )}

        {view === "results" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBackToCompose}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors"
              >
                &larr; Back to composer
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateVariations()}
                disabled={isGenerating}
                className="h-7 px-3 text-xs rounded-md transition-colors border border-gray-700 text-gray-400 hover:border-red-600 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? "Generating..." : "Generate Variations"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {generatedContents.map((content, i) => (
                <ContentPreviewCard
                  key={content.id ?? i}
                  content={content}
                  onRefine={() => handleRefine(content)}
                />
              ))}
            </div>
          </div>
        )}

        {view === "refine" && selectedForRefine !== null && (
          <ContentRefinementPanel
            originalContent={selectedForRefine}
            onRefine={handleRefineSubmit}
            onBack={handleBackToResults}
          />
        )}
      </div>
    </div>
  );
}
