#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const logLevel = process.env.XOPCBOT_BUILD_VERBOSE === '1' ? 'info' : 'warn';
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

process.exit(result.status ?? 1);
