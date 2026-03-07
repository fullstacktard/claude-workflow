/**
 * React Three Fiber Components
 *
 * Export R3F-based 3D visualization components.
 * These should be lazy-loaded to keep the initial bundle small.
 *
 * Usage:
 * ```tsx
 * import { lazy } from 'react';
 * const R3FTestScene = lazy(() => import('./components/r3f').then(m => ({ default: m.R3FTestScene })));
 * ```
 */

export { R3FTestScene } from "./R3FTestSetup";
