#!/usr/bin/env node
/**
 * CLI entry: log-level preset must run before any module that initializes the logger.
 * (Bundlers may reorder imports in `index.ts`; this file stays dependency-minimal.)
 */
import './cli-log-level-preset.js';
import '../infra/http-proxy-env.js';

import pkg from '../../package.json' with { type: 'json' };
import { ensureXopcCliOnPath } from '../infra/path-env.js';
import { formatRootHelp } from './command-manifest.js';

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

const { tryRunGatewayRunFastPath } = await import('./gateway-run-fast-path.js');
if (await tryRunGatewayRunFastPath(filteredArgv)) {
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
}

const { runCli } = await import('./index.js');
await runCli(process.argv);
