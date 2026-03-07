/**
 * Toast Component
 * Displays individual toast notifications with animations
 *
 * NOTE: Animation classes (animate-toast-slide-in, animate-toast-slide-out) are defined
 * in globals.css because they require @keyframes which cannot be pure Tailwind utilities.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Toast type definitions
 */
export type ToastType = "success" | "error" | "warning" | "info" | "attention";

/**
 * Toast item interface
 */
export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  projectName?: string;
  duration?: number;
  /** If true, toast won't auto-dismiss */
  persistent?: boolean;
  /** Category for deduplication (same-category toasts replace each other) */
  category?: string;
  /** Optional click handler (e.g., navigate to relevant page) */
  onClick?: () => void;
}

/**
 * Toast border color classes by type
 */
const TOAST_BORDER_CLASSES: Record<ToastType, string> = {
  success: "border-red-800/60",
  error: "border-red-500/60",
  warning: "border-red-800/60",
  info: "border-red-800/60",
  attention: "border-red-500/80",
};

/**
 * Toast left-accent color classes by type
 */
const TOAST_ACCENT_CLASSES: Record<ToastType, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-yellow-500",
  info: "bg-red-400",
  attention: "bg-red-400 animate-pulse",
};

/**
 * Individual Toast component
 */
interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  style?: React.CSSProperties;
}

export function Toast({ toast, onDismiss, style }: ToastProps): JSX.Element {
  const [isExiting, setIsExiting] = useState(false);
  const hasDismissedRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismiss = useCallback(() => {
    // Prevent multiple dismissals (race condition)
    if (hasDismissedRef.current) {
      return;
    }

    hasDismissedRef.current = true;
    setIsExiting(true);

    // Track timer for cleanup on unmount
    dismissTimerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, 200); // Match exit animation duration
  }, [onDismiss, toast.id]);

  // Auto-dismiss after duration (unless persistent)
  useEffect(() => {
    // Skip auto-dismiss for persistent toasts
    if (toast.persistent === true) {
      return () => {
        // Clean up dismiss timer if component unmounts during exit animation
        if (dismissTimerRef.current) {
          clearTimeout(dismissTimerRef.current);
        }
      };
    }

    const duration = toast.duration ?? 5000;
    const autoTimer = setTimeout(handleDismiss, duration);

    return () => {
      clearTimeout(autoTimer);

      // Clean up dismiss timer if component unmounts during exit animation
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [handleDismiss, toast.duration, toast.persistent]);

  const borderClass = TOAST_BORDER_CLASSES[toast.type];
  const accentClass = TOAST_ACCENT_CLASSES[toast.type];
  // Animation classes defined in globals.css (requires @keyframes)
  const animationClass = isExiting ? "animate-toast-slide-out" : "animate-toast-slide-in";

  const isClickable = Boolean(toast.onClick);

  return (
    <div
      className={`bg-gray-900/95 border ${borderClass} rounded p-3 shadow-xl backdrop-blur-sm flex items-center gap-3 min-w-[320px] max-w-md font-mono text-sm text-gray-300 ${animationClass}${isClickable ? " cursor-pointer hover:bg-gray-800/95" : ""}`}
      role="alert"
      style={style}
      onClick={
        isClickable
          ? (): void => {
              toast.onClick?.();
              handleDismiss();
            }
          : undefined
      }
    >
      <span className={`w-0.5 self-stretch rounded-full ${accentClass}`} />
      <span className="flex-1 text-sm text-gray-300">{toast.message}</span>
    </div>
  );
}

/**
 * ToastContainer Component
 * Renders toast notifications in top-right corner with stacking
 */
interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({
  toasts,
  onDismiss,
}: ToastContainerProps): JSX.Element {
  return (
    <div
      className="fixed z-50 flex flex-col gap-3 top-12 right-4"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast, index) => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          style={{ "--toast-index": index } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
