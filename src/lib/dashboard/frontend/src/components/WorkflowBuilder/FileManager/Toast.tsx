/**
 * Toast Component
 * Notification toast for success/error messages with auto-dismiss
 */

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

interface ToastProps {
  type: 'success' | 'error';
  message: string;
  onDismiss: () => void;
}

export function Toast({ type, message, onDismiss }: ToastProps): JSX.Element {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(onDismiss, 200); // Match animation duration
  }, [onDismiss]);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timer = setTimeout(handleDismiss, 5000);
    return () => clearTimeout(timer);
  }, [handleDismiss]);

  // Keyboard dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss]);

  const Icon = type === 'success' ? CheckCircle : XCircle;
  const bgColor = type === 'success' ? 'bg-green-600' : 'bg-red-600';
  const animationClass = isExiting
    ? 'animate-toast-slide-out'
    : 'animate-toast-slide-in';

  return (
    <div
      className={`fixed bottom-4 right-4 z-[100] ${bgColor} text-white rounded-lg shadow-xl p-4 flex items-start gap-3 min-w-[320px] max-w-md ${animationClass}`}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />

      <div className="flex-1">
        <p className="text-sm font-medium">{message}</p>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        className="p-1 rounded hover:bg-white/20 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
