import { describe, expect, it, beforeEach } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import {
  addWebchatEmptyShellToCache,
  readWebchatEmptyShellCache,
  resetWebchatEmptyShellCacheForTests,
  upsertWebchatEmptyShellCache,
} from '@/features/chat/session/webchat-empty-shell-cache';

const emptyA: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_a',
  updatedAt: '2026-06-14T12:00:00.000Z',
  messageCount: 0,
};

describe('webchat-empty-shell-cache', () => {
  beforeEach(() => {
    resetWebchatEmptyShellCacheForTests();
  });

  it('addWebchatEmptyShellToCache prepends a new empty row', () => {
    upsertWebchatEmptyShellCache([
      {
        key: 'agent:main:webchat:default:direct:chat_old',
        updatedAt: '2026-06-13T12:00:00.000Z',
        messageCount: 0,
      },
    ]);
    addWebchatEmptyShellToCache(emptyA);
    const cached = readWebchatEmptyShellCache();
    expect(cached?.[0]?.key).toBe(emptyA.key);
    expect(cached).toHaveLength(2);
  });
});
