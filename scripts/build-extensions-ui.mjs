/**
 * Run `pnpm run build:ui` in every workspace under `extensions/*` that defines it in package.json.
 * Keeps root package.json free of per-extension UI build scripts.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const extensionsRoot = join(repoRoot, 'extensions');

if (!existsSync(extensionsRoot)) {
  console.log('build-extensions-ui: no extensions/ directory, skip');
  process.exit(0);
}

const dirs = readdirSync(extensionsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const targets = [];
for (const name of dirs) {
  const pkgPath = join(extensionsRoot, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    continue;
  }
  if (pkg.scripts && typeof pkg.scripts['build:ui'] === 'string') {
    targets.push(name);
  }
}

if (targets.length === 0) {
  console.log('build-extensions-ui: no extension package.json defines scripts.build:ui, skip');
  process.exit(0);
}

for (const name of targets) {
  const cwd = join(extensionsRoot, name);
  console.log(`\nbuild-extensions-ui: ${name} …`);
  execSync('pnpm run build:ui', { cwd, stdio: 'inherit', env: process.env });
}

console.log('\nbuild-extensions-ui: done');
