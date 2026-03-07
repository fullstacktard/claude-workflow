/**
 * YAMLPreviewPanel Component
 * Real-time YAML preview with Monaco Editor for workflow visualization
 *
 * Features:
 * - Syntax-highlighted YAML display (read-only)
 * - Debounced updates (500ms) for performance
 * - Copy-to-clipboard functionality
 * - Auto-scroll to selected node section
 * - Theme matching dashboard dark mode
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Copy, Check, AlertCircle } from "lucide-react";
import type { GraphData } from "../../../types/graph";

// ============================================================================
// Types
// ============================================================================

export interface YAMLPreviewPanelProps {
  /** Workflow graph data from canvas */
  graphData: GraphData | null;
  /** Currently selected node ID for auto-scroll */
  selectedNodeId?: string | null;
  /** Optional className for container styling */
  className?: string;
  /** Function to convert graph to YAML - injected for decoupling */
  graphToYaml: (graph: GraphData) => string;
}

type CopyStatus = "idle" | "copied" | "error";

// Monaco editor instance type
type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay for YAML generation (ms) */
const DEBOUNCE_DELAY = 500;

/** Duration to show copy success/error state (ms) */
const COPY_STATUS_DURATION = 2000;

/** Duration for line highlight animation (ms) */
const HIGHLIGHT_DURATION = 2000;

// ============================================================================
// Component
// ============================================================================

export function YAMLPreviewPanel({
  graphData,
  selectedNodeId,
  className = "",
  graphToYaml,
}: YAMLPreviewPanelProps): JSX.Element {
  // State for debounced YAML content
  const [yamlContent, setYamlContent] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Refs for Monaco editor access
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);

  // Track line numbers for each node in YAML
  const nodeLineMapRef = useRef<Map<string, number>>(new Map());

  // Memoize editor options to prevent Monaco re-initialization
  const editorOptions = useMemo(
    () => ({
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: "on" as const,
      glyphMargin: false,
      folding: true,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 3,
      wordWrap: "on" as const,
      scrollbar: {
        vertical: "auto" as const,
        horizontal: "hidden" as const,
        verticalScrollbarSize: 8,
      },
      renderLineHighlight: "none" as const,
      cursorStyle: "line" as const,
      selectOnLineNumbers: false,
      contextmenu: false,
      automaticLayout: true,
    }),
    []
  );

  /**
   * Debounced YAML generation from graph data
   * Updates yamlContent 500ms after last graphData change
   */
  useEffect(() => {
    if (!graphData) {
      setYamlContent("");
      setError(null);
      return;
    }

    setIsGenerating(true);

    const timeoutId = setTimeout(() => {
      try {
        const startTime = performance.now();
        const yaml = graphToYaml(graphData);
        const duration = performance.now() - startTime;

        // Performance warning for slow conversions
        if (duration > 100) {
          console.warn(
            `[YAMLPreviewPanel] Slow YAML conversion: ${duration.toFixed(2)}ms`
          );
        }

        setYamlContent(yaml);
        setError(null);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to generate YAML";
        console.error("[YAMLPreviewPanel] YAML generation error:", err);
        setError(errorMessage);
        setYamlContent("");
      } finally {
        setIsGenerating(false);
      }
    }, DEBOUNCE_DELAY);

    return () => {
      clearTimeout(timeoutId);
      setIsGenerating(false);
    };
  }, [graphData, graphToYaml]);

  /**
   * Build node-to-line mapping when YAML content changes
   * Enables auto-scroll to selected node section
   */
  useEffect(() => {
    if (!yamlContent) {
      nodeLineMapRef.current.clear();
      return;
    }

    const lines = yamlContent.split("\n");
    const lineMap = new Map<string, number>();

    lines.forEach((line, index) => {
      // Match node IDs in YAML (e.g., "  id: node-123" or "id: planning")
      const match = /^\s*id:\s*["']?([a-zA-Z0-9_-]+)["']?/.exec(line);
      if (match?.[1]) {
        // Monaco uses 1-based line numbers
        lineMap.set(match[1], index + 1);
      }
    });

    nodeLineMapRef.current = lineMap;
  }, [yamlContent]);

  /**
   * Auto-scroll to selected node's YAML section
   * Highlights the line temporarily for visual feedback
   */
  useEffect(() => {
    if (!selectedNodeId || !editorRef.current || !monacoRef.current) {
      return;
    }

    const lineNumber = nodeLineMapRef.current.get(selectedNodeId);
    if (!lineNumber) {
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Scroll to line and center it in view
    editor.revealLineInCenter(lineNumber);

    // Add temporary line highlight
    const newDecorations = editor.deltaDecorations(decorationsRef.current, [
      {
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "yaml-highlight-line",
          glyphMarginClassName: "yaml-highlight-glyph",
        },
      },
    ]);

    decorationsRef.current = newDecorations;

    // Clear highlight after duration
    const timeoutId = setTimeout(() => {
      if (editorRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(
          decorationsRef.current,
          []
        );
      }
    }, HIGHLIGHT_DURATION);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [selectedNodeId]);

  /**
   * Monaco editor mount handler
   * Sets up editor reference and configures dark theme
   */
  const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Define custom dark theme to match dashboard
    monaco.editor.defineTheme("yaml-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "key", foreground: "9CDCFE" },
        { token: "string.yaml", foreground: "CE9178" },
        { token: "number.yaml", foreground: "B5CEA8" },
        { token: "comment", foreground: "6A9955" },
        { token: "type", foreground: "4EC9B0" },
      ],
      colors: {
        "editor.background": "#0c0c0c", // matches gray-950
        "editor.foreground": "#e2e8f0", // text-gray-200
        "editor.lineHighlightBackground": "#1f2937", // gray-800
        "editorLineNumber.foreground": "#6b7280", // gray-500
        "editorLineNumber.activeForeground": "#9ca3af", // gray-400
        "editor.selectionBackground": "#374151", // gray-700
        "editorIndentGuide.background": "#374151", // gray-700
      },
    });

    monaco.editor.setTheme("yaml-dark");
  }, []);

  /**
   * Copy YAML content to clipboard
   * Shows temporary success/error state
   */
  const handleCopy = useCallback(async () => {
    if (!yamlContent) {
      return;
    }

    try {
      await navigator.clipboard.writeText(yamlContent);
      setCopyStatus("copied");
    } catch (err) {
      console.error("[YAMLPreviewPanel] Copy failed:", err);
      setCopyStatus("error");
    }

    // Reset status after duration
    setTimeout(() => {
      setCopyStatus("idle");
    }, COPY_STATUS_DURATION);
  }, [yamlContent]);

  // ============================================================================
  // Render
  // ============================================================================

  // Empty state when no graph data
  if (!graphData) {
    return (
      <div
        className={`flex flex-col h-full bg-gray-900 border-l border-gray-700 ${className}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-medium text-gray-200">YAML Preview</h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500">
            Build a workflow to see YAML preview
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={`flex flex-col h-full bg-gray-900 border-l border-gray-700 ${className}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-medium text-gray-200">YAML Preview</h3>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
          <p className="text-sm text-red-400 text-center">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full bg-gray-900 border-l border-gray-700 ${className}`}
    >
      {/* Header with copy button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-200">YAML Preview</h3>
          {isGenerating && (
            <span className="text-xs text-gray-500 animate-pulse">
              Generating...
            </span>
          )}
        </div>
        <button
          className={`
            inline-flex items-center gap-1.5
            h-8 px-3 text-xs font-medium rounded-md
            transition-colors duration-150
            focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-gray-900
            disabled:opacity-50 disabled:cursor-not-allowed
            ${
              copyStatus === "copied"
                ? "bg-green-600 text-white"
                : copyStatus === "error"
                  ? "bg-red-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }
          `}
          onClick={handleCopy}
          type="button"
          aria-label="Copy YAML to clipboard"
          disabled={!yamlContent || isGenerating}
        >
          {copyStatus === "copied" ? (
            <>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Copied!
            </>
          ) : copyStatus === "error" ? (
            <>
              <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
              Failed
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="yaml"
          value={yamlContent}
          theme="yaml-dark"
          options={editorOptions}
          onMount={handleEditorDidMount}
          loading={
            <div className="flex items-center justify-center h-full bg-gray-900">
              <span className="text-sm text-gray-500">Loading editor...</span>
            </div>
          }
        />
      </div>

      {/* Footer with line count */}
      {yamlContent && (
        <div className="px-4 py-2 border-t border-gray-700 bg-gray-950">
          <p className="text-xs text-gray-500">
            {yamlContent.split("\n").length} lines
          </p>
        </div>
      )}
    </div>
  );
}
