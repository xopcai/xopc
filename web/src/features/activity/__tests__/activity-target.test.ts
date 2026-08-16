// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkActivityTarget,
  parseActivityTarget,
} from '@/features/activity/activity-target';

describe('activity targets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses encoded session routes', () => {
    expect(parseActivityTarget('/chat/agent%3Amain%3Awebchat%3Adirect%3Achat_1')).toEqual({
      kind: 'session',
      id: 'agent:main:webchat:direct:chat_1',
    });
  });

  it('ignores routes without a target that needs validation', () => {
    expect(parseActivityTarget('/chat/new')).toBeNull();
    expect(parseActivityTarget('/work/outcome-1')).toBeNull();
  });

  it('marks only a definitive 404 as missing', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkActivityTarget({ kind: 'session', id: 'gone' })).resolves.toBe('missing');
    await expect(checkActivityTarget({ kind: 'session', id: 'temporarily-unavailable' })).resolves.toBe('available');
    await expect(checkActivityTarget({ kind: 'session', id: 'offline' })).resolves.toBe('available');
  });
});
