import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { collectPublishManifestErrors, PI_RUNTIME_PACKAGES } from './check-publish-manifest.mjs';

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { verifyInstalledGatewayRuntime } = await import(
  pathToFileURL(join(root, 'dist/src/infra/package-runtime-check.js')).href
);
const work = await mkdtemp(join(os.tmpdir(), 'xopc-npm-smoke-'));
let gateway;
let gatewayOutput = '';
try {
  const archive = process.argv[2] ? resolve(process.argv[2]) : join(work, 'xopc.tgz');
  if (!process.argv[2]) {
    await exec('pnpm', ['pack', '--out', archive], { cwd: root, timeout: 120_000, maxBuffer: 1024 * 1024 });
  }
  const prefix = join(work, 'install');
  console.log('Installing packed artifact into an empty npm prefix (without the workspace lockfile)...');
  // npm is intentional here: this reproduces end-user global installs, not workspace dependency management.
  await exec('npm', ['install', '-g', '--prefix', prefix, archive, '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: work, timeout: 600_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NPM_CONFIG_CACHE: join(work, 'npm-cache') },
  });
  const packageRoot = join(prefix, process.platform === 'win32' ? '' : 'lib', 'node_modules', '@xopcai/xopc');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.deepEqual(collectPublishManifestErrors(manifest), []);
  const expectedPiVersion = manifest.dependencies['@earendil-works/pi-coding-agent'];
  // Resolve ESM import conditions: Pi does not expose a CommonJS require entry.
  const inspectVersions = `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const parent = ${JSON.stringify(pathToFileURL(join(packageRoot, 'package.json')).href)};
const codingParent = import.meta.resolve('@earendil-works/pi-coding-agent', parent);
for (const name of ${JSON.stringify(PI_RUNTIME_PACKAGES)}) {
  for (const base of [parent, codingParent]) {
    let dir = dirname(fileURLToPath(import.meta.resolve(name, base)));
    while (true) {
      try {
        const installed = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        if (installed.name === name) {
          assert.equal(installed.version, ${JSON.stringify(expectedPiVersion)}, name + ' resolved to an incompatible version');
          break;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      const next = dirname(dir);
      if (next === dir) throw new Error('Could not find installed metadata for ' + name);
      dir = next;
    }
  }
}`;
  await exec(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '--eval', inspectVersions], {
    cwd: packageRoot, timeout: 30_000,
  });
  assert.deepEqual(await verifyInstalledGatewayRuntime({ packageRoot }), []);
  const port = await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((err) => err ? reject(err) : resolvePort(port));
    });
  });
  const state = join(work, 'state');
  await mkdir(state);
  const token = 'npm-package-smoke-token';
  const config = join(state, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { port, auth: { mode: 'token', token } } }));
  gateway = spawn(process.execPath, [join(packageRoot, 'dist/src/cli/bin.js'), 'gateway',
    '--bind', 'loopback', '--port', String(port), '--foreground', '--no-hot-reload'], {
    cwd: packageRoot,
    env: {
      ...process.env, XOPC_STATE_DIR: state, XOPC_CONFIG: config, XOPC_CONFIG_PATH: config,
      XOPC_WORKSPACE: join(state, 'workspace'), XOPC_LOG_DIR: join(state, 'logs'),
      XOPC_GATEWAY_AUTH_MODE: 'token', XOPC_GATEWAY_TOKEN: token, XOPC_GATEWAY_PASSWORD: '',
      XOPC_NO_RESPAWN: '1', XOPC_SKIP_CHANNELS: '1', XOPC_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateway.on('error', (err) => { gatewayOutput += err.message; });
  for (const stream of [gateway.stdout, gateway.stderr]) {
    stream.on('data', (chunk) => { gatewayOutput = (gatewayOutput + chunk).slice(-16000); });
  }
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (gateway.exitCode !== null || gateway.signalCode !== null) throw new Error('Gateway exited before readiness');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      ready = response.ok && (await response.json()).ready === true;
      if (ready) break;
    } catch { /* Wait for the isolated gateway to listen. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready, 'Gateway did not become ready');
  const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, manifest.version);
  console.log(`Clean npm install smoke passed: xopc ${manifest.version}, Pi ${expectedPiVersion}, gateway ready, authenticated status 200.`);
} catch (err) {
  if (gatewayOutput) console.error(gatewayOutput);
  throw err;
} finally {
  if (gateway?.pid && gateway.exitCode === null && gateway.signalCode === null) {
    const exited = new Promise((done) => gateway.once('exit', done));
    gateway.kill('SIGTERM');
    const timer = setTimeout(() => gateway.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  await rm(work, { recursive: true, force: true });
}
