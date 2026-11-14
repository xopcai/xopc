#!/usr/bin/env node
/**
 * CLI entry: log-level preset must run before any module that initializes the logger.
 * (Bundlers may reorder imports in `index.ts`; this file stays dependency-minimal.)
 */
import './cli-log-level-preset.js';

import { enableCompileCache } from 'node:module';
import { existsSync } from 'node:fs';
import pkg from '../../package.json' with { type: 'json' };
import { ensureXopcCliOnPath } from '../infra/path-env.js';
import { formatRootHelp } from './command-manifest.js';
import { isGatewayRunFastPathArgv } from './gateway-run-argv.js';

ensureXopcCliOnPath();

function printRootHelp(): void {
  console.log(formatRootHelp());
}

const rootArgs = process.argv.slice(2).filter((arg) => arg !== '--');
if (rootArgs.length === 1 && (rootArgs[0] === '--version' || rootArgs[0] === '-V')) {
  console.log(pkg.version);
  process.exit(0);
}
if (rootArgs.length === 1 && (rootArgs[0] === '--help' || rootArgs[0] === '-h' || rootArgs[0] === 'help')) {
  printRootHelp();
  process.exit(0);
}

const filteredArgv = process.argv.filter((arg, index) => {
  if (arg !== '--') return true;
  return index < 2;
});

const foregroundGateway = isGatewayRunFastPathArgv(filteredArgv);
const bundles = new URL('../../gateway/server/', import.meta.url);
if (foregroundGateway && existsSync(new URL('chunks.json', bundles))) {
  const { runGatewayBundle } = await import('./gateway-bundle-loader.js');
  if (await runGatewayBundle(bundles, filteredArgv)) {
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }
}
if (foregroundGateway) enableCompileCache();
await import('../infra/http-proxy-env.js');
if (foregroundGateway) {
  const { tryRunGatewayRunFastPath } = await import('./gateway-run-fast-path.js');
  if (await tryRunGatewayRunFastPath(filteredArgv)) {
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }
}

const { runCli } = await import('./index.js');
await runCli(process.argv);
