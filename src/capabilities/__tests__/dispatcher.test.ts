import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CapabilityDispatcher, canonicalCapabilityJson, defineReadCapability, type CapabilityContext } from '../runtime/dispatcher.js';
import { registerSettingsCapability } from '../runtime/settings.js';

const context = (patch: Partial<CapabilityContext> = {}): CapabilityContext => ({
  principalId: 'owner', surface: 'http', scopes: ['workspace.read'], authorize: () => true, ...patch,
});
function fixture() {
  const execute = vi.fn(({ id }: { id: string }) => ({ id }));
  const dispatcher = new CapabilityDispatcher();
  dispatcher.register(defineReadCapability({
    id: 'xopc.test.get', majorVersion: 1, description: 'Read one object', effect: 'read',
    surfaces: ['http', 'agent'], scopes: ['workspace.read'],
    input: z.strictObject({ id: z.string().min(1) }), output: z.object({ id: z.string() }), execute,
  }));
  return { dispatcher, execute };
}

describe('capability dispatch boundary', () => {
  it('suggests settings navigation without granting configuration authority or accepting external URLs', async () => {
    const dispatcher = new CapabilityDispatcher();
    registerSettingsCapability(dispatcher);
    const caller = context({ scopes: ['gateway.status'] });
    expect(await dispatcher.call('xopc.settings.open', {}, caller)).toEqual({ ok: true, settings: { section: 'overview', title: 'Settings' } });
    const input = { section: 'capabilities/models', title: 'Models' };
    expect(await dispatcher.call('xopc.settings.open', input, { ...caller, surface: 'agent' })).toEqual({ ok: true, settings: input });
    for (const section of ['https://example.com', '//example.com', '../credentials', 'gateway?token=x', 'gateway#secret', '%2f%2fexample.com']) {
      await expect(dispatcher.call('xopc.settings.open', { section }, caller)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(dispatcher.call('xopc.settings.open', input, { ...caller, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dispatcher.list(caller).map(item => item.id)).toEqual(['xopc.settings.open']);
  });
  it('enforces scopes, surfaces and delegated allowlists before invoking a handler', async () => {
    const { dispatcher, execute } = fixture();
    for (const ctx of [context({ scopes: [] }), context({ surface: 'mcp' }), context({ allowedCapabilities: [] }), context({ principalId: '' })]) {
      expect(dispatcher.list(ctx)).toEqual([]);
      await expect(dispatcher.call('xopc.test.get', { id: 'a' }, ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not let admin scope bypass a resource or delegation restriction', async () => {
    const { dispatcher, execute } = fixture();
    await expect(dispatcher.call('xopc.test.get', { id: 'other-project' }, context({ scopes: ['gateway.admin'], authorize: () => false })))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(dispatcher.call('xopc.test.get', { id: 'a', principalId: 'owner' }, context()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a stale contract and an aborted request without executing', async () => {
    const { dispatcher, execute } = fixture();
    const descriptor = dispatcher.describe('xopc.test.get', context());
    await expect(dispatcher.call(descriptor.id, { id: 'a' }, context(), { ...descriptor, majorVersion: 2 }))
      .rejects.toMatchObject({ code: 'CONTRACT_CHANGED' });
    await expect(dispatcher.call(descriptor.id, { id: 'a' }, context({ signal: AbortSignal.abort() })))
      .rejects.toMatchObject({ code: 'CANCELLED' });
    expect(execute).not.toHaveBeenCalled();
    expect(await dispatcher.call(descriptor.id, { id: 'a' }, context(), descriptor)).toEqual({ id: 'a' });
  });

  it('returns isolated descriptors and canonicalizes nested object keys', () => {
    const { dispatcher } = fixture();
    const descriptor = dispatcher.describe('xopc.test.get', context());
    descriptor.surfaces.push('mcp');
    expect(dispatcher.list(context({ surface: 'mcp' }))).toEqual([]);
    expect(canonicalCapabilityJson({ b: [{ z: 1, a: 2 }], a: 0 }))
      .toBe(canonicalCapabilityJson({ a: 0, b: [{ a: 2, z: 1 }] }));
    expect(() => canonicalCapabilityJson({ a: undefined })).toThrow();
  });
});
