/**
 * ModelErrorBoundary Component
 * Catches errors from GLTF loading and renders fallback geometry
 *
 * This is a class component because React Error Boundaries require
 * componentDidCatch or getDerivedStateFromError lifecycle methods,
 * which are not available in function components.
 *
 * @module components/visualization/ModelErrorBoundary
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { FallbackGeometry } from "./FallbackGeometry";
import type { FallbackGeometryType } from "../../config/visualization-config";
import { MODEL_CONFIG } from "../../config/visualization-config";
import type { ThreeElements } from "@react-three/fiber";

/** GroupProps type from React Three Fiber JSX elements */
type GroupProps = ThreeElements["group"];

export interface ModelErrorBoundaryProps extends Omit<GroupProps, "children"> {
  /** Children to render (typically GLTFModel) */
  children: ReactNode;
  /** Type of fallback geometry on error */
  fallbackType?: FallbackGeometryType;
  /** Color for fallback geometry */
  fallbackColor?: string;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

interface ModelErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ModelErrorBoundary catches errors from child components (like GLTFModel)
 * and renders FallbackGeometry instead of crashing the entire 3D scene.
 *
 * Features:
 * - Catches GLTF loading errors
 * - Logs errors to console for debugging
 * - Renders configurable fallback geometry
 * - Optional error callback for parent notification
 *
 * @example
 * // Basic usage
 * <ModelErrorBoundary>
 *   <GLTFModel modelPath="/models/maybe-missing.glb" />
 * </ModelErrorBoundary>
 *
 * @example
 * // With custom fallback and error handling
 * <ModelErrorBoundary
 *   fallbackType="sphere"
 *   fallbackColor="#ff0000"
 *   onError={(err) => logToService(err)}
 * >
 *   <GLTFModel modelPath="/models/character.glb" />
 * </ModelErrorBoundary>
 */
export class ModelErrorBoundary extends Component<
  ModelErrorBoundaryProps,
  ModelErrorBoundaryState
> {
  constructor(props: ModelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ModelErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging (AC #13: Error messages logged to console)
    console.error("[ModelLoader] Failed to load GLTF model:", error.message);
    console.error("[ModelLoader] Component stack:", errorInfo.componentStack);

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error);
    }
  }

  render(): ReactNode {
    const { children, fallbackType, fallbackColor, onError, scale, ...groupProps } =
      this.props;
    // onError is handled via componentDidCatch, scale excluded for type compatibility
    void onError;
    void scale;

    // Ensure fallbackType has correct type
    const finalFallbackType: FallbackGeometryType =
      fallbackType ?? MODEL_CONFIG.fallbackGeometry;

    // If an error occurred, render fallback geometry
    if (this.state.hasError) {
      return (
        <FallbackGeometry
          {...groupProps}
          type={finalFallbackType}
          color={fallbackColor ?? MODEL_CONFIG.errorColor}
        />
      );
    }

    // Otherwise, render children normally
    return children;
  }
}
