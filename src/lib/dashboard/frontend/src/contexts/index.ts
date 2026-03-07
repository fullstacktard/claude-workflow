/**
 * Dashboard Frontend Contexts
 * Centralized exports for React contexts
 *
 * NOTE: AnimationContext is NOT exported here because it uses @react-three/fiber hooks
 * and should only be imported inside components that are already in a Canvas context.
 * Import it directly from "./AnimationContext" when needed.
 *
 * @module contexts
 */

// Toast notifications
export { ToastProvider, useToast } from "./ToastContext";

// Animation context (R3F-specific - import directly when inside Canvas)
// export { AnimationProvider, useAnimationContext, useAnimation, useOptionalAnimation } from "./AnimationContext";
