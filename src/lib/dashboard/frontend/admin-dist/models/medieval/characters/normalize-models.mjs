/**
 * Normalize GLTF/GLB models to consistent scale and position
 * Uses gltf-transform to center models at origin and scale to 2 units tall
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_HEIGHT = 2.0; // 2 meters tall

// Initialize decoders/encoders
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

async function getBounds(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;

    const worldMatrix = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;

      const data = position.getArray();
      for (let i = 0; i < data.length; i += 3) {
        const x = data[i], y = data[i + 1], z = data[i + 2];
        // Apply world transform (simplified - just using scale and translation)
        const tx = worldMatrix[12], ty = worldMatrix[13], tz = worldMatrix[14];
        const sx = Math.sqrt(worldMatrix[0] ** 2 + worldMatrix[1] ** 2 + worldMatrix[2] ** 2);
        const sy = Math.sqrt(worldMatrix[4] ** 2 + worldMatrix[5] ** 2 + worldMatrix[6] ** 2);
        const sz = Math.sqrt(worldMatrix[8] ** 2 + worldMatrix[9] ** 2 + worldMatrix[10] ** 2);

        const wx = x * sx + tx;
        const wy = y * sy + ty;
        const wz = z * sz + tz;

        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        minZ = Math.min(minZ, wz);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
        maxZ = Math.max(maxZ, wz);
      }
    }
  });

  if (minX === Infinity) return null;

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ]
  };
}

async function normalizeModel(inputPath, outputPath) {
  console.log(`Processing: ${basename(inputPath)}`);

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder
    });

  try {
    const doc = await io.read(inputPath);
    const bounds = await getBounds(doc);

    if (!bounds) {
      console.log(`  Skipping: No geometry found`);
      return false;
    }

    const currentHeight = bounds.size[1];
    const scale = TARGET_HEIGHT / currentHeight;

    console.log(`  Current height: ${currentHeight.toFixed(3)} units`);
    console.log(`  Applying scale: ${scale.toFixed(6)}`);
    console.log(`  Center offset: [${bounds.center.map(v => v.toFixed(3)).join(', ')}]`);

    // Apply transforms to root nodes
    const root = doc.getRoot();
    const scene = root.listScenes()[0];

    for (const node of scene.listChildren()) {
      const currentScale = node.getScale();
      const currentTranslation = node.getTranslation();

      // Scale uniformly
      node.setScale([
        currentScale[0] * scale,
        currentScale[1] * scale,
        currentScale[2] * scale
      ]);

      // Offset to center at origin (scale the offset too)
      node.setTranslation([
        currentTranslation[0] * scale - bounds.center[0] * scale,
        currentTranslation[1] * scale - bounds.center[1] * scale + TARGET_HEIGHT / 2,
        currentTranslation[2] * scale - bounds.center[2] * scale
      ]);
    }

    // Write output
    await io.write(outputPath, doc);
    console.log(`  Output: ${basename(outputPath)}\n`);
    return true;
  } catch (err) {
    console.error(`  Error: ${err.message}\n`);
    return false;
  }
}

async function main() {
  const files = await glob('*.glb', { cwd: __dirname });
  console.log(`Found ${files.length} GLB files\n`);

  let processed = 0;
  for (const file of files) {
    const input = join(__dirname, file);
    const output = join(__dirname, 'normalized', file);
    if (await normalizeModel(input, output)) {
      processed++;
    }
  }

  console.log(`\nProcessed ${processed}/${files.length} models`);
}

main().catch(console.error);
