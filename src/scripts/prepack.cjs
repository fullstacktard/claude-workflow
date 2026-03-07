#!/usr/bin/env node
// Strip file: dependencies before npm pack to prevent global install issues.
// file: deps reference sibling packages in the monorepo which don't exist
// when installed globally, causing npm to fall back to the registry.
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Save backup for postpack restoration
fs.writeFileSync('package.json.bak', JSON.stringify(pkg, null, 2));

function stripFileDeps(deps) {
  if (!deps) return deps;
  return Object.fromEntries(
    Object.entries(deps).filter(([, v]) => !String(v).startsWith('file:'))
  );
}

pkg.dependencies = stripFileDeps(pkg.dependencies);
pkg.optionalDependencies = stripFileDeps(pkg.optionalDependencies);
pkg.devDependencies = stripFileDeps(pkg.devDependencies);

// Remove empty sections
if (pkg.optionalDependencies && Object.keys(pkg.optionalDependencies).length === 0) {
  delete pkg.optionalDependencies;
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('prepack: stripped file: dependencies for clean packaging');

// ---------------------------------------------------------------------------
// Remove large/sensitive files from dist/ before packing
// ---------------------------------------------------------------------------
const path = require('path');
const frontendDir = path.join('dist', 'lib', 'dashboard', 'frontend');

function rmGlob(dir, extensions, dirNames) {
  if (!fs.existsSync(dir)) return;
  let removed = 0;

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (dirNames && dirNames.includes(entry.name)) {
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
          continue;
        }
        walk(full);
      } else if (extensions && extensions.some(ext => entry.name.endsWith(ext))) {
        fs.unlinkSync(full);
        removed++;
      }
    }
  }
  walk(dir);
  return removed;
}

// Remove 3D models, media, source maps, and dev artifacts
const extsToRemove = ['.glb', '.fbx', '.gltf', '.bin', '.mp3', '.wav', '.ogg', '.js.map'];
const dirsToRemove = ['.claude', '.serena', 'models', 'textures', 'audio', 'src'];

if (fs.existsSync(frontendDir)) {
  const count = rmGlob(frontendDir, extsToRemove, dirsToRemove);
  console.log(`prepack: removed ${count} large/dev files from dashboard frontend`);
}
