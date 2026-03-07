/**
 * useWarmingStepButton.ts
 * State machine hook for the warming step button lifecycle.
 *
 * States: idle -> running -> cooldown (5s) -> idle
 *                         -> error -> (click) -> running
 *                         -> disabled (limit reached)
 *
 * Research: docs/research/x-dashboard-error-handling-patterns.md (Finding 5)
 */

import { useCallback, useEffect, useReducer, useRef } from "react";

export type WarmingButtonState = "idle" | "running" | "cooldown" | "error" | "disabled";

export interface WarmingStepState {
  buttonState: WarmingButtonState;
  completedToday: number;
  dailyLimit: number;
  errorMessage: string | null;
}

type WarmingAction =
  | { type: "START" }
  | { type: "SUCCESS"; completedToday: number; dailyLimit: number }
  | { type: "ERROR"; message: string }
  | { type: "COOLDOWN_COMPLETE" }
  | { type: "SET_COUNTS"; completedToday: number; dailyLimit: number };

function warmingReducer(state: WarmingStepState, action: WarmingAction): WarmingStepState {
  switch (action.type) {
    case "START":
      return { ...state, buttonState: "running", errorMessage: null };

    case "SUCCESS": {
      const atLimit = action.completedToday >= action.dailyLimit;
      return {
        ...state,
        buttonState: atLimit ? "disabled" : "cooldown",
        completedToday: action.completedToday,
        dailyLimit: action.dailyLimit,
        errorMessage: null,
      };
    }

    case "ERROR":
      return { ...state, buttonState: "error", errorMessage: action.message };

    case "COOLDOWN_COMPLETE":
      return state.buttonState === "cooldown"
        ? { ...state, buttonState: "idle" }
        : state;

    case "SET_COUNTS": {
      const atLimit = action.completedToday >= action.dailyLimit;
      return {
        ...state,
        completedToday: action.completedToday,
        dailyLimit: action.dailyLimit,
        buttonState: atLimit && state.buttonState === "idle" ? "disabled" : state.buttonState,
      };
    }

    default:
      return state;
  }
}

const COOLDOWN_MS = 5000;

interface UseWarmingStepButtonOptions {
  /** Async function that executes the warming step API call */
  onWarm: () => Promise<{ completedToday: number; dailyLimit: number }>;
  /** Initial completed count (from account data) */
  initialCompleted?: number;
  /** Initial daily limit (from account data) */
  initialLimit?: number;
}

interface UseWarmingStepButtonReturn {
  state: WarmingStepState;
  /** Call this to trigger the warming step */
  execute: () => void;
  /** Button display label based on current state */
  label: string;
  /** Whether the button is clickable */
  isClickable: boolean;
}

/**
 * State machine hook for the warming step button lifecycle.
 *
 * Manages transitions between 5 states:
 * - idle: Ready to warm ('Warm')
 * - running: API call in progress ('Running...' + spinner)
 * - cooldown: Success, waiting 5s before allowing next ('Done 3/10' + green check)
 * - error: API call failed ('Retry' + red outline)
 * - disabled: Daily limit reached ('Limit 10/10' + grayed out)
 *
 * @example
 * ```tsx
 * const { state, execute, label, isClickable } = useWarmingStepButton({
 *   onWarm: async () => {
 *     const res = await dashboardFetch(`/api/x/accounts/${id}/warm`, { method: "POST" });
 *     const data = await res.json();
 *     return { completedToday: data.completedToday, dailyLimit: data.dailyLimit };
 *   },
 *   initialCompleted: account.warmingStepsToday,
 *   initialLimit: 10,
 * });
 * ```
 */
export function useWarmingStepButton({
  onWarm,
  initialCompleted = 0,
  initialLimit = 10,
}: UseWarmingStepButtonOptions): UseWarmingStepButtonReturn {
  const [state, dispatch] = useReducer(warmingReducer, {
    buttonState: initialCompleted >= initialLimit ? "disabled" : "idle",
    completedToday: initialCompleted,
    dailyLimit: initialLimit,
    errorMessage: null,
  });

  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current !== null) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  // Start cooldown timer when entering cooldown state
  useEffect(() => {
    if (state.buttonState === "cooldown") {
      cooldownTimerRef.current = setTimeout(() => {
        dispatch({ type: "COOLDOWN_COMPLETE" });
        cooldownTimerRef.current = null;
      }, COOLDOWN_MS);
    }
  }, [state.buttonState]);

  const execute = useCallback((): void => {
    if (state.buttonState !== "idle" && state.buttonState !== "error") {
      return;
    }

    dispatch({ type: "START" });

    void onWarm()
      .then((result) => {
        dispatch({
          type: "SUCCESS",
          completedToday: result.completedToday,
          dailyLimit: result.dailyLimit,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Warming step failed";
        dispatch({ type: "ERROR", message });
      });
  }, [state.buttonState, onWarm]);

  // Derive display label
  let label: string;
  switch (state.buttonState) {
    case "idle":
      label = "Warm";
      break;
    case "running":
      label = "Running...";
      break;
    case "cooldown":
      label = `Done ${state.completedToday}/${state.dailyLimit}`;
      break;
    case "error":
      label = "Retry";
      break;
    case "disabled":
      label = `Limit ${state.completedToday}/${state.dailyLimit}`;
      break;
  }

  const isClickable = state.buttonState === "idle" || state.buttonState === "error";

  return { state, execute, label, isClickable };
}
