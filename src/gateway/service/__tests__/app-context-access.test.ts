import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { AppContextEnvelope } from '@xopcai/gateway-contract';

import { prepareAppContext, checkAppContextAccess } from '../app-context-access.js';
import { CapabilityDispatcher, defineReadCapability, CapabilityError } from '../../../capabilities/runtime/dispatcher.js';
import { registerAppContextCapability } from '../../../capabilities/runtime/app-context.js';
import type { GatewayPrincipal } from '../../security/gateway-principal.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import { isBrowserSessionActive } from '../../../storage/sqlite/browser-session-repository.js';

vi.mock('../../../storage/sqlite/device-access-repository.js', () => ({ getDevice: vi.fn() }));
vi.mock('../../../storage/sqlite/browser-session-repository.js', () => ({ isBrowserSessionActive: vi.fn() }));

const snapshot: AppContextEnvelope = {
  version: 1, clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tabId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequence: 1, surface: 'web', capturedAt: 10,
  resourceRefs: [{ kind: 'note', id: 'note', revision: '1' }], selection: { text: 'Draft', draft: true },
};
const principal: GatewayPrincipal = { kind: 'owner', principalId: 'owner', scopes: ['workspace.read'] };
const auth = { mode: 'token' as const, token: 'fixture-only' };
function fixture() {
  const dispatcher = new CapabilityDispatcher();
  const read = vi.fn(() => ({ note: { markdown: 'Original', title: 'Note', remoteVersion: 1 } }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.notes.get', majorVersion: 1, effect: 'read', description: 'Fixture', surfaces: ['http'],
    scopes: ['workspace.read'], input: z.object({ id: z.string() }), output: z.object({ note: z.object({
      markdown: z.string(), title: z.string(), remoteVersion: z.number(),
    }) }), execute: read,
  }));
  registerAppContextCapability(dispatcher);
  return { dispatcher, read };
}

describe('queued application context access', () => {
  beforeEach(() => vi.resetAllMocks());

  it('replays the original snapshot after the resource changes and checks current access', async () => {
    const { dispatcher, read } = fixture();
    const source = await prepareAppContext(snapshot, principal, auth, dispatcher);
    read.mockReturnValue({ note: { title: 'New', markdown: 'New body', remoteVersion: 2 } });
    expect(await prepareAppContext(snapshot, principal, auth, dispatcher, source)).toEqual(source);
    expect(source.text).toContain('Original');
    await expect(checkAppContextAccess(source, dispatcher, auth)).resolves.toBeUndefined();
    await expect(prepareAppContext(snapshot, { ...principal, scopes: [] }, auth, dispatcher, source)).rejects.toBeDefined();
    read.mockImplementation(() => { throw new CapabilityError('NOT_FOUND', 'Deleted'); });
    await expect(checkAppContextAccess(source, dispatcher, auth)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects changed snapshots, caller substitution, and authentication changes', async () => {
    const { dispatcher } = fixture();
    const source = await prepareAppContext(snapshot, principal, auth, dispatcher);
    await expect(prepareAppContext({ ...snapshot, sequence: 2 }, principal, auth, dispatcher, source)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(prepareAppContext(snapshot, { ...principal, principalId: 'other' }, auth, dispatcher, source)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(checkAppContextAccess(source, dispatcher, { ...auth, token: 'rotated' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(checkAppContextAccess({ ...source, appContextGrant: undefined }, dispatcher, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(JSON.stringify(source)).not.toContain(auth.token);
  });

  it('rejects a revoked device or reduced scope without acquiring newly granted scopes', async () => {
    const { dispatcher } = fixture();
    const device = { id: 'device', scopes: ['workspace.read'] } as NonNullable<ReturnType<typeof getDevice>>;
    vi.mocked(getDevice).mockReturnValue(device);
    const source = await prepareAppContext(snapshot, { ...principal, kind: 'device', principalId: 'device', deviceId: 'device' }, auth, dispatcher);
    vi.mocked(getDevice).mockReturnValue({ ...device, scopes: [] });
    await expect(checkAppContextAccess(source, dispatcher, auth)).rejects.toBeDefined();
    vi.mocked(getDevice).mockReturnValue({ ...device, revokedAt: 1 });
    await expect(checkAppContextAccess(source, dispatcher, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a browser session that ended while waiting', async () => {
    const { dispatcher } = fixture();
    vi.mocked(isBrowserSessionActive).mockReturnValue(true);
    const source = await prepareAppContext(snapshot, { ...principal, browserSessionId: 'session' }, auth, dispatcher);
    vi.mocked(isBrowserSessionActive).mockReturnValue(false);
    await expect(checkAppContextAccess(source, dispatcher, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
