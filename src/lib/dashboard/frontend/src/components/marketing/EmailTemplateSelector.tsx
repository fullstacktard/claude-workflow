/**
 * EmailTemplateSelector Component
 *
 * Grid of email template cards fetched from GET /api/marketing/email/templates.
 * Each card shows a thumbnail (or a fallback icon), name, and description.
 * Clicking a card selects the template and invokes the onSelect callback
 * with the full EmailTemplate object so the parent can inject the HTML.
 *
 * @module components/marketing/EmailTemplateSelector
 */

import type { EmailTemplate } from "../../types/marketing";

interface EmailTemplateSelectorProps {
  templates: EmailTemplate[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (template: EmailTemplate) => void;
}

export function EmailTemplateSelector({
  templates,
  loading,
  selectedId,
  onSelect,
}: EmailTemplateSelectorProps): JSX.Element {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <p className="text-center text-sm text-gray-500">Loading templates...</p>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <p className="text-center text-sm text-gray-500">
          No email templates available.
        </p>
        <p className="mt-1 text-center text-xs text-gray-600">
          Create templates via the API to see them here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-300">
        Choose a Template
      </h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {templates.map((template) => {
          const isSelected = template.id === selectedId;

          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? "border-blue-500 bg-blue-900/20"
                  : "border-gray-700 bg-gray-900 hover:border-gray-600"
              }`}
              aria-pressed={isSelected}
              aria-label={`Template: ${template.name}`}
            >
              {/* Thumbnail or fallback */}
              <div className="mb-2 flex h-20 items-center justify-center overflow-hidden rounded bg-gray-950">
                {template.thumbnailUrl ? (
                  <img
                    src={template.thumbnailUrl}
                    alt={`Preview of ${template.name}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <svg
                    className="h-8 w-8 text-gray-700"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
                    />
                  </svg>
                )}
              </div>

              <p className="truncate text-sm font-medium text-gray-200">
                {template.name}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                {template.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
