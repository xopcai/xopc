#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
const srcTpl = join(root, 'src/agent/context/workspace-templates');
const distTpl = join(root, 'dist/src/agent/context/workspace-templates');
if (existsSync(srcTpl)) {
  mkdirSync(dirname(distTpl), { recursive: true });
  cpSync(srcTpl, distTpl, { recursive: true });
}

// Bundled extension manifests: `extensions/*/xopc.extension.json` → `dist/extensions/<id>/xopc.extension.json`
// (tsdown emits `dist/extensions/<id>/src/**` but does not copy JSON assets)
const extensionsRoot = join(root, 'extensions');
const distExtensionsRoot = join(root, 'dist/extensions');
for (const extId of ['telegram', 'weixin', 'feishu', 'dingtalk']) {
  const srcManifest = join(extensionsRoot, extId, 'xopc.extension.json');
  const destDir = join(distExtensionsRoot, extId);
  const destManifest = join(destDir, 'xopc.extension.json');
  if (existsSync(srcManifest) && existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
    cpSync(srcManifest, destManifest);
  }
}

process.exit(0);
