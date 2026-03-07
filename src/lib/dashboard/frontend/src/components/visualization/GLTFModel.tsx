/**
 * GLTFModel Component
 * Internal component that loads GLTF/GLB models using drei's useGLTF hook
 *
 * This component handles the actual loading of GLTF/GLB models and must be
 * wrapped in a Suspense boundary. The parent component (ModelLoader) handles
 * error boundaries and loading states.
 *
 * Features:
 * - Automatic texture-less model handling
 * - Material enhancement for models without embedded textures
 * - SkeletonUtils cloning for proper skeleton binding preservation (animations work!)
 * - Frustum culling disabled on skinned meshes to prevent disappearing
 *
 * @module components/visualization/GLTFModel
 */

import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";
import { SkeletonUtils, type GLTF } from "three-stdlib";

/** GroupProps type from React Three Fiber JSX elements */
type GroupProps = ThreeElements["group"];

export interface GLTFModelProps extends Omit<GroupProps, "children"> {
  /** Path to the GLTF/GLB model file */
  modelPath: string;
  /** Callback when model finishes loading */
  onLoaded?: (gltf: GLTF) => void;
  /** Callback when model fails to load (caught by error boundary) */
  onError?: (error: Error) => void;
  /** Enable enhanced rendering for texture-less models (default: true) */
  enhanceTexturelessMaterials?: boolean;
  /** Optimize textures to reduce GPU texture unit usage (default: true) */
  optimizeTextures?: boolean;
}

/**
 * Checks if a material has any textures assigned
 * @param material - The material to check
 * @returns true if the material has at least one texture
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
 * Simplify materials to reduce GPU texture unit usage
 *
 * WebGL has a limit of 16 texture units per draw call. Complex PBR materials
 * can use 6+ texture maps (baseColor, normal, roughness, metalness, AO, emissive).
 * This function removes non-essential texture maps to stay within GPU limits.
 *
 * ALWAYS simplifies materials unconditionally to prevent texture unit overflow
 * when multiple meshes/materials are rendered in the same scene.
 *
 * Keeps:
 * - map (base color) - essential for appearance
 * - emissiveMap - kept with reduced factor for self-illumination detail
 *
 * Removes:
 * - normalMap - surface detail (minor visual impact)
 * - roughnessMap, metalnessMap - uses flat values instead
 * - aoMap - ambient occlusion baked into lighting
 *
 * @param material - Material to simplify
 */
function simplifyMaterial(material: THREE.Material): void {
  if (material instanceof THREE.MeshStandardMaterial) {
    let modified = false;

    // Remove normal map
    if (material.normalMap) {
      material.normalMap = null;
      modified = true;
    }

    // Remove roughness map, use flat value
    if (material.roughnessMap) {
      material.roughness = 0.7;
      material.roughnessMap = null;
      modified = true;
    }

    // Remove metalness map, use flat value
    if (material.metalnessMap) {
      material.metalness = 0.1;
      material.metalnessMap = null;
      modified = true;
    }

    // Remove ambient occlusion map
    if (material.aoMap) {
      material.aoMap = null;
      material.aoMapIntensity = 0;
      modified = true;
    }

    // Keep emissive map but reduce emissive factor for subtle self-illumination
    // Models like yakub use emissiveMap (same image as baseColor) with emissiveFactor [1,1,1]
    // for self-illumination. Stripping it entirely makes subtle texture areas (like faces)
    // appear as featureless gray blobs. Instead, keep the map but reduce the factor.
    if (material.emissiveMap) {
      // Reduce emissive intensity to subtle self-illumination (prevents full white glow
      // while preserving per-pixel texture detail like facial features)
      const r = material.emissive.r;
      const g = material.emissive.g;
      const b = material.emissive.b;
      const maxChannel = Math.max(r, g, b);
      if (maxChannel > 0.2) {
        const scale = 0.15 / maxChannel;
        material.emissive.setRGB(r * scale, g * scale, b * scale);
        modified = true;
      }
    }

    // Clamp metalness to prevent dark/black appearance without environment map
    // GLTF spec defaults metallicFactor to 1.0 when unspecified, which makes
    // models appear black in scenes without cubemap reflections
    if (material.metalness > 0.5) {
      material.metalness = 0.1;
      modified = true;
    }

    // Ensure roughness is reasonable for diffuse lighting
    if (material.roughness < 0.3) {
      material.roughness = 0.6;
      modified = true;
    }

    if (modified) {
      material.needsUpdate = true;
    }
  }
}

/**
 * Optimize scene materials for GPU texture unit limits
 * Traverses scene and simplifies all materials unconditionally
 * @param scene - Scene to optimize
 */
function optimizeSceneTextures(scene: THREE.Object3D): void {
  let materialCount = 0;
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          simplifyMaterial(mat);
          materialCount++;
        });
      } else if (child.material) {
        simplifyMaterial(child.material);
        materialCount++;
      }
    }
  });
  void materialCount; // Used for optimization tracking
}

/**
 * Enhances a texture-less material to look more visually appealing
 * Applies better lighting response and enables vertex colors if available
 * @param material - The material to enhance
 * @param hasVertexColors - Whether the mesh has vertex colors
 */
function enhanceMaterial(
  material: THREE.Material,
  hasVertexColors: boolean = false
): void {
  if (material instanceof THREE.MeshStandardMaterial) {
    // If material has only a flat baseColorFactor (gray), enhance it
    if (!materialHasTextures(material)) {
      // Enable vertex colors if the mesh has them
      if (hasVertexColors) {
        material.vertexColors = true;
      }

      // Increase roughness for better diffuse lighting
      material.roughness = Math.max(material.roughness, 0.65);
      // Reduce metalness slightly for more natural look
      material.metalness = Math.min(material.metalness, 0.3);
      // Keep smooth shading for better appearance
      material.flatShading = false;
      // Ensure material receives proper lighting
      material.needsUpdate = true;
    }
  }
}

/**
 * Traverses a 3D scene and enhances all texture-less materials
 * Detects vertex colors and enables them if present
 * @param scene - The scene or object to traverse
 */
function enhanceTexturelessScene(scene: THREE.Object3D): void {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Check if geometry has vertex colors
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
 * GLTFModel loads and renders a GLTF/GLB model.
 *
 * Features:
 * - Uses drei's useGLTF hook for automatic caching
 * - Clones the scene to allow multiple instances
 * - Supports all Group props for positioning/scaling
 * - Static preload method for module-level preloading
 *
 * NOTE: This component MUST be wrapped in a Suspense boundary.
 * useGLTF suspends while loading the model.
 *
 * @example
 * // Basic usage (inside Suspense)
 * <Suspense fallback={<LoadingPlaceholder />}>
 *   <GLTFModel modelPath="/models/character.glb" />
 * </Suspense>
 *
 * @example
 * // With callbacks
 * <GLTFModel
 *   modelPath="/models/character.glb"
 *   onLoaded={(gltf) => console.log('Loaded!', gltf.animations)}
 *   position={[0, 0, 0]}
 *   scale={1.5}
 * />
 */
export function GLTFModel({
  modelPath,
  onLoaded,
  onError,
  enhanceTexturelessMaterials = true,
  optimizeTextures = true,
  ...groupProps
}: GLTFModelProps): JSX.Element {
  // onError is handled by ModelErrorBoundary, included in props for interface consistency
  void onError;
  // useGLTF hook - automatically cached by drei
  // Suspends component while loading
  const gltf = useGLTF(modelPath) as GLTF;

  // Clone the scene and enhance materials if needed
  // useMemo ensures we only clone/process once per gltf change
  const clonedScene = useMemo(() => {
    // Use SkeletonUtils.clone() to properly clone skinned meshes with skeleton bindings
    // Regular scene.clone(true) breaks skeleton bindings, causing animations to fail
    const scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;

    // Disable frustum culling on skinned meshes to prevent disappearing during animation
    scene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        (child as THREE.SkinnedMesh).frustumCulled = false;
      }
    });

    // Optimize textures to reduce GPU texture unit usage
    // This removes non-essential texture maps (roughness, metalness, AO, emissive)
    // to stay within WebGL's 16 texture unit limit per draw call
    if (optimizeTextures) {
      optimizeSceneTextures(scene);
    }

    // Enhance texture-less materials for better visual appearance
    if (enhanceTexturelessMaterials) {
      enhanceTexturelessScene(scene);
    }

    return scene;
  }, [gltf.scene, enhanceTexturelessMaterials, optimizeTextures]);

  // Notify parent when model is loaded
  // IMPORTANT: Pass a modified GLTF-like object with the CLONED scene
  // The AnimationMixer must be attached to the cloned scene (what's rendered),
  // not the original gltf.scene, otherwise animations won't affect the visible model
  useEffect(() => {
    if (gltf && onLoaded) {
      // Create a GLTF-like object with the cloned scene so animations attach correctly
      const gltfWithClonedScene = {
        ...gltf,
        scene: clonedScene,
      };
      onLoaded(gltfWithClonedScene as GLTF);
    }
  }, [gltf, clonedScene, onLoaded]);

  // Extract scale from groupProps and apply directly to the scene
  // This ensures the scale is applied at the scene root level
  const { scale: scaleValue, ...otherProps } = groupProps as {
    scale?: number | [number, number, number];
  } & typeof groupProps;

  // Apply scale to the cloned scene if provided
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
 * Static preload method for module-level preloading
 *
 * Call this in module scope or useEffect to preload models
 * before they're needed, improving perceived performance.
 *
 * @param path - Path to the GLTF/GLB model file
 *
 * @example
 * // Module-level preloading
 * GLTFModel.preload('/models/character.glb');
 *
 * @example
 * // Preload multiple models in useEffect
 * useEffect(() => {
 *   GLTFModel.preload('/models/character1.glb');
 *   GLTFModel.preload('/models/character2.glb');
 * }, []);
 */
GLTFModel.preload = (path: string): void => {
  useGLTF.preload(path);
};
