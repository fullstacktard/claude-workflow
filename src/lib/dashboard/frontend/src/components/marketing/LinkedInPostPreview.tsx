/**
 * LinkedInPostPreview Component
 *
 * Renders a LinkedIn-style post preview card with author info,
 * "1st" connection badge, commentary text, optional image,
 * character counter, and mock engagement bar.
 *
 * Follows the dark terminal aesthetic of the dashboard while
 * mimicking LinkedIn's post card structure.
 *
 * @module components/marketing/LinkedInPostPreview
 */

import { ThumbsUp, MessageCircle, Repeat2, Send } from "lucide-react";

const LINKEDIN_CHAR_LIMIT = 3000;

interface LinkedInPostPreviewProps {
  /** Post text content */
  text: string;
  /** Author display name */
  authorName: string;
  /** Author profile picture URL (optional) */
  authorPicture?: string | null;
  /** Post image URL (optional) */
  imageUrl?: string;
}

export function LinkedInPostPreview({
  text,
  authorName,
  authorPicture,
  imageUrl,
}: LinkedInPostPreviewProps): JSX.Element {
  const charCount = text.length;
  const isOverLimit = charCount > LINKEDIN_CHAR_LIMIT;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      {/* Header - Author info */}
      <div className="flex items-center gap-2">
        {authorPicture ? (
          <img
            src={authorPicture}
            alt={`${authorName} profile picture`}
            className="h-10 w-10 rounded-full"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900 text-sm font-bold text-blue-300">
            {authorName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-semibold text-gray-100">{authorName}</p>
          <p className="text-xs text-gray-500">1st &middot; Just now</p>
        </div>
      </div>

      {/* Content */}
      <div className="mt-3">
        <p className="whitespace-pre-wrap font-sans text-sm text-gray-200">
          {text || "Your LinkedIn post preview will appear here..."}
        </p>
      </div>

      {/* Optional image */}
      {imageUrl && (
        <div className="mt-3">
          <img
            src={imageUrl}
            alt="Post attachment"
            className="w-full rounded-md"
          />
        </div>
      )}

      {/* Character count */}
      <div className="mt-2 flex justify-end">
        <span
          className={`text-xs ${isOverLimit ? "font-bold text-red-400" : "text-gray-500"}`}
          aria-live="polite"
        >
          {charCount}/{LINKEDIN_CHAR_LIMIT}
        </span>
      </div>

      {/* Engagement bar (mock) */}
      <div className="mt-3 flex items-center gap-6 border-t border-gray-700 pt-2">
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <ThumbsUp className="h-3 w-3" />
          Like
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <MessageCircle className="h-3 w-3" />
          Comment
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Repeat2 className="h-3 w-3" />
          Repost
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Send className="h-3 w-3" />
          Send
        </span>
      </div>
    </div>
  );
}
