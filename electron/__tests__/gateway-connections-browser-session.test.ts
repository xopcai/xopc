import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REMOTE_BROWSER_CONTROL_TOOL, REMOTE_BROWSER_DESCRIPTOR, type RemoteBrowserCommand } from '@xopcai/browser-control-contract/remote';
import { canonicalJson, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopBrowserSession, type DesktopBrowserBroker } from '../desktop/browser-session.js';
import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../desktop/operation-supervisor.js';

let root: string, lease: DesktopExecutionLease, journal: DesktopOperationJournal, session: DesktopBrowserSession, supervisor: DesktopOperationSupervisor;
let command: RemoteBrowserCommand, intent: DesktopOperationIntent, current: boolean;
let broker: DesktopBrowserBroker;
const catalog = new DesktopExecutionCatalog([REMOTE_BROWSER_DESCRIPTOR as never]);
const createBroker = vi.fn(), upload = vi.fn();
const observation = () => ({ sessionId: command.sessionId, tabId: 'tab-1', documentId: 'document-1', revision: 1,
  url: 'https://fixture.invalid/', title: 'Isolated fixture', nodes: [], changes: { added: [], changed: [], removed: [] } });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xopc-browser-session-')); lease = new DesktopExecutionLease(root); journal = new DesktopOperationJournal(lease);
  current = true;
  command = { version: 1, owner: randomUUID(), sessionId: randomUUID(), actionId: randomUUID(), input: { action: 'observe', visual: 'never' } };
  intent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), tool: REMOTE_BROWSER_CONTROL_TOOL,
    argumentHash: createHash('sha256').update(canonicalJson(command)).digest('hex'), toolRevision: catalog.revision(REMOTE_BROWSER_CONTROL_TOOL)!,
    authorizationRevision: 1, expiresAt: Date.now() + 30000 };
  broker = { execute: vi.fn(async () => {
    expect(journal.inspect(intent)).toMatchObject({ state: 'running' });
    return { result: { ok: true, receipt: { action: 'observe', risk: 'read', durationMs: 0, verified: true, observation: observation() } }, dispatch: 'completed' };
  }), dispose: vi.fn(async () => ({ confirmed: true })) };
  createBroker.mockReset().mockImplementation(() => { expect(journal.inspect(intent)).toMatchObject({ state: 'running' }); return broker; }); upload.mockReset();
  session = new DesktopBrowserSession({ current: () => current, createBroker, uploadFrame: upload });
  supervisor = new DesktopOperationSupervisor({ journal, authority: () => ({ gatewayId: intent.gatewayId, deviceId: intent.deviceId,
    authorizationRevision: 1, toolRevision: intent.toolRevision, expiresAt: intent.expiresAt, active: current }),
    createWorker: (_tool, operation) => { if (!operation) throw new Error('Missing operation'); return session.worker(operation); }, validateResult: catalog.validateResult, stopTimeoutMs: 25 });
});
afterEach(async () => { await session.stop(); journal.close(); lease.close(); rmSync(root, { recursive: true, force: true }); });
const execute = (value = command, operation = intent) => supervisor.execute({ intent: operation, arguments: value as unknown as Record<string, unknown>,
  invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal });

it('keeps the browser cold before durable execution and preserves the completed receipt without replaying content', async () => {
  session.worker(intent); expect(createBroker).not.toHaveBeenCalled();
  expect(await execute()).toMatchObject({ receipt: { state: 'succeeded', executionStopped: true }, result: { content: [{ type: 'json', value: { version: 1, dispatch: 'completed' } }] } });
  expect(createBroker).toHaveBeenCalledOnce(); expect(broker.execute).toHaveBeenCalledOnce();
  expect(await execute()).toMatchObject({ repeated: true, receipt: { state: 'succeeded' } });
  expect(broker.execute).toHaveBeenCalledOnce();
});
it('stopping an unstarted worker never creates a browser or grants permission', async () => {
  const worker = session.worker(intent); expect(await worker.stop()).toEqual({ confirmed: true });
  await expect(worker.run(command as never, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
  expect(createBroker).not.toHaveBeenCalled();
});
it.each([
  { input: { action: 'upload', revision: 1, ref: 'e1', paths: ['/etc/passwd'] } },
  { input: { action: 'sequence', revision: 1, steps: [] } },
  { input: { action: 'observe', target: { kind: 'endpoint', endpointId: 'other' } } },
  { input: { action: 'navigate', url: 'file:///etc/passwd' } },
  { input: { action: 'wait', revision: 1, condition: 'text', timeoutMs: 60000 } },
  { input: { action: 'click', ref: 'e1', revision: 1, script: 'arbitrary()' } },
])('rejects host paths, raw code, target substitution and unbounded batches before creating a broker: %j', patch => {
  expect(() => catalog.validateArguments(REMOTE_BROWSER_CONTROL_TOOL, { ...command, ...patch })).toThrow();
  expect(createBroker).not.toHaveBeenCalled();
});
it('uploads one ephemeral frame under the same intent and zeroes its bytes after handoff', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  vi.mocked(broker.execute).mockResolvedValue({ result: { ok: true, receipt: { action: 'observe', risk: 'read', durationMs: 0, verified: true,
    observation: observation() } }, dispatch: 'completed', frame: { bytes, mimeType: 'image/png' } });
  upload.mockImplementation(async (frame, operation) => {
    expect(operation).toEqual(intent); expect([...frame.bytes]).toEqual([1, 2, 3]);
    return { type: 'file', fileId: randomUUID(), name: 'observation.png', mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64) };
  });
  expect(await execute()).toMatchObject({ receipt: { state: 'succeeded' } }); expect(upload).toHaveBeenCalledOnce();
  expect([...bytes]).toEqual([0, 0, 0]);
});
it.each(['cross-session', 'inline-image', 'unknown-dispatch', 'upload-revoked'] as const)('retains unknown and clears frame memory on %s', async kind => {
  const bytes = new Uint8Array([1, 2, 3]);
  const state = { ...observation(), ...(kind === 'cross-session' ? { sessionId: randomUUID() } : {}),
    ...(kind === 'inline-image' ? { visual: { mimeType: 'image/png' as const, data: 'must-not-enter-json' } } : {}) };
  vi.mocked(broker.execute).mockResolvedValue({ result: { ok: true, receipt: { action: 'observe', risk: 'read', durationMs: 0, verified: true, observation: state } },
    dispatch: kind === 'unknown-dispatch' ? 'unknown' : 'completed', frame: { bytes, mimeType: 'image/png' } });
  upload.mockImplementation(async () => { current = false; throw new Error('Device revoked'); });
  expect(await execute()).toMatchObject({ receipt: { state: 'unknown' } });
  expect([...bytes]).toEqual([0, 0, 0]); expect(broker.dispose).toHaveBeenCalled();
  if (kind !== 'upload-revoked') expect(upload).not.toHaveBeenCalled();
});
it('does not treat failed browser destruction as confirmed stop and permits an independent later stop check', async () => {
  vi.mocked(broker.execute).mockResolvedValue({ result: { ok: false, error: { code: 'TIMEOUT', message: 'Input outcome is unknown' } }, dispatch: 'unknown' });
  vi.mocked(broker.dispose).mockResolvedValue({ confirmed: false });
  expect(await execute()).toMatchObject({ receipt: { state: 'unknown', executionStopped: false } });
  expect(supervisor.status()).toMatchObject({ blocked: true, stopUnconfirmed: true });
  vi.mocked(broker.dispose).mockResolvedValue({ confirmed: true }); expect(await session.stop()).toEqual({ confirmed: true });
});
it('never sends another conversation into an existing browser session', async () => {
  await execute();
  const other = { ...command, owner: randomUUID(), actionId: randomUUID() };
  const changed = { ...intent, operationId: randomUUID(), argumentHash: createHash('sha256').update(canonicalJson(other)).digest('hex') };
  expect(await execute(other, changed)).toMatchObject({ receipt: { state: 'unknown' } });
  expect(broker.execute).toHaveBeenCalledOnce();
});
it('stops pending preparation without allowing a late completion to start browser work', async () => {
  const started = Promise.withResolvers<void>(), prepared = Promise.withResolvers<void>();
  session = new DesktopBrowserSession({ current: () => current, createBroker, uploadFrame: upload,
    prepareOperation: async () => { started.resolve(); await prepared.promise; } });
  const pending = execute(); await started.promise;
  expect(await session.stop()).toEqual({ confirmed: true }); prepared.resolve();
  expect(await pending).toMatchObject({ receipt: { state: 'unknown' } });
  expect(await supervisor.stop()).toMatchObject({ state: 'stopped', resultUnknown: true });
  expect(journal.inspect(intent)).toMatchObject({ state: 'unknown', executionStopped: true });
  expect(broker.execute).not.toHaveBeenCalled();
});
it('discards a late browser frame after local stop without uploading or returning it', async () => {
  const started = Promise.withResolvers<void>(), result = Promise.withResolvers<Awaited<ReturnType<DesktopBrowserBroker['execute']>>>();
  vi.mocked(broker.execute).mockImplementation(async () => { started.resolve(); return result.promise; });
  const pending = execute(); await started.promise;
  expect(await session.stop()).toEqual({ confirmed: true });
  const bytes = new Uint8Array([4, 5, 6]);
  result.resolve({ result: { ok: true, receipt: { action: 'observe', risk: 'read', durationMs: 0, verified: true, observation: observation() } },
    dispatch: 'completed', frame: { bytes, mimeType: 'image/png' } });
  expect(await pending).toMatchObject({ receipt: { state: 'unknown' } });
  expect(await supervisor.stop()).toMatchObject({ state: 'stopped', resultUnknown: true });
  expect(journal.inspect(intent)).toMatchObject({ state: 'unknown', executionStopped: true });
  expect(upload).not.toHaveBeenCalled(); expect([...bytes]).toEqual([0, 0, 0]);
});
