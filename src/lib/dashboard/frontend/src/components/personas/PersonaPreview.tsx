/**
 * PersonaPreview Component
 *
 * Sample tweet generation panel. Clicking "Generate Samples" calls
 * POST /api/personas/:id/generate and displays 3-5 sample tweets
 * in TerminalCard-styled cards.
 *
 * @module components/personas/PersonaPreview
 */

import { useState, useCallback, useEffect } from "react";
import { Sparkles, RefreshCw } from "lucide-react";

interface PersonaPreviewProps {
  /** Persona ID for the generate API call */
  personaId: string;
  /** Persona display name (shown in sample tweet headers) */
  personaName: string;
  /** Optional initial topic (e.g. from ?trend= query param) */
  initialTopic?: string;
  /** Callback to generate sample tweets */
  onGenerate: (personaId: string, count?: number, topic?: string) => Promise<string[]>;
}

export function PersonaPreview({
  personaId,
  personaName,
  initialTopic,
  onGenerate,
}: PersonaPreviewProps): JSX.Element {
  const [samples, setSamples] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState(initialTopic ?? "");

  // Clear stale samples when switching personas
  useEffect(() => {
    setSamples([]);
    setError(null);
  }, [personaId]);

  // Sync topic when initialTopic changes (e.g. navigating from different trend)
  useEffect(() => {
    if (initialTopic) setTopic(initialTopic);
  }, [initialTopic]);

  const handleGenerate = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const tweets = await onGenerate(personaId, 5, topic || undefined);
      setSamples(tweets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [personaId, onGenerate, topic]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-xs text-gray-400 font-mono">
          sample tweets for {personaName}
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (optional — e.g. trending topic)"
            className="flex-1 h-7 px-2 text-xs bg-gray-900 border border-gray-700 rounded text-gray-300 placeholder-gray-600 focus:border-red-800 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className="h-7 px-3 text-xs rounded border border-red-800 text-gray-400 hover:bg-red-800 hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {loading ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {loading ? "Generating..." : "Generate Samples"}
          </button>
        </div>
      </div>

      {error !== null && (
        <div className="px-3 py-1.5 text-xs bg-red-900/50 border border-red-700 rounded text-red-300">
          {error}
        </div>
      )}

      {samples.length === 0 && !loading && error === null && (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500 text-sm">
            Click &quot;Generate Samples&quot; to preview tweets
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {samples.map((tweet, i) => (
          <div
            key={`sample-${String(i)}`}
            className="p-3 bg-gray-950 border border-gray-700 rounded-md"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-red-400 font-mono">
                @{personaName.toLowerCase().replace(/\s+/g, "_")}
              </span>
              <span className="text-xs text-gray-600">#{String(i + 1)}</span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{tweet}</p>
            <div className="mt-1.5 text-xs text-gray-600">
              {tweet.length}/280 chars
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
