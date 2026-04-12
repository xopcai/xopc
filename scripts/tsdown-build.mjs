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

process.exit(0);
