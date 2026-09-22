import { describe, expect, it, vi } from 'vitest';

import { createExtensionClient } from './client.js';
import type { Transport } from './transport.js';

describe('extension client product navigation', () => {
  it('forwards the pinned capability contract without attaching caller authority', async () => {
    const request = vi.fn(async () => ({ status: 'succeeded', releaseId: 'release', data: {} }));
    const client = createExtensionClient({ transport: { request } as unknown as Transport });
    const call = { majorVersion: 1, descriptorDigest: 'a'.repeat(64), input: {} };
    await client.capability.describe('xopc.notes.list');
    await client.capability.call('xopc.notes.list', call);
    expect(request.mock.calls).toEqual([
      ['capability.describe', { id: 'xopc.notes.list' }], ['capability.call', { id: 'xopc.notes.list', call }],
    ]);
  });
  it('opens first-class product references through the host router', async () => {
    const request = vi.fn(async () => undefined);
    const transport = {
      ready: Promise.resolve(),
      request,
      emit: vi.fn(),
      on: vi.fn(() => () => undefined),
    } as unknown as Transport;
    const client = createExtensionClient({ transport });

    await client.ui.openProduct({ kind: 'note', id: 'note/1' });

    expect(request).toHaveBeenCalledWith('ui.navigate', {
      path: '/notes/note%2F1',
    });
  });

  it('rejects references without a routable product surface', async () => {
    const transport = {
      ready: Promise.resolve(),
      request: vi.fn(),
      emit: vi.fn(),
      on: vi.fn(() => () => undefined),
    } as unknown as Transport;
    const client = createExtensionClient({ transport });

    await expect(client.ui.openProduct({ kind: 'file', id: '/tmp/result.md' }))
      .rejects.toThrow('cannot be opened');
  });
});
