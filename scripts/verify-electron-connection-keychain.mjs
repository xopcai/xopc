import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import electron from 'electron';
import { chromium } from 'playwright-core';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output = await createAcceptanceOutput(join(root, 'reports/p2a1-s1-native-keychain-e2e.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-keychain-e2e-'));
const env = localConnectionEnvironment(process.env, root, state, join(state, 'unused.json'), join(state, 'unused-workspace'));
const report = { startedAt: new Date().toISOString(), passed: false,
  scope: 'Production preview, bare Electron launcher + CDP; native safeStorage backend, no mock-keychain or password-store override; development runtime, not installer', checks: {} };
let child, browser;

async function stop() {
  await browser?.close().catch(() => {});
  browser = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await withTimeout(exited, 10_000, 'Electron stop timed out').catch(() => child.kill('SIGKILL'));
  }
  child = undefined;
}
async function launch() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  child = spawn(electron, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    join(root, 'out/main/index.js'), '--gateway-connections'], { cwd: root, env, stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  let version;
  while (Date.now() < deadline && child.exitCode === null) {
    version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      .then(response => response.ok ? response.json() : undefined).catch(() => undefined);
    if (version) break;
    await delay(100);
  }
  assert(version, 'Native Electron debugger did not become available');
  browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(20_000);
  await page.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  return page;
}

try {
  let page = await launch();
  const token = `native-keychain-test-${randomUUID()}`;
  const saved = await page.evaluate(({ token }) => window.gatewayConnections.save(0, {
    name: 'Native keychain fixture', origin: 'https://example.invalid', transport: 'direct', credential: token,
  }), { token });
  assert(saved.ok, `Native credential save failed: ${saved.error}`);
  assert.equal(saved.snapshot.profiles[0].hasCredential, true);
  assert.equal(JSON.stringify(saved).includes(token), false);
  const directory = join(state, 'electron/gateway-connections-v1');
  const refs = await readdir(join(directory, 'credentials'));
  assert.equal(refs.length, 1);
  const encrypted = await readFile(join(directory, 'credentials', refs[0]));
  assert.equal(encrypted.includes(Buffer.from(token)), false);
  report.checks.nativeEncrypt = true;
  report.ciphertextSha256 = createHash('sha256').update(encrypted).digest('hex');
  const profileId = saved.snapshot.profiles[0].id;
  await stop();
  page = await launch();
  const result = await page.evaluate(id => window.gatewayConnections.select(0, id), profileId);
  assert(result.ok, `Native credential decrypt failed: ${result.error}`);
  assert.equal(result.snapshot.status, 'remote-chat-unavailable');
  report.checks.crossProcessDecrypt = true;
  const removed = await page.evaluate(async () => {
    const state = await window.gatewayConnections.snapshot();
    return window.gatewayConnections.remove(state.epoch, state.profiles[0].id);
  });
  assert(removed.ok);
  assert.equal(removed.snapshot.profiles.length, 0);
  assert.deepEqual(await readdir(join(directory, 'credentials')), []);
  report.checks.encryptedCredentialCleanup = true;
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await stop();
  report.finishedAt = new Date().toISOString();
  await mkdir(join(root, 'reports'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
