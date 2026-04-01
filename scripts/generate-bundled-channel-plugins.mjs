#!/usr/bin/env node
/**
 * Scans each extensions/<name>/package.json for `xopcbot.bundledChannel` and writes
 * src/generated/bundled-channel-plugins.ts (OpenClaw-style single module: re-exports +
 * bundledChannelPlugins array so tsc emits dist/extensions/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extensionsRoot = path.join(root, 'extensions');
const outPath = path.join(root, 'src/generated/bundled-channel-plugins.ts');

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
    const bc = pkg.xopcbot?.bundledChannel;
    if (!bc || typeof bc.export !== 'string' || !bc.export.trim()) {
      continue;
    }
    const moduleRel = typeof bc.module === 'string' && bc.module.trim() ? bc.module.trim() : 'src/index.js';
    const order = typeof bc.order === 'number' && Number.isFinite(bc.order) ? bc.order : 0;
    entries.push({
      dir: dirent.name,
      exportName: bc.export.trim(),
      moduleRel: moduleRel.replace(/^\.\//, ''),
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
fs.writeFileSync(outPath, source, 'utf8');
console.log('Wrote', path.relative(root, outPath), `(${entries.length} bundled channel(s))`);
