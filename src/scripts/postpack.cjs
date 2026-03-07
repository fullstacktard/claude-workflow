#!/usr/bin/env node
// Restore original package.json after npm pack
// NOTE: prepack removes large files from dist/lib/dashboard/frontend/
//       Run `npm run build` to restore them if needed for local dev.
const fs = require('fs');
if (fs.existsSync('package.json.bak')) {
  fs.copyFileSync('package.json.bak', 'package.json');
  fs.unlinkSync('package.json.bak');
  console.log('postpack: restored original package.json');
  console.log('postpack: NOTE - run `npm run build` to restore dashboard frontend assets');
}
