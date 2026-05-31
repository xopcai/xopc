#!/usr/bin/env node
/**
 * Spawn electron-builder with env cleaned of *localhost* HTTP proxies.
 * Stale `HTTP_PROXY=http://127.0.0.1:7899` (Clash/V2Ray off) makes downloads fail with
 * "proxyconnect tcp: dial tcp 127.0.0.1:7899: connect: connection refused".
 * Set ELECTRON_BUILDER_KEEP_PROXY=1 to pass the parent environment through unchanged.
 *
 * Packaging flow:
 * 1. prepare-electron-pack-dir.mjs — stage an isolated pack dir under os.tmpdir() with
 *    app files + a real `pnpm install --ignore-workspace --prod`. Pack dir lives outside
 *    the repo so electron-builder's `pnpm --workspace-root` lookup returns nothing and
 *    the dep collector stays scoped to pack dir.
 * 2. electron-builder --project <packDir> with beforeBuild=false — no auto node_modules
 *    from monorepo root.
 * 3. verify-electron-asar-deps.mjs — fail if asar node_modules exceeds budget.
 *
 * Extra CLI args (e.g. `--mac --x64 --arm64`) are forwarded for CI matrix builds.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareElectronPackDir } from './prepare-electron-pack-dir.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const requireRoot = createRequire(join(root, 'package.json'));
const cli = requireRoot.resolve('electron-builder/cli.js');
const packConfig = join(root, 'scripts/electron-builder.pack.yml');

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

// Pack dir uses ${env.XOPC_ELECTRON_RELEASE_OUTPUT} for `directories.output` so artifacts
// land under repo's dist/release even though the pack dir is in os.tmpdir().
env.XOPC_ELECTRON_RELEASE_OUTPUT = join(root, 'dist/release');

const extra = process.argv.slice(2);
const hasPublishFlag = extra.some((a) => a === '--publish' || a.startsWith('--publish='));
const publishArgs =
  process.env['ELECTRON_PUBLISH'] === '1' || hasPublishFlag ? [] : ['--publish', 'never'];

const packDir = prepareElectronPackDir(root);

const r = spawnSync(
  process.execPath,
  [cli, '--project', packDir, '--config', packConfig, ...publishArgs, ...extra],
  { stdio: 'inherit', env, cwd: packDir },
);
const exitCode = r.status ?? 1;

if (exitCode === 0 && process.env['XOPC_ELECTRON_SKIP_ASAR_VERIFY'] !== '1') {
  const verify = spawnSync(process.execPath, ['scripts/verify-electron-asar-deps.mjs'], {
    stdio: 'inherit',
    cwd: root,
  });
  if ((verify.status ?? 1) !== 0) {
    process.exit(verify.status ?? 1);
  }
}

process.exit(exitCode);
