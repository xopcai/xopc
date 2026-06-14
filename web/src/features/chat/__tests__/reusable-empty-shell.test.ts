import { describe, expect, it, beforeEach } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import {
  isReusableEmptyShell,
  pickReusableEmptyShell,
} from '@/features/chat/session/reusable-empty-shell';
import { resetWebchatEmptyShellCacheForTests } from '@/features/chat/session/webchat-empty-shell-cache';

const emptyMain: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_a',
  updatedAt: '2026-06-14T10:00:00.000Z',
  messageCount: 0,
};

const emptyOther: SessionInfo = {
  key: 'agent:other:webchat:default:direct:chat_b',
  updatedAt: '2026-06-14T09:00:00.000Z',
  messageCount: 0,
};

const withMessages: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_c',
  updatedAt: '2026-06-14T11:00:00.000Z',
  messageCount: 3,
};

describe('isReusableEmptyShell', () => {
  beforeEach(() => {
    resetWebchatEmptyShellCacheForTests();
  });

  it('accepts empty webchat session for matching agent', () => {
    expect(isReusableEmptyShell(emptyMain, 'main')).toBe(true);
  });

  it('rejects non-webchat keys', () => {
    const telegram: SessionInfo = {
      key: 'agent:main:telegram:default:direct:123',
      updatedAt: emptyMain.updatedAt,
      messageCount: 0,
    };
    expect(isReusableEmptyShell(telegram, 'main')).toBe(false);
  });

  it('rejects sessions with messages', () => {
    expect(isReusableEmptyShell(withMessages, 'main')).toBe(false);
  });

  it('rejects other agents', () => {
    expect(isReusableEmptyShell(emptyOther, 'main')).toBe(false);
  });
});

describe('pickReusableEmptyShell', () => {
  it('returns most recently updated empty shell', () => {
    const older: SessionInfo = {
      ...emptyMain,
      key: 'agent:main:webchat:default:direct:chat_old',
      updatedAt: '2026-06-13T10:00:00.000Z',
    };
    const picked = pickReusableEmptyShell([older, emptyMain, withMessages], 'main');
    expect(picked?.key).toBe(emptyMain.key);
  });
});
