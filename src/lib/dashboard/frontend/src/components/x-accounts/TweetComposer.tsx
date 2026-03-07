/**
 * TweetComposer Component
 *
 * Controlled textarea with 280-character limit, color-coded character counter,
 * and send button with loading state. Supports Ctrl+Enter keyboard shortcut.
 *
 * Character counter colors:
 * - Gray: 0-259 characters
 * - Yellow: 260-279 characters (warning zone)
 * - Red: 280+ characters (over limit)
 *
 * Send button is disabled when text is empty, exceeds 280 characters, or is currently sending.
 *
 * @module components/x-accounts/TweetComposer
 */

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";

/** Props for the TweetComposer component */
interface TweetComposerProps {
  /** Account handle displayed in the composer header */
  handle: string;
  /** Callback invoked when the user sends a tweet */
  onSend: (text: string) => Promise<void>;
}

/** Maximum tweet character limit */
const MAX_CHARS = 280;

/** Threshold at which the counter turns yellow */
const WARN_THRESHOLD = 260;

/**
 * Returns the Tailwind color class for the character counter
 * based on current text length.
 */
function getCounterColor(length: number): string {
  if (length > MAX_CHARS) return "text-red-400";
  if (length >= WARN_THRESHOLD) return "text-yellow-400";
  return "text-gray-400";
}

/**
 * TweetComposer renders a tweet composition UI with character counting,
 * validation, and keyboard shortcut support.
 */
export function TweetComposer({ handle, onSend }: TweetComposerProps): JSX.Element {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const charCount = text.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isEmpty = charCount === 0;
  const isDisabled = isEmpty || isOverLimit || isSending;

  async function handleSend(): Promise<void> {
    if (isDisabled) return;
    setIsSending(true);
    try {
      await onSend(text);
      setText("");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !isDisabled) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="border border-red-800/50 rounded bg-gray-900/50">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-red-800/30">
        <span className="text-xs text-gray-400">Compose Tweet</span>
        <span className="text-xs text-gray-500">@{handle}</span>
      </div>

      {/* Textarea */}
      <textarea
        className="w-full bg-transparent text-gray-200 text-sm p-3 resize-none focus:outline-none placeholder:text-gray-600"
        rows={3}
        maxLength={MAX_CHARS + 20}
        placeholder="What's happening?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isSending}
        aria-label="Tweet text"
      />

      {/* Footer row: counter + send button */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-red-800/30">
        <span className={`text-xs font-mono ${getCounterColor(charCount)}`}>
          {charCount}/{MAX_CHARS}
        </span>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => void handleSend()}
          className={`h-7 px-3 text-xs rounded-md transition-colors border flex items-center gap-1.5 ${
            isDisabled
              ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed"
              : "border-green-800 bg-transparent text-green-400 hover:bg-green-800 hover:text-gray-900"
          }`}
          aria-label={isSending ? "Sending tweet" : "Send tweet"}
        >
          {isSending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
          )}
          {isSending ? "Sending..." : "Send Tweet"}
        </button>
      </div>
    </div>
  );
}
