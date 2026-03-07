/**
 * R3F Test Setup Component
 *
 * This component verifies that React Three Fiber and its dependencies
 * are correctly installed and configured with TypeScript.
 *
 * This file can be safely deleted once 3D visualization features are implemented.
 */

import * as THREE from "three";
import { useRef, useState } from "react";
import { Canvas, useFrame, ThreeElements } from "@react-three/fiber";
import { OrbitControls, Box, Text } from "@react-three/drei";

/**
 * Animated box component demonstrating R3F hooks and TypeScript integration.
 * Uses ThreeElements['mesh'] type for proper TypeScript support.
 */
function AnimatedBox(props: ThreeElements["mesh"]) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  // useFrame hook for animation - runs every frame
  useFrame((_state, delta) => {
    meshRef.current.rotation.x += delta * 0.5;
    meshRef.current.rotation.y += delta * 0.3;
  });

  return (
    <mesh
      {...props}
      ref={meshRef}
      scale={active ? 1.5 : 1}
      onClick={() => setActive(!active)}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
    </mesh>
  );
}

/**
 * Test scene component for verifying R3F setup.
 *
 * Features demonstrated:
 * - Canvas setup with camera configuration
 * - OrbitControls from @react-three/drei
 * - Lighting setup
 * - Custom animated mesh with TypeScript types
 * - Text rendering from drei
 */
export function R3FTestScene() {
  return (
    <div className="w-full h-[400px] bg-gray-900 rounded-lg overflow-hidden">
      <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <spotLight
          position={[-10, 10, -10]}
          angle={0.15}
          penumbra={1}
          intensity={0.5}
        />

        {/* Orbit controls for camera manipulation */}
        <OrbitControls enableZoom={true} enablePan={true} enableRotate={true} />

        {/* Test objects */}
        <AnimatedBox position={[-1.5, 0, 0]} />
        <Box position={[1.5, 0, 0]} args={[1, 1, 1]}>
          <meshStandardMaterial color="cyan" />
        </Box>

        {/* Text from drei */}
        <Text
          position={[0, 2, 0]}
          fontSize={0.3}
          color="white"
          anchorX="center"
          anchorY="middle"
        >
          R3F Setup Verified
        </Text>

        {/* Grid helper for orientation */}
        <gridHelper args={[10, 10]} />
      </Canvas>
    </div>
  );
}

export default R3FTestScene;
