/**
 * CampaignCreateForm Component
 *
 * Form for creating a new cross-platform campaign with fields for:
 * - Campaign name (required)
 * - Description
 * - Goal
 * - Target platform checkboxes (X, LinkedIn, Email) - at least one required
 * - Start/end dates
 * - Auto-create draft posts toggle with optional initial content
 *
 * Platform checkboxes use a styled label pattern with hidden native checkboxes
 * for consistent dark theme styling.
 *
 * @module components/marketing/CampaignCreateForm
 */

import { useState } from "react";

interface CampaignCreateFormProps {
  onSubmit: (params: {
    name: string;
    platforms: string[];
    description?: string;
    goal?: string;
    start_date?: string;
    end_date?: string;
    auto_create_posts?: boolean;
    post_content?: string;
  }) => Promise<unknown>;
  onCancel: () => void;
}

type Platform = "x" | "linkedin" | "email";

const PLATFORM_OPTIONS: Array<{ id: Platform; label: string }> = [
  { id: "x", label: "X / Twitter" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "email", label: "Email" },
];

export function CampaignCreateForm({
  onSubmit,
  onCancel,
}: CampaignCreateFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set(["x"]));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoCreatePosts, setAutoCreatePosts] = useState(false);
  const [postContent, setPostContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const togglePlatform = (p: Platform): void => {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) {
        next.delete(p);
      } else {
        next.add(p);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || platforms.size === 0) return;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        platforms: Array.from(platforms),
        description: description.trim() || undefined,
        goal: goal.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        auto_create_posts: autoCreatePosts,
        post_content: autoCreatePosts ? postContent.trim() || undefined : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-4 rounded-lg border border-gray-700 bg-gray-900 p-4"
    >
      <h3 className="text-sm font-semibold text-gray-200">Create Campaign</h3>

      {/* Name */}
      <div>
        <label htmlFor="camp-name" className="mb-1 block text-xs text-gray-400">
          Campaign Name *
        </label>
        <input
          id="camp-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Product Launch Q2"
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="camp-desc" className="mb-1 block text-xs text-gray-400">
          Description
        </label>
        <textarea
          id="camp-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of the campaign..."
          rows={2}
          className="w-full resize-none rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Goal */}
      <div>
        <label htmlFor="camp-goal" className="mb-1 block text-xs text-gray-400">
          Goal
        </label>
        <input
          id="camp-goal"
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g., Drive 1000 sign-ups"
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Platform checkboxes */}
      <div>
        <span className="mb-2 block text-xs text-gray-400">Target Platforms *</span>
        <div className="flex gap-3">
          {PLATFORM_OPTIONS.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                platforms.has(p.id)
                  ? "border-blue-500 bg-blue-900/20 text-blue-300"
                  : "border-gray-700 bg-gray-950 text-gray-500 hover:border-gray-600"
              }`}
            >
              <input
                type="checkbox"
                checked={platforms.has(p.id)}
                onChange={() => togglePlatform(p.id)}
                className="sr-only"
                aria-label={`Select ${p.label} platform`}
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="camp-start" className="mb-1 block text-xs text-gray-400">
            Start Date
          </label>
          <input
            id="camp-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="camp-end" className="mb-1 block text-xs text-gray-400">
            End Date
          </label>
          <input
            id="camp-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Auto-create posts toggle */}
      <div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={autoCreatePosts}
            onChange={(e) => setAutoCreatePosts(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
          />
          <span className="text-sm text-gray-300">Auto-create draft posts per platform</span>
        </label>
      </div>

      {/* Post content (shown when auto-create is on) */}
      {autoCreatePosts && (
        <div>
          <label htmlFor="camp-content" className="mb-1 block text-xs text-gray-400">
            Initial Post Content
          </label>
          <textarea
            id="camp-content"
            value={postContent}
            onChange={(e) => setPostContent(e.target.value)}
            placeholder="Draft content for all platform posts..."
            rows={3}
            className="w-full resize-none rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim() || platforms.size === 0 || submitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create Campaign"}
        </button>
      </div>
    </form>
  );
}
