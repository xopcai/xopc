#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const logLevel = process.env.XOPC_BUILD_VERBOSE === '1' ? 'info' : 'warn';
const extraArgs = process.argv.slice(2);

const result = spawnSync(
  'pnpm',
  ['exec', 'tsdown', '--config-loader', 'unrun', '--logLevel', logLevel, ...extraArgs],
  {
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

const code = result.status ?? 1;
if (code !== 0) {
  process.exit(code);
}

// Bundled Markdown workspace templates (used by workspace-seed.ts at runtime)
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// SQLite schema DDL files (loaded at runtime via readFileSync next to compiled schema.js)
const schemaSrc = join(root, 'src/storage/sqlite');
const schemaDist = join(root, 'dist/src/storage/sqlite');
cpSync(join(schemaSrc, 'schema.sql'), join(schemaDist, 'schema.sql'));
if (existsSync(join(schemaSrc, 'migrations'))) {
  cpSync(join(schemaSrc, 'migrations'), join(schemaDist, 'migrations'), { recursive: true });
}

const srcTpl = join(root, 'src/agent/context/workspace-templates');
const distTpl = join(root, 'dist/src/agent/context/workspace-templates');
if (existsSync(srcTpl)) {
  mkdirSync(dirname(distTpl), { recursive: true });
  cpSync(srcTpl, distTpl, { recursive: true });
}

// Bundled Chrome extension bridge (packages/browser-ext → dist/browser-ext/)
const browserExtPkg = join(root, 'packages/browser-ext');
const browserExtDist = join(root, 'dist/browser-ext');
const browserExtRequired = [
  'manifest.json',
  'popup.html',
  'dist/background.js',
  'dist/content.js',
  'dist/popup.js',
];

function validateBrowserExtLayout(dir) {
  return browserExtRequired.every((rel) => existsSync(join(dir, rel)));
}

const buildBrowserExt = spawnSync('pnpm', ['-C', 'packages/browser-ext', 'run', 'build'], {
  encoding: 'utf8',
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if ((buildBrowserExt.status ?? 1) !== 0) {
  process.exit(buildBrowserExt.status ?? 1);
}

if (!validateBrowserExtLayout(browserExtPkg)) {
  console.error('packages/browser-ext build incomplete. Missing required files.');
  process.exit(1);
}

mkdirSync(browserExtDist, { recursive: true });
for (const name of ['manifest.json', 'popup.html']) {
  cpSync(join(browserExtPkg, name), join(browserExtDist, name));
}
cpSync(join(browserExtPkg, 'dist'), join(browserExtDist, 'dist'), { recursive: true });
cpSync(join(browserExtPkg, 'icons'), join(browserExtDist, 'icons'), { recursive: true });

if (!validateBrowserExtLayout(browserExtDist)) {
  console.error('dist/browser-ext copy incomplete.');
  process.exit(1);
}

// Bundled extension manifests: `extensions/*/xopc.extension.json` → `dist/extensions/<id>/xopc.extension.json`
// (tsdown emits `dist/extensions/<id>/src/**` but does not copy JSON assets). Copy for every built
// extension dir so Apps / discoverExtensions parity matches dev (not only the four channel plugins).
const extensionsRoot = join(root, 'extensions');
const distExtensionsRoot = join(root, 'dist/extensions');
if (existsSync(extensionsRoot) && existsSync(distExtensionsRoot)) {
  for (const dirent of readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const extId = dirent.name;
    const srcManifest = join(extensionsRoot, extId, 'xopc.extension.json');
    const destDir = join(distExtensionsRoot, extId);
    const destManifest = join(destDir, 'xopc.extension.json');
    if (existsSync(srcManifest) && existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
      cpSync(srcManifest, destManifest);
    }
  }
}

process.exit(0);
