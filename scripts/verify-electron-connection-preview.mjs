import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

import { _electron } from 'playwright-core';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output = await createAcceptanceOutput(join(root, 'reports/p2a1-s1-preview-e2e.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-preview-e2e-'));
const config = join(state, 'xopc.json');
await writeFile(config, '{intentionally-invalid-local-config');
const env = localConnectionEnvironment(process.env, root, state, config, join(state, 'workspace'));
const inventory = JSON.parse(await readFile(join(root, 'docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-legacy-ipc-inventory.json'), 'utf8'));
const channels = inventory.channels.map(entry => entry.channel);
const report = { startedAt: new Date().toISOString(), passed: false, checks: {},
  scope: 'Built production main/restricted preload, development Electron; no remote chat, Host or signed installer acceptance' };
let application;
let upstreamRequests = 0;
const server = createServer((_request, response) => { upstreamRequests++; response.writeHead(500).end(); });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;

async function launch() {
  application = await _electron.launch({ args: [join(root, 'out/main/index.js'), '--gateway-connections'], cwd: root, env, timeout: 30_000 });
  const page = await application.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor({ timeout: 20_000 });
  return page;
}
async function files(directory) {
  try { return await readdir(directory, { recursive: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

try {
  let page = await launch();
  assert.equal(await page.evaluate(() => window.electronAPI), undefined);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.gatewayConnections).sort()), ['connect', 'quit', 'remove', 'save', 'select', 'snapshot', 'useLocal'].sort());
  report.checks.restrictedPreload = true;
  const secret = `test-only-${randomUUID()}`;
  await page.getByLabel('连接名称', { exact: true }).fill('Server A');
  await page.getByLabel('Gateway origin', { exact: true }).fill(origin);
  await page.getByRole('button', { name: '已有 SSH loopback 转发' }).click();
  await page.getByLabel('管理凭据', { exact: false }).fill(secret);
  await page.getByRole('button', { name: '保存连接配置' }).click();
  await page.getByText('Server A', { exact: false }).first().waitFor({ timeout: 20_000 });
  let snapshot = await page.evaluate(() => window.gatewayConnections.snapshot());
  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.profiles[0].hasCredential, true);
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(await page.getByLabel('管理凭据', { exact: false }).inputValue(), '');
  const profileFile = join(state, 'electron/gateway-connections-v1/profiles.json');
  assert.equal((await readFile(profileFile, 'utf8')).includes(secret), false);
  const encryptedFiles = await files(join(state, 'electron/gateway-connections-v1/credentials'));
  assert.equal(encryptedFiles.length, 1);
  const ciphertext = await readFile(join(state, 'electron/gateway-connections-v1/credentials', encryptedFiles[0]));
  assert.equal(ciphertext.includes(Buffer.from(secret)), false);
  report.checks.safeStorageApi = 'Async Electron API under Playwright mock-keychain flags; native backend tested separately';
  await page.getByRole('button', { name: '选择配置', exact: true }).click();
  await page.getByText('配置已选择；远端聊天尚未实现。本机能力保持禁用。', { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.gatewayConnections.snapshot());
  assert.equal(snapshot.status, 'remote-chat-unavailable');
  const stale = await page.evaluate(({ id, epoch }) => window.gatewayConnections.select(epoch - 1, id), { id: snapshot.profiles[0].id, epoch: snapshot.epoch });
  assert.deepEqual(stale, { ok: false, error: 'STALE_CONNECTION_EPOCH' });
  report.checks.epochAndNoReadyClaim = true;

  // Even accidental legacy registrations must be blocked before a side effect.
  const probePreload = join(state, 'probe.cjs');
  await writeFile(probePreload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('probe',{invoke:(c,...a)=>ipcRenderer.invoke(c,...a),send:c=>ipcRenderer.send(c),port:c=>{const p=new MessageChannel();ipcRenderer.postMessage(c,{},[p.port1]);p.port2.close();}});`);
  await application.evaluate(async ({ BrowserWindow, ipcMain }, { channels, probePreload }) => {
    globalThis.__previewEffects = 0;
    for (const channel of channels) {
      ipcMain.handle(channel, () => { globalThis.__previewEffects++; return 'FORBIDDEN'; });
      ipcMain.on(channel, () => { globalThis.__previewEffects++; });
      ipcMain.prependListener(channel, () => { globalThis.__previewEffects++; });
      ipcMain.prependOnceListener(channel, () => { globalThis.__previewEffects++; });
    }
    const original = BrowserWindow.getAllWindows()[0];
    const probe = new BrowserWindow({ show: false, webPreferences: { preload: probePreload,
      contextIsolation: true, nodeIntegration: false, sandbox: true, session: original.webContents.session } });
    await probe.loadURL(original.webContents.getURL());
  }, { channels, probePreload });
  const probe = application.windows().find(window => window !== page);
  assert(probe);
  const results = await probe.evaluate(async channels => {
    const result = [];
    for (const channel of channels) {
      try { await window.probe.invoke(channel); result.push(false); }
      catch (error) { result.push(String(error).includes('REMOTE_CAPABILITY_DISABLED')); }
      window.probe.send(channel);
      window.probe.port(channel);
    }
    try { await window.probe.invoke('connections:snapshot'); result.push(false); }
    catch (error) { result.push(String(error).includes('UNTRUSTED_CONNECTION_WINDOW')); }
    return result;
  }, channels);
  assert(results.every(Boolean));
  assert.equal(await application.evaluate(() => globalThis.__previewEffects), 0);
  report.checks.legacyIpcDenied = { channels: channels.length, transports: ['invoke', 'send', 'MessagePort'], listenerMethods: ['on', 'prependListener', 'prependOnceListener'], sideEffects: 0 };
  await probe.close();
  const href = page.url();
  await page.evaluate(() => { location.href = 'https://example.com'; });
  assert.equal(page.url(), href);
  report.checks.navigationDenied = true;
  assert.equal(upstreamRequests, 0);
  assert.equal(await readFile(config, 'utf8'), '{intentionally-invalid-local-config');
  assert(!(await files(state)).some(file => file.startsWith('workspace') || file.endsWith('xopc.db')));
  report.checks.noGatewayHostOrUpstream = true;
  await application.close(); application = undefined;
  page = await launch();
  snapshot = await page.evaluate(() => window.gatewayConnections.snapshot());
  assert.equal(snapshot.status, 'unselected');
  assert.equal(snapshot.profiles.length, 1);
  report.checks.noAutomaticActivation = true;
  await application.close(); application = undefined;

  const profileBefore = await readFile(profileFile);
  await writeFile(profileFile, '{corrupt-profile');
  page = await launch();
  assert.equal((await page.evaluate(() => window.gatewayConnections.snapshot())).status, 'storage-error');
  assert.equal(await readFile(profileFile, 'utf8'), '{corrupt-profile');
  report.checks.corruptStorageRecovery = true;
  await application.close(); application = undefined;
  await writeFile(profileFile, profileBefore);
  page = await launch();
  await application.evaluate(({ app }) => {
    globalThis.__localRelaunch = undefined;
    globalThis.__quitRequested = false;
    app.relaunch = options => { globalThis.__localRelaunch = options; };
    app.quit = () => { globalThis.__quitRequested = true; };
  });
  await page.getByRole('button', { name: '使用原本地模式（重启应用）', exact: true }).click();
  const handoff = await application.evaluate(() => ({ options: globalThis.__localRelaunch, quit: globalThis.__quitRequested }));
  assert.equal(handoff.quit, true);
  assert.deepEqual(handoff.options.args, [join(root, 'out/main/index.js')]);
  report.checks.localRelaunchRequest = 'Verified clean local entry arguments and quit request; OS relaunch stubbed, actual local path tested separately';
  // app.quit was stubbed only in this process to inspect the handoff intent.
  await application.evaluate(({ app }) => app.exit(0));
  application = undefined;
  report.assetSha256 = createHash('sha256').update(await readFile(join(root, 'out/preload/connections.cjs'))).digest('hex');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  report.windows = await Promise.all((application?.windows() ?? []).map(async page => ({
    url: page.url(), text: await page.locator('body').innerText({ timeout: 1000 }).catch(() => 'unavailable'),
  })));
  process.exitCode = 1;
} finally {
  if (application) await withTimeout(application.close(), 10_000, 'Preview close timed out').catch(() => application.process().kill('SIGKILL'));
  await new Promise(resolve => server.close(resolve));
  await mkdir(join(root, 'reports'), { recursive: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
