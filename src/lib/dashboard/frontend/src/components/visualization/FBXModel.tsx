/**
 * FBXModel Component
 * Internal component that loads FBX models using three.js FBXLoader
 *
 * This component handles the actual loading of FBX models and must be
 * wrapped in a Suspense boundary. The parent component (ModelLoader) handles
 * error boundaries and loading states.
 *
 * @module components/visualization/FBXModel
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { ThreeElements } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { SkeletonUtils } from "three-stdlib";

/** GroupProps type from React Three Fiber JSX elements */
type GroupProps = ThreeElements["group"];

export interface FBXModelProps extends Omit<GroupProps, "children"> {
  /** Path to the FBX model file */
  modelPath: string;
  /** Callback when model finishes loading */
  onLoaded?: (group: THREE.Group) => void;
  /** Callback when model fails to load */
  onError?: (error: Error) => void;
  /** Enable enhanced rendering for texture-less models (default: true) */
  enhanceTexturelessMaterials?: boolean;
}

// Cache for loaded FBX models
const fbxCache = new Map<string, THREE.Group>();
// Track loading promises to prevent duplicate loads
const loadingPromises = new Map<string, Promise<THREE.Group>>();

/**
 * Checks if a material has any textures assigned
 */
function materialHasTextures(material: THREE.Material): boolean {
  if (material instanceof THREE.MeshStandardMaterial) {
    return !!(
      material.map ||
      material.normalMap ||
      material.roughnessMap ||
      material.metalnessMap ||
      material.aoMap ||
      material.emissiveMap
    );
  }
  if (material instanceof THREE.MeshBasicMaterial) {
    return !!material.map;
  }
  if (material instanceof THREE.MeshPhongMaterial) {
    return !!(material.map || material.normalMap);
  }
  return false;
}

/**
 * Enhances a texture-less material to look more visually appealing
 */
function enhanceMaterial(
  material: THREE.Material,
  hasVertexColors: boolean = false
): void {
  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhongMaterial
  ) {
    if (!materialHasTextures(material)) {
      if (hasVertexColors) {
        material.vertexColors = true;
      }

      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = Math.max(material.roughness, 0.65);
        material.metalness = Math.min(material.metalness, 0.3);
      }

      material.flatShading = false;
      material.needsUpdate = true;
    }
  }
}

/**
 * Traverses a 3D scene and enhances all texture-less materials
 */
function enhanceTexturelessScene(scene: THREE.Object3D): void {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const hasVertexColors = !!(
        child.geometry &&
        child.geometry.attributes &&
        child.geometry.attributes.color
      );

      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => enhanceMaterial(mat, hasVertexColors));
      } else if (child.material) {
        enhanceMaterial(child.material, hasVertexColors);
      }
    }
  });
}

/**
 * Load an FBX model with caching
 */
async function loadFBX(path: string): Promise<THREE.Group> {
  // Return cached model if available
  if (fbxCache.has(path)) {
    return fbxCache.get(path)!;
  }

  // Return existing loading promise if in progress
  if (loadingPromises.has(path)) {
    return loadingPromises.get(path)!;
  }

  // Create new loading promise
  const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
    const loader = new FBXLoader();
    loader.load(
      path,
      (fbx) => {
        fbxCache.set(path, fbx);
        loadingPromises.delete(path);
        resolve(fbx);
      },
      undefined,
      (error) => {
        loadingPromises.delete(path);
        reject(error);
      }
    );
  });

  loadingPromises.set(path, loadPromise);
  return loadPromise;
}

/**
 * Custom hook to load FBX models with Suspense support
 */
function useFBX(path: string): THREE.Group {
  const [, forceUpdate] = useState({});

  // Check cache synchronously
  if (fbxCache.has(path)) {
    return fbxCache.get(path)!;
  }

  // If not cached, throw a promise to trigger Suspense
  throw loadFBX(path).then(() => forceUpdate({}));
}

/**
 * FBXModel loads and renders an FBX model.
 *
 * NOTE: This component MUST be wrapped in a Suspense boundary.
 */
export function FBXModel({
  modelPath,
  onLoaded,
  onError,
  enhanceTexturelessMaterials = true,
  ...groupProps
}: FBXModelProps): JSX.Element {
  void onError; // Handled by error boundary
  const { scene: threeScene } = useThree();
  void threeScene;

  // Load FBX with Suspense support
  const fbx = useFBX(modelPath);

  // Clone the scene and enhance materials if needed
  const clonedScene = useMemo(() => {
    // Use SkeletonUtils.clone() to properly clone skinned meshes with skeleton bindings
    // Regular fbx.clone(true) breaks skeleton bindings, causing animations to fail
    const scene = SkeletonUtils.clone(fbx) as THREE.Group;

    // Disable frustum culling on skinned meshes to prevent disappearing during animation
    scene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        (child as THREE.SkinnedMesh).frustumCulled = false;
      }
    });

    if (enhanceTexturelessMaterials) {
      enhanceTexturelessScene(scene);
    }

    return scene;
  }, [fbx, enhanceTexturelessMaterials]);

  // Notify parent when model is loaded
  // IMPORTANT: Pass the CLONED scene, not the original fbx
  // The AnimationMixer must be attached to the cloned scene (what's rendered),
  // not the original fbx, otherwise animations won't affect the visible model
  useEffect(() => {
    if (clonedScene && onLoaded) {
      onLoaded(clonedScene);
    }
  }, [clonedScene, onLoaded]);

  // Extract scale from groupProps
  const { scale: scaleValue, ...otherProps } = groupProps as {
    scale?: number | [number, number, number];
  } & typeof groupProps;

  // Apply scale to the cloned scene
  if (scaleValue !== undefined) {
    if (typeof scaleValue === "number") {
      clonedScene.scale.set(scaleValue, scaleValue, scaleValue);
    } else if (Array.isArray(scaleValue)) {
      clonedScene.scale.set(scaleValue[0], scaleValue[1], scaleValue[2]);
    }
  }

  return (
    <group {...otherProps}>
      <primitive object={clonedScene} />
    </group>
  );
}

/**
 * Static preload method for FBX models
 */
FBXModel.preload = (path: string): void => {
  loadFBX(path).catch((err) => {
    console.warn(`[FBXModel] Failed to preload ${path}:`, err);
  });
};
