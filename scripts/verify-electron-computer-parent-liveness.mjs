import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';
import { _electron } from 'playwright-core';

import { createAcceptanceOutput, localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, macPackagedTarget } from './electron-packaged-acceptance.mjs';

const appIndex = process.argv.indexOf('--app');
assert(appIndex >= 0 && process.argv[appIndex + 1], 'Expected --app <installed native acceptance app>');
const target = await macPackagedTarget(process.argv[appIndex + 1]);
const electronBundle = join(electron, '../../Info.plist');
const bundleId = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', electronBundle], { encoding: 'utf8' }).trim();
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/computer-parent-liveness.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-computer-parent-'));
const report = { passed: false, startedAt: new Date().toISOString(), scope: 'Development Electron host with packaged Computer SDK/driver: parent SIGKILL precondition only; not installed-app or remote Computer acceptance' };
let app, daemon, child;
let cleanupLayout;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  const config = join(state, 'xopc.json'), workspace = join(state, 'workspace');
  await mkdir(workspace);
  await writeFile(config, '{}');
  const env = localConnectionEnvironment(process.env, process.cwd(), state, config, workspace);
  delete env.ELECTRON_RUN_AS_NODE;
  cleanupLayout = await prepareLocalConnectionLayout(process.cwd());
  app = await _electron.launch({ executablePath: electron, args: [join(process.cwd(), 'out/main/index.js'), '--gateway-connections'], env, cwd: state, timeout: 30_000 });
  child = app.process();
  const parent = child.pid;
  daemon = await withTimeout(app.evaluate(async ({ systemPreferences }, { hostBundleId, resources }) => {
    if (!systemPreferences.isTrustedAccessibilityClient(false) || systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      throw new Error('COMPUTER_NATIVE_PERMISSIONS_REQUIRED');
    }
    const path = process.getBuiltinModule('path');
    const require = process.getBuiltinModule('module').createRequire(path.join(resources, 'acceptance.cjs'));
    const sdk = require(path.join(resources, 'app.asar.unpacked/node_modules/@trycua/cua-driver/dist/index.js'));
    const host = new sdk.EmbeddedCuaDriverHost(path.join(resources, 'bin/cua-driver'), hostBundleId);
    globalThis.__computerParentLivenessAcceptanceHost = host;
    const connection = await host.start();
    return { pid: connection.pid, generationPresent: Boolean(connection.generation) };
  }, { hostBundleId: bundleId, resources: target.resources }), 30_000, 'Private Computer daemon startup exceeded 30 seconds');
  assert(Number.isSafeInteger(daemon.pid) && daemon.pid > 1 && daemon.pid !== parent && daemon.generationPresent);
  const row = execFileSync('ps', ['-p', String(daemon.pid), '-o', 'ppid=,comm='], { encoding: 'utf8' }).trim();
  assert.match(row, /cua-driver$/);
  assert.equal(Number(row.split(/\s+/)[0]), parent, 'Daemon must belong directly to the test Electron process');
  const parentExit = once(child, 'exit');
  const started = performance.now();
  child.kill('SIGKILL');
  await withTimeout(parentExit, 5000, 'Test Electron parent did not exit');
  while (alive(daemon.pid) && performance.now() - started < 3000) await delay(25);
  assert.equal(alive(daemon.pid), false, 'Private daemon survived parent death beyond the existing three-second stop budget');
  report.parentKilled = true;
  report.daemonExited = true;
  report.stopElapsedMs = performance.now() - started;
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack ?? error);
  report.failureStateDirectory = state;
  if (daemon) report.daemonStillPresent = alive(daemon.pid);
  process.exitCode = 1;
} finally {
  if (app && child?.exitCode === null && child.signalCode === null) {
    await withTimeout(app.close(), 10_000, 'Test Electron cleanup').catch(() => killAcceptanceApplication({ process: () => child }));
  }
  report.packageAfter = await installedAppFingerprint(target.application);
  if (report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(state, { recursive: true, force: true });
  await cleanupLayout?.();
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
