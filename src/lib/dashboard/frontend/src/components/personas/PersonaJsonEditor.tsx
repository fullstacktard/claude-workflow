/**
 * PersonaJsonEditor Component
 *
 * Raw JSON editor for power users. Uses a monospace textarea with
 * bidirectional sync to the form editor via shared PersonaCharacterFile state.
 *
 * - Incoming data changes update the textarea text
 * - User edits are parsed and pushed upstream via onChange
 * - Parse errors are shown inline without blocking edits
 *
 * @module components/personas/PersonaJsonEditor
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { PersonaCharacterFile } from "../../types/persona";

interface PersonaJsonEditorProps {
  /** Current character file data */
  data: PersonaCharacterFile;
  /** Callback when valid JSON is edited */
  onChange: (data: PersonaCharacterFile) => void;
}

export function PersonaJsonEditor({ data, onChange }: PersonaJsonEditorProps): JSX.Element {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(data, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  // Track whether the last change came from user editing (to avoid sync loops)
  const isInternalEditRef = useRef(false);

  // Sync incoming data changes to textarea -- only when change is external
  useEffect(() => {
    if (isInternalEditRef.current) {
      isInternalEditRef.current = false;
      return;
    }
    setJsonText(JSON.stringify(data, null, 2));
    setParseError(null);
  }, [data]);

  const handleChange = useCallback(
    (text: string): void => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text) as PersonaCharacterFile;
        setParseError(null);
        isInternalEditRef.current = true;
        onChange(parsed);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Invalid JSON");
      }
    },
    [onChange],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4">
      {parseError !== null && (
        <div className="mb-2 px-3 py-1.5 text-xs bg-red-900/50 border border-red-700 rounded text-red-300 font-mono">
          Parse error: {parseError}
        </div>
      )}
      <textarea
        value={jsonText}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-0 w-full px-3 py-2 text-xs font-mono bg-gray-950 border border-gray-600 rounded text-green-400 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600 resize-none leading-relaxed"
        aria-label="JSON editor"
      />
    </div>
  );
}
