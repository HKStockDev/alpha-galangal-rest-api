const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findSpecs(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSpecs(full, files);
    } else if (entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

const srcDir = path.join(__dirname, '..', 'src');
const specs = findSpecs(srcDir).sort();

if (specs.length === 0) {
  console.error('No .spec.ts files found under src/');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...specs],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
