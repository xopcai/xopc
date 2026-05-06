#!/usr/bin/env node
/**
 * Scans each extensions/<name>/package.json for `xopc.bundledChannel` and writes
 * src/generated/bundled-channel-plugins.ts (single module: re-exports +
 * bundledChannelPlugins array so tsc emits dist/extensions/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extensionsRoot = path.join(root, 'extensions');
const outPath = path.join(root, 'src/generated/bundled-channel-plugins.ts');

/** True if the extension declares a path that exists on disk (TypeScript sources often use .ts while imports use .js). */
function bundledChannelModuleExists(dir, moduleRel) {
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
    const bc = pkg.xopc?.bundledChannel;
    if (!bc || typeof bc.export !== 'string' || !bc.export.trim()) {
      continue;
    }
    const moduleRel = typeof bc.module === 'string' && bc.module.trim() ? bc.module.trim() : 'src/index.js';
    const moduleRelNorm = moduleRel.replace(/^\.\//, '');
    if (!bundledChannelModuleExists(dirent.name, moduleRelNorm)) {
      console.warn(
        `Skipping extensions/${dirent.name}: bundled channel entry file missing (${moduleRel}). ` +
          'Restore extension sources or remove xopc.bundledChannel from package.json.',
      );
      continue;
    }
    const order = typeof bc.order === 'number' && Number.isFinite(bc.order) ? bc.order : 0;
    entries.push({
      dir: dirent.name,
      exportName: bc.export.trim(),
      moduleRel: moduleRelNorm,
      order,
    });
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
  if (!rel.endsWith('.js')) {
    rel = `${rel}.js`;
  }
  return rel;
}

function buildSource(entries) {
  const header = `/**
 * Built-in channel plugins: sources under extensions/*, compiled to dist/extensions/*.
 * Regenerate: pnpm run generate:bundled-channels
 */

`;

  if (entries.length === 0) {
    return (
      header +
      `import type { ChannelPlugin } from '../channels/plugin-types.js';

export const bundledChannelPlugins: ChannelPlugin[] = [];
`
    );
  }

  const importLines = [
    `import type { ChannelPlugin } from '../channels/plugin-types.js';`,
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
    `export const bundledChannelPlugins: ChannelPlugin[] = [${names}];\n`
  );
}

const entries = readBundledEntries();
const source = buildSource(entries);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
// Remove accidental tsc/js emit siblings so imports of `bundled-channel-plugins.js` resolve to the .ts source.
const staleEmitBase = path.join(path.dirname(outPath), 'bundled-channel-plugins');
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
console.log('Wrote', path.relative(root, outPath), `(${entries.length} bundled channel(s))`);
