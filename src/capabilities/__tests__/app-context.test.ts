import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseAppContextEnvelope, type AppContextEnvelope } from '@xopcai/gateway-contract';

import { registerAppContextCapability } from '../runtime/app-context.js';
import { CapabilityDispatcher, defineReadCapability, type CapabilityContext } from '../runtime/dispatcher.js';

const snapshot: AppContextEnvelope = { version: 1, clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tabId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequence: 1, surface: 'web', capturedAt: 1000,
  resourceRefs: [{ kind: 'note', id: 'note', revision: '3' }], selection: { text: 'Untrusted selection', draft: true } };
const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['workspace.read'], authorize: () => true };

function fixture() {
  const dispatcher = new CapabilityDispatcher();
  const read = vi.fn(() => ({ note: { title: 'Saved note', markdown: 'Persisted body', remoteVersion: 3, secret: 'must not leak' } }));
  dispatcher.register(defineReadCapability({ id: 'xopc.notes.get', description: 'Fixture note', effect: 'read', majorVersion: 1,
    surfaces: ['http', 'agent'], scopes: ['workspace.read'], input: z.strictObject({ id: z.string() }),
    output: z.object({ note: z.record(z.string(), z.unknown()) }), execute: read,
  }));
  registerAppContextCapability(dispatcher);
  return { dispatcher, read };
}

describe('explicit app context snapshots', () => {
  it.each([
    ['task', { title: 'Task', body: 'Task body', contract: { objective: 'Goal' }, version: 3 }, 'Task body'],
    ['task', { title: 'Task', contract: { objective: 'Goal' }, version: 3 }, 'Goal'],
    ['project', { name: 'Project', brief: 'Project brief', version: 3 }, 'Project brief'],
    ['scene', { goal: 'Scene goal', revision: 3 }, 'Scene goal'],
    ['local_app', { name: 'App', idea: 'App idea', previewToken: 'not-context' }, 'App idea'],
  ] as const)('uses the persisted %s content shape', async (kind, row, expected) => {
    const dispatcher = new CapabilityDispatcher();
    const domain = kind === 'local_app' ? 'local_apps' : `${kind}s`;
    const field = kind === 'scene' ? 'activation' : kind === 'local_app' ? 'app' : kind;
    dispatcher.register(defineReadCapability({ id: `xopc.${domain}.get`, description: 'Fixture', effect: 'read', majorVersion: 1,
      surfaces: ['http'], scopes: ['workspace.read'], input: z.object({ id: z.string() }), output: z.record(z.string(), z.unknown()),
      execute: () => ({ [field]: row }),
    }));
    if (kind === 'local_app') dispatcher.register(defineReadCapability({ id: 'xopc.local_apps.validate', description: 'Hash fixture',
      effect: 'read', majorVersion: 1, surfaces: ['http'], scopes: ['workspace.read'], input: z.object({ id: z.string() }),
      output: z.object({ validation: z.object({ sourceHash: z.string() }) }), execute: () => ({ validation: { sourceHash: '3' } }),
    }));
    registerAppContextCapability(dispatcher);
    const result = await dispatcher.call('xopc.context.resolve', { ...snapshot, resourceRefs: [{ kind, id: 'fixture', revision: '3' }] }, caller);
    expect(result).toMatchObject({ resources: [{ text: expected }] });
    if (kind === 'scene') expect(result).toMatchObject({ resources: [{ title: 'Scene goal' }] });
    expect(JSON.stringify(result)).not.toContain('not-context');
  });

  it('resolves saved revisions without treating selections as persisted state or authority', async () => {
    const { dispatcher } = fixture();
    const output = await dispatcher.call('xopc.context.resolve', snapshot, caller);
    expect(output).toEqual({ snapshot, resources: [{ reference: snapshot.resourceRefs[0], title: 'Saved note', text: 'Persisted body', truncated: false }], selectionTrust: 'user-supplied' });
    expect(JSON.stringify(output)).not.toContain('must not leak');
    expect(await dispatcher.call('xopc.context.resolve', snapshot, { ...caller, surface: 'agent' })).toEqual(output);
  });

  it('checks nested capability scopes and delegation, not just permission to resolve context', async () => {
    const { dispatcher, read } = fixture();
    for (const patch of [{ scopes: [] }, { allowedCapabilities: ['xopc.context.resolve'] }]) {
      await expect(dispatcher.call('xopc.context.resolve', snapshot, { ...caller, ...patch })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(dispatcher.call('xopc.context.resolve', snapshot, { ...caller,
      authorize: id => id === 'xopc.context.resolve' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects revision conflicts and client-supplied identity fields', async () => {
    const { dispatcher } = fixture();
    await expect(dispatcher.call('xopc.context.resolve', { ...snapshot, resourceRefs: [{ ...snapshot.resourceRefs[0], revision: '2' }] }, caller))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(dispatcher.call('xopc.context.resolve', { ...snapshot, principalId: 'another-user' }, caller))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('does not maintain a shared current page or mutate a previously submitted snapshot', async () => {
    const { dispatcher } = fixture();
    const original = structuredClone(snapshot);
    const first = await dispatcher.call('xopc.context.resolve', snapshot, caller);
    const other = { ...snapshot, tabId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sequence: 2, selection: { text: 'Another tab', draft: false } };
    await dispatcher.call('xopc.context.resolve', other, caller);
    expect(snapshot).toEqual(original);
    expect(first).toMatchObject({ snapshot: original });
  });

  it('bounds total resource text and explicitly marks truncation', async () => {
    const { dispatcher, read } = fixture();
    read.mockReturnValue({ note: { title: 'Long', markdown: 'x'.repeat(20000), remoteVersion: 3, secret: '' } });
    const result = await dispatcher.call('xopc.context.resolve', snapshot, caller) as { resources: Array<{ text: string; truncated: boolean }> };
    expect(result.resources[0].text).toHaveLength(16000);
    expect(result.resources[0].truncated).toBe(true);
  });

  it('rejects duplicate references, too many references, and over-budget UTF-8 payloads', () => {
    expect(() => parseAppContextEnvelope({ ...snapshot, resourceRefs: [snapshot.resourceRefs[0], snapshot.resourceRefs[0]] })).toThrow('duplicate');
    expect(() => parseAppContextEnvelope({ ...snapshot, resourceRefs: Array(21).fill(snapshot.resourceRefs[0]) })).toThrow();
    expect(() => parseAppContextEnvelope({ ...snapshot,
      resourceRefs: Array.from({ length: 20 }, (_, index) => ({ kind: 'note', id: `${index}${'字'.repeat(500)}`, revision: '1' })),
      selection: { text: '字'.repeat(16000), draft: false },
    })).toThrow('64 KiB');
  });
});
