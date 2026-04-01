#!/usr/bin/env node
/**
 * Spawn electron-builder with env cleaned of *localhost* HTTP proxies.
 * Stale `HTTP_PROXY=http://127.0.0.1:7899` (Clash/V2Ray off) makes downloads fail with
 * "proxyconnect tcp: dial tcp 127.0.0.1:7899: connect: connection refused".
 * Set ELECTRON_BUILDER_KEEP_PROXY=1 to pass the parent environment through unchanged.
 *
 * Gateway server for packaged apps is pre-bundled to `out/server/index.js` by
 * `scripts/build-electron-server.mjs` (run via `pnpm run electron:server:build` before this step).
 * electron-builder packs the `out/` tree into the asar; it does not include raw `dist/` + node_modules.
 *
 * Extra CLI args (e.g. `--mac --x64 --arm64`) are forwarded for CI matrix builds.
 */

// Main
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const cli = require.resolve('electron-builder/cli.js');

const LOCAL_PROXY = /127\.0\.0\.1|localhost|\[::1\]/i;
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];

function shouldStripProxy(value) {
  return typeof value === 'string' && LOCAL_PROXY.test(value);
}

const env = { ...process.env };
if (process.env['ELECTRON_BUILDER_KEEP_PROXY'] !== '1') {
  for (const k of PROXY_KEYS) {
    if (shouldStripProxy(env[k])) delete env[k];
  }
}

const extra = process.argv.slice(2);
const hasPublishFlag = extra.some((a) => a === '--publish' || a.startsWith('--publish='));
const publishArgs =
  process.env['ELECTRON_PUBLISH'] === '1' || hasPublishFlag ? [] : ['--publish', 'never'];
const r = spawnSync(process.execPath, [cli, ...publishArgs, ...extra], { stdio: 'inherit', env, cwd: root });
process.exit(r.status ?? 1);
