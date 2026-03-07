/**
 * EmailCampaignEditor Component
 *
 * Full campaign creation form with fields for:
 * - Campaign name
 * - From address
 * - Subject line
 * - Preview text
 * - Audience/segment selector (fetched via useEmailAudiences)
 * - HTML body (textarea for direct editing or via template injection)
 * - Schedule picker (datetime-local input)
 * - Send Now and Schedule action buttons calling POST /api/marketing/email/broadcast
 *
 * Template and audience data are passed as props from the parent orchestrator.
 *
 * @module components/marketing/EmailCampaignEditor
 */

import { useState } from "react";
import type { EmailAudience, EmailTemplate } from "../../types/marketing";
import type { SendBroadcastParams } from "../../hooks/useEmailCampaigns";

interface EmailCampaignEditorProps {
  /** Available audience segments */
  audiences: EmailAudience[];
  /** Whether audiences are loading */
  audiencesLoading: boolean;
  /** Available email templates */
  templates: EmailTemplate[];
  /** Whether templates are loading */
  templatesLoading: boolean;
  /** Callback to send or schedule the broadcast */
  onSend: (params: SendBroadcastParams) => Promise<{ success: boolean; error?: string }>;
  /** Callback when template is selected (to update preview) */
  onTemplateSelect?: (template: EmailTemplate) => void;
  /** Callback when HTML body changes (to update preview) */
  onHtmlChange?: (html: string) => void;
  /** Callback when subject changes (to update preview) */
  onSubjectChange?: (subject: string) => void;
  /** Callback when preview text changes (to update preview) */
  onPreviewTextChange?: (previewText: string) => void;
}

type SendMode = "now" | "schedule";

export function EmailCampaignEditor({
  audiences,
  audiencesLoading,
  templates,
  templatesLoading,
  onSend,
  onTemplateSelect,
  onHtmlChange,
  onSubjectChange,
  onPreviewTextChange,
}: EmailCampaignEditorProps): JSX.Element {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [html, setHtml] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("now");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleTemplateChange = (templateId: string): void => {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setHtml(template.html);
      onTemplateSelect?.(template);
      onHtmlChange?.(template.html);
    }
  };

  const handleSubjectChange = (value: string): void => {
    setSubject(value);
    onSubjectChange?.(value);
  };

  const handlePreviewTextChange = (value: string): void => {
    setPreviewText(value);
    onPreviewTextChange?.(value);
  };

  const handleHtmlChange = (value: string): void => {
    setHtml(value);
    onHtmlChange?.(value);
  };

  const isValid =
    from.trim() !== "" &&
    subject.trim() !== "" &&
    html.trim() !== "" &&
    segmentId !== "" &&
    (sendMode === "now" || scheduledAt !== "");

  const handleSubmit = async (mode: SendMode): Promise<void> => {
    if (!isValid) return;

    setSending(true);
    setError(null);
    setSuccess(false);

    const params: SendBroadcastParams = {
      segmentId,
      from: from.trim(),
      subject: subject.trim(),
      html,
      previewText: previewText.trim() || undefined,
      name: name.trim() || undefined,
      scheduledAt: mode === "schedule" ? scheduledAt : undefined,
    };

    const result = await onSend(params);

    setSending(false);

    if (result.success) {
      setSuccess(true);
      // Reset form after successful send
      setName("");
      setFrom("");
      setSubject("");
      setPreviewText("");
      setHtml("");
      setSegmentId("");
      setSelectedTemplateId("");
      setScheduledAt("");
      onHtmlChange?.("");
      onSubjectChange?.("");
      onPreviewTextChange?.("");
    } else {
      setError(result.error ?? "Failed to send broadcast");
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-900 p-4">
      <h3 className="text-sm font-semibold text-gray-200">
        Create Email Campaign
      </h3>

      {/* Success message */}
      {success && (
        <div
          className="rounded-lg border border-green-800 bg-green-900/30 p-3"
          role="alert"
        >
          <p className="text-sm text-green-300">
            {sendMode === "schedule"
              ? "Campaign scheduled successfully!"
              : "Campaign sent successfully!"}
          </p>
        </div>
      )}

      {/* Error message */}
      {error !== null && (
        <div
          className="rounded-lg border border-red-800 bg-red-900/30 p-3"
          role="alert"
        >
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Campaign Name */}
      <div>
        <label
          htmlFor="email-camp-name"
          className="mb-1 block text-xs text-gray-400"
        >
          Campaign Name
        </label>
        <input
          id="email-camp-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Weekly Newsletter #42"
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* From Address */}
      <div>
        <label
          htmlFor="email-from"
          className="mb-1 block text-xs text-gray-400"
        >
          From *
        </label>
        <input
          id="email-from"
          type="email"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="hello@yourbrand.com"
          required
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Subject */}
      <div>
        <label
          htmlFor="email-subject"
          className="mb-1 block text-xs text-gray-400"
        >
          Subject *
        </label>
        <input
          id="email-subject"
          type="text"
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          placeholder="Your email subject line"
          required
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Preview Text */}
      <div>
        <label
          htmlFor="email-preview"
          className="mb-1 block text-xs text-gray-400"
        >
          Preview Text
        </label>
        <input
          id="email-preview"
          type="text"
          value={previewText}
          onChange={(e) => handlePreviewTextChange(e.target.value)}
          placeholder="Text shown in email client preview"
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Audience / Segment Selector */}
      <div>
        <label
          htmlFor="email-segment"
          className="mb-1 block text-xs text-gray-400"
        >
          Audience / Segment *
        </label>
        <select
          id="email-segment"
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value)}
          disabled={audiencesLoading}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          aria-label="Select audience segment"
        >
          <option value="">
            {audiencesLoading ? "Loading segments..." : "Select a segment"}
          </option>
          {audiences.map((audience) => (
            <option key={audience.id} value={audience.id}>
              {audience.name} ({audience.contactCount.toLocaleString()} contacts)
            </option>
          ))}
        </select>
      </div>

      {/* Template Selector */}
      <div>
        <label
          htmlFor="email-template"
          className="mb-1 block text-xs text-gray-400"
        >
          Template
        </label>
        <select
          id="email-template"
          value={selectedTemplateId}
          onChange={(e) => handleTemplateChange(e.target.value)}
          disabled={templatesLoading}
          className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          aria-label="Select email template"
        >
          <option value="">
            {templatesLoading ? "Loading templates..." : "No template (custom HTML)"}
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>

      {/* HTML Body */}
      <div>
        <label
          htmlFor="email-html"
          className="mb-1 block text-xs text-gray-400"
        >
          HTML Body *
        </label>
        <textarea
          id="email-html"
          value={html}
          onChange={(e) => handleHtmlChange(e.target.value)}
          placeholder="Paste or write your email HTML here..."
          rows={8}
          required
          className="w-full resize-y rounded-md border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Schedule Toggle */}
      <div>
        <span className="mb-2 block text-xs text-gray-400">Delivery</span>
        <div
          className="flex gap-1 rounded-lg border border-gray-700 p-0.5"
          role="group"
          aria-label="Delivery mode"
        >
          <button
            type="button"
            onClick={() => setSendMode("now")}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              sendMode === "now"
                ? "bg-gray-700 text-gray-200"
                : "text-gray-500 hover:text-gray-300"
            }`}
            aria-pressed={sendMode === "now"}
          >
            Send Now
          </button>
          <button
            type="button"
            onClick={() => setSendMode("schedule")}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              sendMode === "schedule"
                ? "bg-gray-700 text-gray-200"
                : "text-gray-500 hover:text-gray-300"
            }`}
            aria-pressed={sendMode === "schedule"}
          >
            Schedule
          </button>
        </div>
      </div>

      {/* Schedule Date/Time */}
      {sendMode === "schedule" && (
        <div>
          <label
            htmlFor="email-schedule"
            className="mb-1 block text-xs text-gray-400"
          >
            Scheduled Date &amp; Time *
          </label>
          <input
            id="email-schedule"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 pt-2">
        {sendMode === "now" ? (
          <button
            type="button"
            disabled={!isValid || sending}
            onClick={() => void handleSubmit("now")}
            className="rounded-md bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            aria-label="Send email campaign now"
          >
            {sending ? "Sending..." : "Send Now"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!isValid || sending}
            onClick={() => void handleSubmit("schedule")}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            aria-label="Schedule email campaign"
          >
            {sending ? "Scheduling..." : "Schedule"}
          </button>
        )}
      </div>
    </div>
  );
}
