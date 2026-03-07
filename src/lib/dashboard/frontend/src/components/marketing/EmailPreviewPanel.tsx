/**
 * EmailPreviewPanel Component
 *
 * Renders an email HTML body in a sandboxed iframe with desktop/mobile
 * width toggle. Shows subject and preview text above the iframe.
 *
 * The iframe uses sandbox="allow-same-origin" without allow-scripts
 * to prevent embedded JavaScript execution while allowing CSS to render.
 *
 * Standard email widths:
 * - Desktop: 600px
 * - Mobile:  375px
 *
 * @module components/marketing/EmailPreviewPanel
 */

import { useMemo, useState } from "react";

interface EmailPreviewPanelProps {
  html: string;
  subject: string;
  previewText: string;
}

type DeviceWidth = "desktop" | "mobile";

const DEVICE_WIDTHS: Record<DeviceWidth, number> = {
  desktop: 600,
  mobile: 375,
};

export function EmailPreviewPanel({
  html,
  subject,
  previewText,
}: EmailPreviewPanelProps): JSX.Element {
  const [device, setDevice] = useState<DeviceWidth>("desktop");

  const srcDoc = useMemo((): string => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }</style>
</head>
<body>${html || '<p style="color: #999; padding: 20px;">Email preview will appear here...</p>'}</body>
</html>`;
  }, [html]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
      {/* Header with subject/preview text and device toggle */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-200">
            Subject: {subject || "(no subject)"}
          </p>
          <p className="truncate text-xs text-gray-500">
            Preview: {previewText || "(no preview text)"}
          </p>
        </div>
        <div
          className="flex shrink-0 gap-1 rounded-lg border border-gray-700 p-0.5"
          role="group"
          aria-label="Device preview width"
        >
          <button
            type="button"
            onClick={() => setDevice("desktop")}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              device === "desktop"
                ? "bg-gray-700 text-gray-200"
                : "text-gray-500 hover:text-gray-300"
            }`}
            aria-pressed={device === "desktop"}
          >
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice("mobile")}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              device === "mobile"
                ? "bg-gray-700 text-gray-200"
                : "text-gray-500 hover:text-gray-300"
            }`}
            aria-pressed={device === "mobile"}
          >
            Mobile
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className="flex justify-center rounded-lg bg-gray-950 p-4">
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          title="Email preview"
          className="rounded border border-gray-800 bg-white"
          style={{
            width: `${DEVICE_WIDTHS[device]}px`,
            height: "500px",
          }}
        />
      </div>
    </div>
  );
}
