/**
 * useTerminal -- xterm.js v6 terminal lifecycle hook
 *
 * Creates a Terminal instance with FitAddon, WebLinksAddon, and WebGL renderer.
 * Handles font loading, ResizeObserver-based auto-resize, and strict mode cleanup.
 *
 * @example
 * const { containerRef, terminalRef, fit } = useTerminal({
 *   onData: (data) => ws.send('0' + data),
 *   onResize: (cols, rows) => ws.send('1' + JSON.stringify({ cols, rows })),
 * });
 * return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ITheme, IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * Dashboard terminal theme -- matches globals.css dark mode colors.
 * Uses hex values because xterm.js ITheme does not support OKLCH.
 * Mapped from Tailwind gray/red palette used in dashboard.css.
 */
export const TERMINAL_THEME: ITheme = {
  background: "#030712", // gray-950
  foreground: "#e5e7eb", // gray-200
  cursor: "#ef4444", // red-500
  cursorAccent: "#030712", // gray-950
  selectionBackground: "#374151", // gray-700
  selectionForeground: "#f9fafb", // gray-50
  selectionInactiveBackground: "#1f2937", // gray-800

  // v6 scrollbar theming (VS Code scrollbar integration)
  scrollbarSliderBackground: "rgba(75, 85, 99, 0.4)",
  scrollbarSliderHoverBackground: "rgba(75, 85, 99, 0.7)",
  scrollbarSliderActiveBackground: "rgba(75, 85, 99, 0.9)",

  // Standard ANSI colors
  black: "#1f2937",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#e5e7eb",

  // Bright ANSI colors
  brightBlack: "#4b5563",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#f9fafb",
};

/**
 * Ensure Geist Mono font is loaded before terminal rendering.
 * xterm.js measures character glyphs synchronously during terminal.open().
 * If the web font is not loaded, the browser uses a fallback font for
 * measurements, causing misaligned characters and NaN width issues.
 */
async function ensureFontLoaded(fontFamily: string): Promise<void> {
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.load(`16px "${fontFamily}"`);
      await document.fonts.ready;
    } catch {
      console.warn(
        `[useTerminal] Font "${fontFamily}" not available, using fallback`
      );
    }
  }
}

/**
 * Load WebGL renderer with automatic DOM fallback.
 * WebGL must be loaded AFTER terminal.open() -- it needs a DOM element
 * to create the WebGL2 context.
 */
function loadWebGLWithFallback(terminal: Terminal): WebglAddon | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      console.warn(
        "[useTerminal] WebGL context lost, falling back to DOM renderer"
      );
      webgl.dispose();
    });
    terminal.loadAddon(webgl);
    return webgl;
  } catch (error) {
    console.warn(
      "[useTerminal] WebGL not available, using DOM renderer:",
      error
    );
    return null;
  }
}

/**
 * Fallback clipboard copy using legacy execCommand for contexts where
 * navigator.clipboard.writeText() is denied (no user activation, iframe, etc).
 */
function fallbackCopyToClipboard(text: string): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    // Both clipboard methods failed -- nothing more we can do
  }
}

/** Font family for the terminal -- matches globals.css --font-mono */
const TERMINAL_FONT_FAMILY =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, monospace';

/** Font to pre-load via document.fonts API */
const TERMINAL_FONT_NAME = "Geist Mono Variable";

export interface UseTerminalOptions {
  /** Theme override (defaults to TERMINAL_THEME) */
  theme?: ITheme;
  /** Font size in pixels (default: 14) */
  fontSize?: number;
  /** Scrollback buffer lines (default: 5000) */
  scrollback?: number;
  /** Enable cursor blinking (default: true) */
  cursorBlink?: boolean;
  /** Called when user types or pastes text */
  onData?: (data: string) => void;
  /** Called when terminal is resized (after FitAddon.fit()) */
  onResize?: (cols: number, rows: number) => void;
  /** Called for binary events (mouse reports) */
  onBinary?: (data: string) => void;
}

export interface UseTerminalResult {
  /** Ref to attach to the container div */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to the Terminal instance (null before mount) */
  terminalRef: React.RefObject<Terminal | null>;
  /** Ref to the FitAddon instance (null before mount) */
  fitAddonRef: React.RefObject<FitAddon | null>;
  /** Manually trigger a fit (call after layout changes) */
  fit: () => void;
  /** Whether the terminal has been initialized */
  ready: boolean;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);

  // Stable refs for callbacks to avoid re-creating terminal on callback changes
  // Stores the last tmux selection text received via OSC 52, so that
  // Ctrl+C can copy it even though xterm.js doesn't own the selection.
  const tmuxSelectionRef = useRef<string | null>(null);

  const onDataRef = useRef(options.onData);
  const onResizeRef = useRef(options.onResize);
  const onBinaryRef = useRef(options.onBinary);
  onDataRef.current = options.onData;
  onResizeRef.current = options.onResize;
  onBinaryRef.current = options.onBinary;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Capture non-null container for use in async init closure
    const el: HTMLDivElement = container;

    let disposed = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let webglAddon: WebglAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const disposables: IDisposable[] = [];

    async function init(): Promise<void> {
      // 1. Load font before terminal.open()
      await ensureFontLoaded(TERMINAL_FONT_NAME);

      if (disposed) return; // Guard against strict mode unmount during await

      // 2. Create terminal
      terminal = new Terminal({
        cursorBlink: options.cursorBlink ?? true,
        fontSize: options.fontSize ?? 14,
        fontFamily: TERMINAL_FONT_FAMILY,
        scrollback: options.scrollback ?? 5000,
        theme: options.theme ?? TERMINAL_THEME,
        allowProposedApi: true,
      });

      // 3. Load addons (FitAddon before WebGL)
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      // 4. Open terminal in container
      terminal.open(el);

      // 5. Load WebGL renderer with DOM fallback (AFTER open)
      webglAddon = loadWebGLWithFallback(terminal);

      // 5b. Clipboard handler -- paste via native paste event, copy via
      // Clipboard API. Using the native paste event avoids permission prompts
      // and works reliably on all platforms (clipboardData is always available
      // during a paste event, unlike navigator.clipboard.readText() which
      // requires explicit permission).
      const term = terminal;

      // Add capture-phase paste listener on xterm.js's hidden textarea.
      // This fires BEFORE xterm.js's internal paste handler.
      // We handle the paste ourselves and stop propagation to prevent
      // xterm.js from double-processing it.
      const textarea = term.textarea;
      if (textarea) {
        const pasteHandler = (ev: Event): void => {
          const clipEv = ev as ClipboardEvent;
          clipEv.preventDefault();
          clipEv.stopImmediatePropagation();

          // Check for image data first (Windows screenshot paste)
          const items = clipEv.clipboardData?.items;
          if (items) {
            for (const item of items) {
              if (item.type.startsWith("image/")) {
                const blob = item.getAsFile();
                if (blob) {
                  void (async () => {
                    try {
                      const res = await fetch("/api/clipboard/upload", {
                        method: "POST",
                        headers: { "Content-Type": blob.type },
                        body: blob,
                      });
                      if (res.ok) {
                        const data = (await res.json()) as { path: string };
                        term.paste(data.path + " ");
                      }
                    } catch {
                      // Upload failed, silently ignore
                    }
                  })();
                  return; // Image handled, skip text
                }
              }
            }
          }

          const text = clipEv.clipboardData?.getData("text/plain");
          if (text) term.paste(text);
        };
        textarea.addEventListener("paste", pasteHandler, true);
        disposables.push({ dispose: () => textarea.removeEventListener("paste", pasteHandler, true) });
      }

      term.attachCustomKeyEventHandler((ev: KeyboardEvent): boolean => {
        if (ev.type !== "keydown") return true;
        const isMod = ev.ctrlKey || ev.metaKey;

        // Paste: Ctrl+V / Cmd+V -- return false to prevent xterm sending
        // \x16 byte. Do NOT call preventDefault so the browser fires the
        // native paste event, which our capture-phase listener handles.
        if (isMod && ev.key === "v") {
          return false;
        }

        // Ctrl+Shift+V -- alternative paste (Linux convention), same approach
        if (ev.ctrlKey && ev.shiftKey && ev.key === "V") {
          return false;
        }

        // Copy: Ctrl+C / Cmd+C when there is a selection (xterm.js or tmux)
        if (isMod && ev.key === "c") {
          // Prefer xterm.js native selection, fall back to tmux OSC 52 selection
          const sel = term.hasSelection()
            ? term.getSelection()
            : tmuxSelectionRef.current;
          if (sel) {
            void navigator.clipboard
              .writeText(sel)
              .catch(() => fallbackCopyToClipboard(sel));
            // Keep selection visible after copy (don't clear it)
            tmuxSelectionRef.current = null;
            return false; // Prevent xterm from sending SIGINT
          }
          // No selection at all -- let Ctrl+C pass through as SIGINT
          return true;
        }

        // Ctrl+Shift+C -- alternative copy shortcut (Linux convention)
        if (ev.ctrlKey && ev.shiftKey && ev.key === "C") {
          const sel = term.hasSelection()
            ? term.getSelection()
            : tmuxSelectionRef.current;
          if (sel) {
            void navigator.clipboard
              .writeText(sel)
              .catch(() => fallbackCopyToClipboard(sel));
            // Keep selection visible after copy (don't clear it)
            tmuxSelectionRef.current = null;
          }
          return false;
        }

        return true; // Let all other keys pass through to xterm
      });

      // 5c. OSC 52 clipboard handler -- intercept OSC 52 escape sequences
      // from tmux. Stash the selection text so Ctrl+C can copy it on demand.
      // OSC 52 payload format: <target>;<base64-encoded-text>
      disposables.push(
        term.parser.registerOscHandler(52, (data: string) => {
          const semiIdx = data.indexOf(";");
          const b64 = semiIdx >= 0 ? data.slice(semiIdx + 1) : data;
          if (b64 && b64 !== "?") {
            try {
              tmuxSelectionRef.current = atob(b64);
            } catch {
              tmuxSelectionRef.current = null;
            }
          }
          return true; // Suppress default xterm.js clipboard handling
        })
      );

      // 6. Initial fit
      fitAddon.fit();

      // 7. Store refs
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // 8. Wire event handlers via stable refs
      disposables.push(
        terminal.onData((data) => onDataRef.current?.(data))
      );
      disposables.push(
        terminal.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows))
      );
      disposables.push(
        terminal.onBinary((data) => onBinaryRef.current?.(data))
      );

      // 9. ResizeObserver for auto-resize
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          try {
            fitAddon?.fit();
          } catch {
            // Terminal may be disposing during resize
          }
        }, 50);
      });
      resizeObserver.observe(el);

      setReady(true);
    }

    void init();

    // Cleanup on unmount (handles React 19 strict mode double-mount)
    return () => {
      disposed = true;
      setReady(false);
      clearTimeout(resizeTimeout);
      resizeObserver?.disconnect();
      for (const d of disposables) {
        d.dispose();
      }
      webglAddon?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Terminal created once on mount
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  return { containerRef, terminalRef, fitAddonRef, fit, ready };
}
