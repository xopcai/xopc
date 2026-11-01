import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, link, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { DesktopWorkspaceHelper } from '../desktop/workspace-helper.js';
import { DesktopExecutionLease } from '../desktop/operation-journal.js';
import { DesktopDeviceFrameSigner } from '../../src/endpoint-tools/desktop-device-frame.js';

let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== 'darwin') return;
  directory = await mkdtemp(join(tmpdir(), 'xopc-workspace-helper-'));
  executable = join(directory, 'workspace.node');
  execFileSync('c++', ['-std=c++17', '-bundle', '-undefined', 'dynamic_lookup', '-I', join(dirname(dirname(process.execPath)), 'include/node'), 'electron/native/desktop-workspace-macos.cc', '-o', executable]);
}, 30000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function client(root: string) {
  const helper = await DesktopWorkspaceHelper.open(executable, root);
  return { async request(value: unknown) {
    try { return await helper.request(value as any); }
    catch (error) { return { ok: false, error: error instanceof Error && /^WORKSPACE_/.test(error.message) ? error.message : 'WORKSPACE_ARGUMENT_INVALID' }; }
  }, close: () => helper.stop() };
}
it.skipIf(process.platform !== 'darwin')('anchors a native directory and rejects traversal, intermediate/final links and hardlinks', async () => {
  const root = join(directory, 'root'), outside = join(directory, 'outside');
  await mkdir(root); await mkdir(outside); await writeFile(join(root, 'allowed.txt'), 'local'); await writeFile(join(outside, 'secret.txt'), 'outside');
  await symlink(outside, join(root, 'escape')); await symlink(join(outside, 'secret.txt'), join(root, 'final')); await link(join(outside, 'secret.txt'), join(root, 'hard'));
  execFileSync('mkfifo', [join(root, 'pipe')]);
  const helper = await client(root);
  try {
    for (const relativePath of ['../outside/secret.txt', '/etc/passwd', 'a//b', './allowed.txt', 'a/../allowed.txt', 'a\\b', 'a\0b', 'escape/secret.txt', 'final', 'hard', 'pipe']) {
      expect(await helper.request({ action: 'read', relativePath })).toMatchObject({ ok: false });
    }
    // Replacing the absolute path cannot retarget the already-authorized directory FD.
    await rename(root, root + '-moved'); await mkdir(root); await writeFile(join(root, 'allowed.txt'), 'replacement');
    expect(await helper.request({ action: 'read', relativePath: 'allowed.txt' })).toMatchObject({ ok: true, result: { text: 'local' } });
    expect(await helper.request({ action: 'list', relativePath: '' })).toMatchObject({ ok: true, result: { entries: [{ name: 'allowed.txt', kind: 'file' }], truncated: false } });
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('outside');
  } finally { await helper.close(); }
});

it.skipIf(process.platform !== 'darwin')('checks explicit create and content versions, bounds UTF-8 bytes and rejects unknown commands', async () => {
  const root = join(directory, 'writes'); await mkdir(root);
  const helper = await client(root);
  try {
    const created = await helper.request({ action: 'write', relativePath: 'file.txt', text: 'original', expectedVersion: null });
    expect(created).toMatchObject({ ok: true, result: { bytes: 8 } });
    expect(await helper.request({ action: 'write', relativePath: 'file.txt', text: 'replace', expectedVersion: null })).toMatchObject({ ok: false, error: 'WORKSPACE_VERSION_CONFLICT' });
    await writeFile(join(root, 'file.txt'), 'external edit');
    expect(await helper.request({ action: 'write', relativePath: 'file.txt', text: 'replace', expectedVersion: created.result.version })).toMatchObject({ ok: false, error: 'WORKSPACE_VERSION_CONFLICT' });
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('external edit');
    const current = await helper.request({ action: 'read', relativePath: 'file.txt' });
    expect(await helper.request({ action: 'write', relativePath: 'file.txt', text: '短', expectedVersion: current.result.version })).toMatchObject({ ok: true, result: { bytes: 3 } });
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('短');
    expect(await helper.request({ action: 'write', relativePath: 'large.txt', text: '字'.repeat(11000), expectedVersion: null })).toMatchObject({ ok: false, error: 'WORKSPACE_ARGUMENT_INVALID' });
    await writeFile(join(root, 'huge.txt'), 'a'.repeat(32769));
    expect(await helper.request({ action: 'read', relativePath: 'huge.txt' })).toMatchObject({ ok: false, error: 'WORKSPACE_FILE_TOO_LARGE' });
    await writeFile(join(root, 'escaped.txt'), '\u0001'.repeat(32768));
    expect(await helper.request({ action: 'read', relativePath: 'escaped.txt' })).toMatchObject({ ok: false, error: 'WORKSPACE_RESULT_TOO_LARGE' });
    await writeFile(join(root, 'near-frame.txt'), '\n'.repeat(23000));
    const response = await helper.request({ action: 'read', relativePath: 'near-frame.txt' }); expect(response.ok).toBe(true);
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const signer = new DesktopDeviceFrameSigner({ gatewayId: randomUUID(), deviceId: randomUUID(), clientId: randomUUID(), connectionInstanceId: randomUUID(), authorizationRevision: 1 },
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    try {
      const wire = signer.sign({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'tool.result',
        payload: { invocationId: randomUUID(), content: [{ type: 'json', value: response }] } });
      expect(Buffer.byteLength(JSON.stringify({ protocolVersion: 2, type: 'desktop.endpoint.message', messageId: randomUUID(), sentAt: Date.now(), payload: JSON.parse(wire) }))).toBeLessThan(256 * 1024);
    } finally { signer.close(); }
    expect(await helper.request({ action: 'exec', relativePath: '', command: 'true' })).toMatchObject({ ok: false });
    expect(await helper.request({ action: 'read', relativePath: 'file.txt', root: '/tmp' })).toMatchObject({ ok: false, error: 'WORKSPACE_ARGUMENT_INVALID' });
  } finally { await helper.close(); }
});

it.skipIf(process.platform !== 'darwin')('supervises one helper without reopening after stop or accepting a second use of a worker', async () => {
  const root = join(directory, 'supervised'); await mkdir(root);
  const helper = await DesktopWorkspaceHelper.open(executable, root);
  try {
    expect(helper.identity().path).toBe(root.replace(/^\/var\//, '/private/var/'));
    const worker = helper.worker('write'), args = { relativePath: 'one.txt', text: 'one', expectedVersion: null };
    expect(await worker.run(args, new AbortController().signal)).toMatchObject({ status: 'succeeded' });
    await expect(worker.run(args, new AbortController().signal)).rejects.toThrow('ARGUMENT_INVALID');
    expect(await helper.worker('read').run({ relativePath: 'one.txt' }, new AbortController().signal)).toMatchObject({ status: 'succeeded', result: { content: [{ type: 'json', value: { ok: true, result: { text: 'one' } } }] } });
    expect(await helper.stop()).toEqual({ confirmed: true });
    await expect(helper.request({ action: 'read', relativePath: 'one.txt' })).rejects.toThrow('EXECUTOR_STOPPED');
    expect(await helper.stop()).toEqual({ confirmed: true });
    expect(await readFile(join(root, 'one.txt'), 'utf8')).toBe('one');
  } finally { await helper.stop(); }
});

it.skipIf(process.platform !== 'darwin')('cannot leave a native worker writing after its parent process dies and releases the shared executor lease', async () => {
  const root = join(directory, 'crash'), executor = join(directory, 'executor'); await mkdir(root);
  const fixture = join(directory, 'parent.mts');
  // The delayed write is a test-only worker. Production workers never schedule later actions.
  const worker = `const {parentPort,workerData}=require('node:worker_threads');
    const native=require(workerData.addon),root=native.openRoot(workerData.root);
    setTimeout(()=>native.writeFile(root,'must-not-exist.txt','late',null),1000);
    parentPort.postMessage('ready');`;
  await writeFile(fixture, `import {Worker} from 'node:worker_threads';
    import {DesktopExecutionLease} from ${JSON.stringify(resolve('electron/desktop/operation-journal.ts'))};
    const lease=new DesktopExecutionLease(${JSON.stringify(executor)});
    const worker=new Worker(${JSON.stringify(worker)},{eval:true,workerData:${JSON.stringify({ addon: executable, root })}});
    worker.once('message',()=>process.stdout.write('ready'));
    process.on('exit',()=>lease.close());`);
  const parent = spawn(process.execPath, ['--import', 'tsx', fixture], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; parent.stderr.on('data', chunk => { log += String(chunk); });
  try {
    await Promise.race([
      once(parent.stdout, 'data').then(([data]) => expect(String(data)).toBe('ready')),
      once(parent, 'exit').then(() => { throw new Error('Parent exited before readiness: ' + log); }),
    ]);
    expect(() => new DesktopExecutionLease(executor)).toThrow('ALREADY_OWNED');
    const ended = once(parent, 'exit'); parent.kill('SIGKILL'); await ended;
    const next = new DesktopExecutionLease(executor); next.close();
    await delay(1100);
    await expect(readFile(join(root, 'must-not-exist.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { if (parent.exitCode === null && parent.signalCode === null) { const ended = once(parent, 'exit'); parent.kill('SIGKILL'); await ended; } }
}, 10000);

it.skipIf(process.platform !== 'darwin')('releases native directory descriptors when worker environments terminate', async () => {
  const root = join(directory, 'descriptors'); await mkdir(root);
  const count = () => execFileSync('lsof', ['-a', '-p', String(process.pid), '-Fn'], { encoding: 'utf8' }).split('\n')
    .filter(line => line === 'n' + root || line === 'n' + root.replace(/^\/var\//, '/private/var/')).length;
  const baseline = count();
  for (let i = 0; i < 8; i += 1) { const helper = await DesktopWorkspaceHelper.open(executable, root); await helper.stop(); }
  expect(count()).toBe(baseline);
});
