import { randomUUID } from 'node:crypto';

import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { beforeEach, expect, it, vi } from 'vitest';

import { RemoteDeviceBrowserDriver } from '../remote/device-driver.js';
import { invokeRemoteBrowserCommand } from '../remote/endpoint-transport.js';

vi.mock('../remote/endpoint-transport.js', () => ({ invokeRemoteBrowserCommand: vi.fn() }));
beforeEach(() => { vi.mocked(invokeRemoteBrowserCommand).mockReset(); });
function fixture() {
  const deviceId = randomUUID(), endpointId = `${deviceId}:${randomUUID()}`, bytes = new Uint8Array([1, 2, 3]);
  const endpoint = { kind: 'desktop', endpointId, principalId: deviceId, connectionId: randomUUID(), availability: 'foreground',
    executionAuthority: { gatewayId: randomUUID(), deviceId, grantId: randomUUID(), authorizationRevision: 1, connectionInstanceId: randomUUID(), expiresAt: Date.now() + 60000 } };
  const tool = { descriptor: REMOTE_BROWSER_DESCRIPTOR, revision: 'a'.repeat(64) };
  const take = vi.fn(() => bytes);
  const runtime = { targets: { resolve: () => endpoint }, registry: { get: vi.fn(() => endpoint), getTool: vi.fn(() => tool) }, uploads: { takeComputerFrame: take } };
  const driver = new RemoteDeviceBrowserDriver(runtime as never, endpointId, 'owner');
  const state = { sessionId: 'session', tabId: 'tab-1', documentId: 'document-1', revision: 1, url: 'https://fixture.invalid/', title: 'Fixture',
    nodes: [], changes: { added: [], changed: [], removed: [] } };
  const body = { version: 1, dispatch: 'completed', result: { ok: true, receipt: { action: 'observe', risk: 'read', durationMs: 0, verified: true, observation: state } } };
  const result = { invocationId: randomUUID(), content: [{ type: 'json', value: body },
    { type: 'file', fileId: 'frame', name: 'observation.png', mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64) }] };
  vi.mocked(invokeRemoteBrowserCommand).mockResolvedValue(result as never);
  return { endpoint, endpointId, runtime, take, driver, state, body, result, bytes };
}
it('does no RPC until an explicit command and consumes/clears only that invocation frame', async () => {
  const f = fixture(); await f.driver.connect(); await f.driver.createSession('session');
  expect(invokeRemoteBrowserCommand).not.toHaveBeenCalled();
  const observed = await f.driver.observe('session', { action: 'observe', visual: 'always' });
  expect(observed.visual?.data).toBe(Buffer.from([1, 2, 3]).toString('base64'));
  expect(f.take).toHaveBeenCalledWith('frame', f.result.invocationId); expect([...f.bytes]).toEqual([0, 0, 0]);
  expect(vi.mocked(invokeRemoteBrowserCommand).mock.calls[0]![2]).toMatchObject({ owner: 'owner', sessionId: 'session', input: { action: 'observe' } });
});
it.each(['session', 'malformed', 'inline-image'] as const)('rejects %s results and clears the already-consumed frame', async kind => {
  const f = fixture(); await f.driver.connect(); await f.driver.createSession('session');
  if (kind === 'session') f.state.sessionId = 'other-session';
  if (kind === 'malformed') Object.assign(f.state, { nodes: 'invalid' });
  if (kind === 'inline-image') Object.assign(f.state, { visual: { mimeType: 'image/png', data: 'untrusted-inline' } });
  await expect(f.driver.observe('session', { action: 'observe', visual: 'always' })).rejects.toThrow();
  expect([...f.bytes]).toEqual([0, 0, 0]);
});
it('refuses an absent invocation/frame association and never reads an arbitrary cache entry', async () => {
  const f = fixture(); await f.driver.connect(); await f.driver.createSession('session');
  vi.mocked(invokeRemoteBrowserCommand).mockResolvedValue({ content: f.result.content } as never);
  await expect(f.driver.observe('session', { action: 'observe', visual: 'always' })).rejects.toThrow('FRAME_MISSING');
  expect(f.take).not.toHaveBeenCalled();
});
it.each(['connection', 'grant', 'revision'] as const)('does not adopt a changed %s within the same endpoint ID', async kind => {
  const f = fixture(); await f.driver.connect(); await f.driver.createSession('session');
  if (kind === 'connection') f.endpoint.connectionId = randomUUID();
  if (kind === 'grant') f.endpoint.executionAuthority.grantId = randomUUID();
  if (kind === 'revision') f.endpoint.executionAuthority.authorizationRevision += 1;
  await expect(f.driver.observe('session', { action: 'observe' })).rejects.toThrow('CONNECTION_CHANGED');
  expect(invokeRemoteBrowserCommand).not.toHaveBeenCalled();
});
it('rejects target substitution and server-path uploads before any device call', async () => {
  const f = fixture(); await f.driver.connect(); await f.driver.createSession('session');
  await expect(f.driver.observe('session', { action: 'observe', target: { kind: 'endpoint', endpointId: 'other' } })).rejects.toThrow('TARGET_MISMATCH');
  expect(await f.driver.perform('session', { action: 'upload', revision: 1, ref: 'e1', paths: ['/etc/passwd'] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(invokeRemoteBrowserCommand).not.toHaveBeenCalled();
});
