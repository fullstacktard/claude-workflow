/**
 * useDisposalManager Hook
 *
 * Tracks and disposes Three.js resources (geometries, textures, materials)
 * to prevent GPU memory leaks during long dashboard sessions.
 *
 * Three.js resources are GPU-allocated and must be explicitly disposed via
 * `.dispose()`. Browser garbage collection does NOT clean up WebGL resources.
 * This hook provides a structured way to register resources and ensure they
 * are disposed when the owning component unmounts.
 *
 * @module hooks/useDisposalManager
 *
 * @example
 * ```tsx
 * function MyVisualization() {
 *   const { registerObject3D, dispose } = useDisposalManager();
 *
 *   return (
 *     <ModelLoader
 *       agentType="frontend-engineer"
 *       disposalManager={{ registerObject3D, dispose }}
 *       onLoaded={(model) => {
 *         if ('scene' in model) {
 *           registerObject3D(model.scene);
 *         }
 *       }}
 *     />
 *   );
 * }
 * ```
 */

import { useRef, useCallback, useEffect } from "react";
import * as THREE from "three";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported resource types for disposal tracking.
 * Covers all GPU-allocated Three.js resources that require explicit cleanup.
 */
export type DisposableResource =
  | THREE.BufferGeometry
  | THREE.Texture
  | THREE.Material;

/**
 * Return type of the useDisposalManager hook.
 * Provides registration, untracking, and disposal functions.
 */
export interface UseDisposalManagerResult {
  /** Register a BufferGeometry for disposal tracking */
  registerGeometry: (geometry: THREE.BufferGeometry) => void;
  /** Register a Texture for disposal tracking */
  registerTexture: (texture: THREE.Texture) => void;
  /** Register a Material for disposal tracking */
  registerMaterial: (material: THREE.Material) => void;
  /** Register any disposable resource (auto-detects type) */
  register: (resource: DisposableResource) => void;
  /** Remove a resource from tracking (useful when resource is replaced before unmount) */
  untrack: (resource: DisposableResource) => void;
  /** Manually dispose all tracked resources. Also called automatically on unmount. */
  dispose: () => void;
  /** Recursively register all geometries, materials, and textures from an Object3D tree */
  registerObject3D: (object: THREE.Object3D) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Whether to log disposal events (dev mode only) */
const DEV_MODE = process.env.NODE_ENV === "development";

// ============================================================================
// Texture extraction helpers
// ============================================================================

/**
 * Known texture map property names on Three.js materials.
 * These are the properties that may hold Texture references needing disposal.
 */
const TEXTURE_MAP_KEYS: readonly string[] = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "envMap",
  "lightMap",
  "bumpMap",
  "displacementMap",
  "specularMap",
  "gradientMap",
] as const;

/**
 * Extract all Texture instances from a material by checking known map properties.
 * Works with any material type (MeshStandardMaterial, MeshPhongMaterial, etc.)
 * without requiring explicit instanceof checks for each subtype.
 */
function extractTextures(material: THREE.Material): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  const mat = material as unknown as Record<string, unknown>;

  for (const key of TEXTURE_MAP_KEYS) {
    const value = mat[key];
    if (value instanceof THREE.Texture) {
      textures.push(value);
    }
  }

  return textures;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing Three.js resource disposal.
 *
 * Tracks geometries, textures, and materials using Sets for O(1) add/delete.
 * All tracked resources are disposed on component unmount to prevent GPU
 * memory leaks.
 *
 * Disposal order: materials first (they reference textures), then textures,
 * then geometries. This prevents errors from disposing a texture that a
 * material still references.
 *
 * @returns Functions for registering, untracking, and disposing resources
 */
export function useDisposalManager(): UseDisposalManagerResult {
  const geometriesRef = useRef<Set<THREE.BufferGeometry>>(new Set());
  const texturesRef = useRef<Set<THREE.Texture>>(new Set());
  const materialsRef = useRef<Set<THREE.Material>>(new Set());
  const isDisposedRef = useRef(false);

  const registerGeometry = useCallback(
    (geometry: THREE.BufferGeometry): void => {
      if (!isDisposedRef.current) {
        geometriesRef.current.add(geometry);
        if (DEV_MODE) {
          console.debug(
            "[DisposalManager] Registered geometry:",
            geometry.uuid
          );
        }
      }
    },
    []
  );

  const registerTexture = useCallback((texture: THREE.Texture): void => {
    if (!isDisposedRef.current) {
      texturesRef.current.add(texture);
      if (DEV_MODE) {
        console.debug("[DisposalManager] Registered texture:", texture.uuid);
      }
    }
  }, []);

  const registerMaterial = useCallback((material: THREE.Material): void => {
    if (!isDisposedRef.current) {
      materialsRef.current.add(material);
      if (DEV_MODE) {
        console.debug("[DisposalManager] Registered material:", material.uuid);
      }
    }
  }, []);

  const register = useCallback(
    (resource: DisposableResource): void => {
      if (resource instanceof THREE.BufferGeometry) {
        registerGeometry(resource);
      } else if (resource instanceof THREE.Texture) {
        registerTexture(resource);
      } else if (resource instanceof THREE.Material) {
        registerMaterial(resource);
      }
    },
    [registerGeometry, registerTexture, registerMaterial]
  );

  const untrack = useCallback((resource: DisposableResource): void => {
    if (resource instanceof THREE.BufferGeometry) {
      geometriesRef.current.delete(resource);
    } else if (resource instanceof THREE.Texture) {
      texturesRef.current.delete(resource);
    } else if (resource instanceof THREE.Material) {
      materialsRef.current.delete(resource);
    }
    if (DEV_MODE) {
      console.debug("[DisposalManager] Untracked resource:", resource.uuid);
    }
  }, []);

  const registerObject3D = useCallback(
    (object: THREE.Object3D): void => {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            registerGeometry(child.geometry);
          }

          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

          for (const mat of materials) {
            if (mat) {
              registerMaterial(mat);
              const textures = extractTextures(mat);
              for (const tex of textures) {
                registerTexture(tex);
              }
            }
          }
        }
      });

      if (DEV_MODE) {
        console.debug(
          "[DisposalManager] Registered Object3D tree -",
          `geometries: ${geometriesRef.current.size},`,
          `textures: ${texturesRef.current.size},`,
          `materials: ${materialsRef.current.size}`
        );
      }
    },
    [registerGeometry, registerMaterial, registerTexture]
  );

  const dispose = useCallback((): void => {
    if (isDisposedRef.current) return;
    isDisposedRef.current = true;

    const materialCount = materialsRef.current.size;
    const textureCount = texturesRef.current.size;
    const geometryCount = geometriesRef.current.size;

    // Dispose materials first (they may reference textures internally)
    materialsRef.current.forEach((material) => {
      try {
        material.dispose();
      } catch (err) {
        console.warn("[DisposalManager] Error disposing material:", err);
      }
    });
    materialsRef.current.clear();

    // Dispose textures second
    texturesRef.current.forEach((texture) => {
      try {
        texture.dispose();
      } catch (err) {
        console.warn("[DisposalManager] Error disposing texture:", err);
      }
    });
    texturesRef.current.clear();

    // Dispose geometries last
    geometriesRef.current.forEach((geometry) => {
      try {
        geometry.dispose();
      } catch (err) {
        console.warn("[DisposalManager] Error disposing geometry:", err);
      }
    });
    geometriesRef.current.clear();

    if (DEV_MODE) {
      if (materialCount > 0) {
        console.debug(
          `[DisposalManager] Disposed ${materialCount} material(s)`
        );
      }
      if (textureCount > 0) {
        console.debug(
          `[DisposalManager] Disposed ${textureCount} texture(s)`
        );
      }
      if (geometryCount > 0) {
        console.debug(
          `[DisposalManager] Disposed ${geometryCount} geometry(s)`
        );
      }
      console.debug(
        `[DisposalManager] Total disposed: ${materialCount + textureCount + geometryCount} resources`
      );
    }
  }, []);

  // Automatically dispose on unmount
  useEffect(() => {
    return (): void => {
      dispose();
    };
  }, [dispose]);

  return {
    registerGeometry,
    registerTexture,
    registerMaterial,
    register,
    untrack,
    dispose,
    registerObject3D,
  };
}

export default useDisposalManager;
