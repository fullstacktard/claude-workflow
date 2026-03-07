/**
 * ToastContext.tsx
 * Context-based toast notification system
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";

import { ToastContainer, ToastItem, ToastType } from "../components/Toast";

/**
 * Toast context actions
 */
type ToastAction =
  | { type: "ADD_TOAST"; payload: ToastItem }
  | { type: "REMOVE_TOAST"; payload: string }
  | { type: "REMOVE_CATEGORY"; payload: string };

/**
 * Toast context state
 */
interface ToastState {
  toasts: ToastItem[];
}

/**
 * Toast context value
 */
interface ToastContextValue {
  addToast: (
    message: string,
    type: ToastType,
    options?: { projectName?: string; duration?: number; persistent?: boolean; category?: string; onClick?: () => void }
  ) => string;
  removeToast: (id: string) => void;
  removeCategory: (category: string) => void;
  toasts: ToastItem[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toast reducer
 * Supports multi-toast with category-based deduplication.
 * Same-category toasts replace each other; different categories coexist.
 * Maximum 3 toasts displayed simultaneously.
 */
function toastReducer(
  state: ToastState,
  action: ToastAction
): ToastState {
  switch (action.type) {
    case "ADD_TOAST": {
      const newToast = action.payload;
      // Filter out same-category toasts if category is set
      const filtered = newToast.category
        ? state.toasts.filter((t) => t.category !== newToast.category)
        : state.toasts;
      return {
        ...state,
        toasts: [...filtered, newToast].slice(-3),
      };
    }
    case "REMOVE_TOAST":
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.payload),
      };
    case "REMOVE_CATEGORY":
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.category !== action.payload),
      };
    default:
      return state;
  }
}

/**
 * ToastProvider component
 */
interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(toastReducer, {
    toasts: [],
  });

  const addToast = useCallback(
    (
      message: string,
      type: ToastType,
      options?: { projectName?: string; duration?: number; persistent?: boolean; category?: string; onClick?: () => void }
    ): string => {
      const id = `toast-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}`;
      const toast: ToastItem = {
        id,
        message,
        type,
        projectName: options?.projectName,
        duration: options?.duration ?? 5000,
        persistent: options?.persistent,
        category: options?.category,
        onClick: options?.onClick,
      };
      dispatch({ type: "ADD_TOAST", payload: toast });
      return id;
    },
    []
  );

  const removeToast = useCallback((id: string): void => {
    dispatch({ type: "REMOVE_TOAST", payload: id });
  }, []);

  const removeCategory = useCallback((category: string): void => {
    dispatch({ type: "REMOVE_CATEGORY", payload: category });
  }, []);

  const value = useMemo(
    () => ({ addToast, removeToast, removeCategory, toasts: state.toasts }),
    [addToast, removeToast, removeCategory, state.toasts]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={state.toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

/**
 * useToast hook
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
