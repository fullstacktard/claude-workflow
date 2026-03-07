/**
 * ContextMenu Component
 *
 * Right-click context menu for tmux session actions (Attach, Kill, Rename).
 * Positioned at pointer coordinates using `position: fixed` so it works
 * correctly regardless of scroll position.
 *
 * Accessibility:
 * - `role="menu"` on the container
 * - `role="menuitem"` on each action button
 * - Focus trapped to first item on mount
 * - Closes on Escape key or click outside
 *
 * @example
 * ```tsx
 * <ContextMenu
 *   x={event.clientX}
 *   y={event.clientY}
 *   onAttach={() => attach(sessionName)}
 *   onKill={() => kill(sessionName)}
 *   onRename={() => rename(sessionName)}
 *   onClose={() => setMenu(null)}
 * />
 * ```
 */

import { useEffect, useRef } from "react";

/** Props for the ContextMenu component. */
export interface ContextMenuProps {
  /** X coordinate (clientX from the right-click event). */
  x: number;
  /** Y coordinate (clientY from the right-click event). */
  y: number;
  /** Callback when "Attach" is selected. */
  onAttach: () => void;
  /** Callback when "Kill" is selected. */
  onKill: () => void;
  /** Callback when "Rename" is selected. */
  onRename: () => void;
  /** Callback to close the context menu (click-outside, Escape). */
  onClose: () => void;
}

/** A single context menu action item. */
interface MenuItem {
  label: string;
  action: () => void;
}

/**
 * ContextMenu -- Fixed-position context menu for session actions.
 *
 * Renders at the mouse pointer position with three actions:
 * Attach, Kill, and Rename. Closes on click-outside or Escape.
 */
export function ContextMenu({
  x,
  y,
  onAttach,
  onKill,
  onRename,
  onClose,
}: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return (): void => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Focus first menu item on mount for keyboard accessibility
  useEffect(() => {
    const firstButton = menuRef.current?.querySelector<HTMLButtonElement>("button");
    firstButton?.focus();
  }, []);

  const menuItems: MenuItem[] = [
    { label: "Attach", action: onAttach },
    { label: "Kill", action: onKill },
    { label: "Rename", action: onRename },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-36 bg-gray-900 border border-red-800 rounded shadow-lg py-1 text-sm font-mono"
      style={{ left: x, top: y }}
    >
      {menuItems.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={[
            "w-full text-left px-3 py-1.5 text-gray-300",
            "hover:bg-gray-800 hover:text-white",
            "focus:bg-gray-800 focus:text-white focus:outline-none",
            "transition-colors",
          ].join(" ")}
          onClick={item.action}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
