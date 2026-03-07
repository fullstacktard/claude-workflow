/**
 * ConfirmationContext.tsx
 * Promise-based confirmation dialog system for destructive operations.
 *
 * Pattern: React Context + Provider following ToastContext.tsx
 * Modal: Follows AddAccountModal.tsx accessibility patterns
 * Research: docs/research/x-dashboard-error-handling-patterns.md (Finding 6)
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Options for the confirmation dialog.
 * Destructive variant focuses Cancel button and uses red Confirm button.
 */
export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

interface ConfirmationContextValue {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
}

interface ConfirmationState {
  isOpen: boolean;
  options: ConfirmationOptions;
  resolve: ((value: boolean) => void) | null;
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

interface ConfirmationProviderProps {
  children: ReactNode;
}

export function ConfirmationProvider({ children }: ConfirmationProviderProps): JSX.Element {
  const [state, setState] = useState<ConfirmationState>({
    isOpen: false,
    options: { title: "", message: "" },
    resolve: null,
  });

  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmationOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleResponse = useCallback((value: boolean): void => {
    if (state.resolve) {
      state.resolve(value);
    }
    setState({
      isOpen: false,
      options: { title: "", message: "" },
      resolve: null,
    });
  }, [state.resolve]);

  // Focus management: focus Cancel for destructive, Confirm for default
  useEffect(() => {
    if (state.isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";

      // Delay focus to next frame to ensure DOM is rendered
      requestAnimationFrame(() => {
        const isDestructive = state.options.variant === "destructive";
        if (isDestructive) {
          cancelButtonRef.current?.focus();
        } else {
          confirmButtonRef.current?.focus();
        }
      });
    } else {
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [state.isOpen, state.options.variant]);

  // Keyboard handler: Escape to dismiss, Tab trap
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === "Escape") {
        handleResponse(false);
        return;
      }

      // Tab trap within modal
      if (event.key === "Tab" && modalRef.current) {
        const focusableElements = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );

        if (focusableElements.length === 0) return;

        const activeElement = document.activeElement as HTMLElement;
        const currentIndex = focusableElements.indexOf(activeElement);

        if (event.shiftKey) {
          event.preventDefault();
          if (currentIndex <= 0) {
            focusableElements[focusableElements.length - 1]?.focus();
          } else {
            focusableElements[currentIndex - 1]?.focus();
          }
        } else {
          event.preventDefault();
          if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
            focusableElements[0]?.focus();
          } else {
            focusableElements[currentIndex + 1]?.focus();
          }
        }
      }
    },
    [handleResponse]
  );

  const isDestructive = state.options.variant === "destructive";

  const value = { confirm };

  return (
    <ConfirmationContext.Provider value={value}>
      {children}

      {/* Confirmation Modal */}
      {state.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => handleResponse(false)}
            aria-hidden="true"
          />

          {/* Dialog */}
          <div
            ref={modalRef}
            className="relative w-full max-w-md mx-4 rounded-lg border border-red-800 bg-gray-950 shadow-xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            aria-describedby="confirmation-message"
            onKeyDown={handleKeyDown}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-2">
              <h2
                id="confirmation-title"
                className="text-lg font-semibold text-white font-mono"
              >
                {state.options.title}
              </h2>
            </div>

            {/* Body */}
            <div className="px-5 pb-4">
              <p
                id="confirmation-message"
                className="text-sm text-gray-400 leading-relaxed"
              >
                {state.options.message}
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-gray-800 px-5 py-4">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => handleResponse(false)}
                className="rounded-md border border-gray-700 bg-transparent px-4 py-2 text-sm font-medium text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950"
              >
                {state.options.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                onClick={() => handleResponse(true)}
                className={
                  isDestructive
                    ? "rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-950"
                    : "rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950"
                }
              >
                {state.options.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmationContext.Provider>
  );
}

/**
 * useConfirm hook -- returns the confirm() function.
 * Must be used within ConfirmationProvider.
 *
 * @example
 * ```tsx
 * const confirm = useConfirm();
 *
 * const handleDelete = async () => {
 *   const confirmed = await confirm({
 *     title: "Remove Account",
 *     message: "This will permanently remove the account and all associated data.",
 *     confirmLabel: "Remove",
 *     variant: "destructive",
 *   });
 *   if (confirmed) {
 *     await deleteAccount(accountId);
 *   }
 * };
 * ```
 */
export function useConfirm(): (options: ConfirmationOptions) => Promise<boolean> {
  const context = useContext(ConfirmationContext);
  if (context === null) {
    throw new Error("useConfirm must be used within a ConfirmationProvider");
  }
  return context.confirm;
}
