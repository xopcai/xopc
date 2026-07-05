#!/usr/bin/env node
/**
 * Scans each extensions/<name>/package.json for `xopc.bundledImageGenerationProvider`
 * or `xopc.bundledImageGenerationProviders`
 * and writes src/generated/bundled-image-generation-providers.ts (a single
 * module exporting `bundledImageGenerationProviderBuilders` so the runtime
 * can register every provider in one pass).
 *
 * Mirrors the extension-manifest driven bundled discovery layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extensionsRoot = path.join(root, 'extensions');
const outPath = path.join(root, 'src/generated/bundled-image-generation-providers.ts');

/** True if the extension declares a path that exists on disk (TS sources often use .ts while imports use .js). */
function bundledModuleExists(dir, moduleRel) {
  const rel = moduleRel.replace(/^\.\//, '');
  const abs = path.join(extensionsRoot, dir, rel);
  if (fs.existsSync(abs)) {
    return true;
  }
  if (rel.endsWith('.js')) {
    const stem = abs.slice(0, -'.js'.length);
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
      if (fs.existsSync(stem + ext)) {
        return true;
      }
    }
  } else if (!/\.[cm]?[jt]sx?$/i.test(path.basename(rel))) {
    for (const ext of ['.ts', '.tsx', '.js', '.mts', '.cts']) {
      if (fs.existsSync(abs + ext)) {
        return true;
      }
    }
  }
  return false;
}

function readBundledEntries() {
  const entries = [];
  if (!fs.existsSync(extensionsRoot)) {
    return entries;
  }
  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) {
      continue;
    }
    const pkgPath = path.join(extensionsRoot, dirent.name, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      console.warn('Skipping invalid JSON:', pkgPath);
      continue;
    }
    const bundled = pkg.xopc?.bundledImageGenerationProviders ?? pkg.xopc?.bundledImageGenerationProvider;
    const providers = Array.isArray(bundled) ? bundled : bundled ? [bundled] : [];
    if (providers.length === 0) {
      continue;
    }
    for (const bp of providers) {
      if (!bp || typeof bp.export !== 'string' || !bp.export.trim()) {
        continue;
      }
      const moduleRel = typeof bp.module === 'string' && bp.module.trim() ? bp.module.trim() : 'src/index.js';
      const moduleRelNorm = moduleRel.replace(/^\.\//, '');
      if (!bundledModuleExists(dirent.name, moduleRelNorm)) {
        console.warn(
          `Skipping extensions/${dirent.name}: bundled image-generation provider entry file missing (${moduleRel}). ` +
            'Restore extension sources or remove xopc bundled image provider metadata from package.json.',
        );
        continue;
      }
      const order = typeof bp.order === 'number' && Number.isFinite(bp.order) ? bp.order : 0;
      entries.push({
        dir: dirent.name,
        exportName: bp.export.trim(),
        moduleRel: moduleRelNorm,
        order,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.dir.localeCompare(b.dir);
  });
  return entries;
}

function importPathFromGeneratedToExtension(dir, moduleRel) {
  const fromAbs = path.join(root, 'src', 'generated');
  const toAbs = path.join(root, 'extensions', dir, moduleRel);
  let rel = path.relative(fromAbs, toAbs).replace(/\\/g, '/');
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  // Normalise .ts → .js so the emitted import survives both ESM resolution and tsc.
  rel = rel.replace(/\.tsx?$/i, '.js');
  if (!/\.[cm]?jsx?$/i.test(rel)) {
    rel = `${rel}.js`;
  }
  return rel;
}

function buildSource(entries) {
  const header = `/**
 * Built-in image-generation providers: sources under extensions/*, compiled to dist/extensions/*.
 * Regenerate: pnpm run generate:bundled-image-providers
 */

`;

  if (entries.length === 0) {
    return (
      header +
      `import type { ImageGenerationProviderFactory } from '../agent/image/generation/bundled-registry.js';

export const bundledImageGenerationProviderBuilders: ImageGenerationProviderFactory[] = [];
`
    );
  }

  const importLines = [
    `import type { ImageGenerationProviderFactory } from '../agent/image/generation/bundled-registry.js';`,
    ...entries.map((e) => {
      const spec = importPathFromGeneratedToExtension(e.dir, e.moduleRel);
      return `import { ${e.exportName} } from '${spec}';`;
    }),
  ];

  const names = entries.map((e) => e.exportName).join(', ');

  return (
    header +
    importLines.join('\n') +
    '\n\n' +
    `export { ${names} };\n` +
    `export const bundledImageGenerationProviderBuilders: ImageGenerationProviderFactory[] = [${names}];\n`
  );
}

const entries = readBundledEntries();
const source = buildSource(entries);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
// Remove accidental tsc/js emit siblings so imports of `bundled-image-generation-providers.js` resolve to the .ts source.
const staleEmitBase = path.join(path.dirname(outPath), 'bundled-image-generation-providers');
for (const ext of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
  try {
    fs.unlinkSync(staleEmitBase + ext);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err;
    }
  }
}
fs.writeFileSync(outPath, source, 'utf8');
console.log('Wrote', path.relative(root, outPath), `(${entries.length} bundled image-generation provider(s))`);
