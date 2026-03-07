/**
 * AnimationContext - Centralized Animation Manager
 *
 * Performance optimization that consolidates all animation callbacks into a single
 * useFrame hook instead of having each component run its own useFrame.
 *
 * Features:
 * - Single useFrame hook for all registered animations
 * - Visibility API integration to pause when tab is hidden
 * - Delta clamping to prevent animation jumps after tab switch
 * - Register/unregister pattern for animation callbacks
 *
 * @module contexts/AnimationContext
 */

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useFrame, type RootState } from "@react-three/fiber";

// ============================================================================
// Types
// ============================================================================

/**
 * Animation callback function signature
 * @param state - R3F root state with clock, camera, etc.
 * @param delta - Time delta since last frame (clamped)
 */
export type AnimationCallback = (state: RootState, delta: number) => void;

/**
 * Animation registration info
 */
interface AnimationRegistration {
  id: string;
  callback: AnimationCallback;
  priority: number;
}

/**
 * AnimationContext value interface
 */
interface AnimationContextValue {
  /**
   * Register an animation callback
   * @param id - Unique identifier for the animation
   * @param callback - Animation function called each frame
   * @param priority - Execution order (lower = earlier, default 0)
   * @returns Unregister function
   */
  register: (
    id: string,
    callback: AnimationCallback,
    priority?: number
  ) => () => void;

  /**
   * Unregister an animation callback by ID
   * @param id - The ID used when registering
   */
  unregister: (id: string) => void;

  /**
   * Whether animations are currently paused (tab hidden)
   */
  isPaused: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed delta time (100ms = 10fps minimum)
 * Prevents large jumps when returning from hidden tab
 */
const MAX_DELTA = 0.1;

/**
 * Minimum delta time to prevent divide-by-zero issues
 */
const MIN_DELTA = 0.001;

// ============================================================================
// Context
// ============================================================================

const AnimationContext = createContext<AnimationContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Props for AnimationProvider
 */
interface AnimationProviderProps {
  children: ReactNode;
}

/**
 * AnimationProvider component
 *
 * Wraps R3F components to provide centralized animation management.
 * Must be placed inside a Canvas component.
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <AnimationProvider>
 *     <MyAnimatedComponent />
 *   </AnimationProvider>
 * </Canvas>
 * ```
 */
export function AnimationProvider({
  children,
}: AnimationProviderProps): JSX.Element {
  // Store registered animations in a ref to avoid re-renders
  const registrationsRef = useRef<Map<string, AnimationRegistration>>(
    new Map()
  );

  // Sorted callbacks cache (invalidated when registrations change)
  const sortedCallbacksRef = useRef<AnimationRegistration[]>([]);
  const isDirtyRef = useRef(true);

  // Visibility state
  const isPausedRef = useRef(false);
  const lastTimeRef = useRef(0);

  // -------------------------------------------------------------------------
  // Visibility API Integration
  // -------------------------------------------------------------------------

  useEffect(() => {
    function handleVisibilityChange(): void {
      isPausedRef.current = document.hidden;

      // When becoming visible again, reset time tracking to prevent large delta
      if (!document.hidden) {
        lastTimeRef.current = 0;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Registration Functions
  // -------------------------------------------------------------------------

  const register = useCallback(
    (
      id: string,
      callback: AnimationCallback,
      priority: number = 0
    ): (() => void) => {
      registrationsRef.current.set(id, { id, callback, priority });
      isDirtyRef.current = true;

      // Return unregister function
      return () => {
        registrationsRef.current.delete(id);
        isDirtyRef.current = true;
      };
    },
    []
  );

  const unregister = useCallback((id: string): void => {
    registrationsRef.current.delete(id);
    isDirtyRef.current = true;
  }, []);

  // -------------------------------------------------------------------------
  // Centralized useFrame Hook
  // -------------------------------------------------------------------------

  useFrame((state, delta) => {
    // Skip updates when tab is hidden
    if (isPausedRef.current) {
      return;
    }

    // Clamp delta to prevent animation jumps
    // This handles returning from hidden tab or frame drops
    const clampedDelta = Math.max(MIN_DELTA, Math.min(delta, MAX_DELTA));

    // Re-sort callbacks if registrations changed
    if (isDirtyRef.current) {
      sortedCallbacksRef.current = Array.from(
        registrationsRef.current.values()
      ).sort((a, b) => a.priority - b.priority);
      isDirtyRef.current = false;
    }

    // Execute all registered callbacks with clamped delta
    for (const registration of sortedCallbacksRef.current) {
      registration.callback(state, clampedDelta);
    }
  });

  // -------------------------------------------------------------------------
  // Context Value
  // -------------------------------------------------------------------------

  const contextValue: AnimationContextValue = {
    register,
    unregister,
    isPaused: isPausedRef.current,
  };

  return (
    <AnimationContext.Provider value={contextValue}>
      {children}
    </AnimationContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access the animation context
 *
 * @throws Error if used outside of AnimationProvider
 * @returns AnimationContextValue
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { register } = useAnimationContext();
 *
 *   useEffect(() => {
 *     return register('my-animation', (state, delta) => {
 *       // Animation logic here
 *     });
 *   }, [register]);
 * }
 * ```
 */
export function useAnimationContext(): AnimationContextValue {
  const context = useContext(AnimationContext);

  if (context === null) {
    throw new Error(
      "useAnimationContext must be used within an AnimationProvider"
    );
  }

  return context;
}

// ============================================================================
// Convenience Hook
// ============================================================================

/**
 * Hook to register an animation callback
 *
 * Automatically registers on mount and unregisters on unmount.
 * Handles callback changes without re-registering.
 *
 * @param id - Unique identifier for the animation
 * @param callback - Animation function called each frame
 * @param priority - Execution order (lower = earlier)
 * @param deps - Dependencies that should trigger callback update
 *
 * @example
 * ```tsx
 * function BobbingMesh() {
 *   const meshRef = useRef<THREE.Mesh>(null);
 *
 *   useAnimation('bobbing', (state, delta) => {
 *     if (meshRef.current) {
 *       meshRef.current.position.y = Math.sin(state.clock.elapsedTime);
 *     }
 *   });
 *
 *   return <mesh ref={meshRef} />;
 * }
 * ```
 */
export function useAnimation(
  id: string,
  callback: AnimationCallback,
  priority: number = 0
): void {
  const { register } = useAnimationContext();

  // Store callback in ref to avoid re-registering on every render
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    // Wrapper that always calls the latest callback
    const wrappedCallback: AnimationCallback = (state, delta) => {
      callbackRef.current(state, delta);
    };

    return register(id, wrappedCallback, priority);
  }, [id, priority, register]);
}

// ============================================================================
// Optional Animation Hook (No Context Required)
// ============================================================================

/**
 * Standalone animation hook with visibility and delta clamping
 *
 * Use this when AnimationProvider is not available.
 * Less efficient than centralized approach but works standalone.
 *
 * @param callback - Animation function called each frame
 * @param deps - Dependencies for the callback
 */
export function useOptionalAnimation(
  callback: AnimationCallback
): void {
  const isPausedRef = useRef(false);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Visibility tracking
  useEffect(() => {
    function handleVisibilityChange(): void {
      isPausedRef.current = document.hidden;
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useFrame((state, delta) => {
    if (isPausedRef.current) return;

    const clampedDelta = Math.max(MIN_DELTA, Math.min(delta, MAX_DELTA));
    callbackRef.current(state, clampedDelta);
  });
}
