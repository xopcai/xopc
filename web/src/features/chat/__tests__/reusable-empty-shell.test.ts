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
    expect(isReusableEmptyShell(emptyMain, { agentId: 'main' })).toBe(true);
  });

  it('rejects non-webchat keys', () => {
    const telegram: SessionInfo = {
      key: 'agent:main:telegram:default:direct:123',
      updatedAt: emptyMain.updatedAt,
      messageCount: 0,
    };
    expect(isReusableEmptyShell(telegram, { agentId: 'main' })).toBe(false);
  });

  it('rejects sessions with messages', () => {
    expect(isReusableEmptyShell(withMessages, { agentId: 'main' })).toBe(false);
  });

  it('rejects other agents', () => {
    expect(isReusableEmptyShell(emptyOther, { agentId: 'main' })).toBe(false);
  });

  it('rejects project-bound shells for generic new chat', () => {
    expect(isReusableEmptyShell({ ...emptyMain, projectId: 'project-a' }, { agentId: 'main' })).toBe(false);
  });

  it('accepts only matching project-bound shells for project new chat', () => {
    expect(isReusableEmptyShell({ ...emptyMain, projectId: 'project-a' }, { agentId: 'main', projectId: 'project-a' })).toBe(true);
    expect(isReusableEmptyShell({ ...emptyMain, projectId: 'project-b' }, { agentId: 'main', projectId: 'project-a' })).toBe(false);
    expect(isReusableEmptyShell(emptyMain, { agentId: 'main', projectId: 'project-a' })).toBe(false);
  });
});

describe('pickReusableEmptyShell', () => {
  it('returns most recently updated empty shell', () => {
    const older: SessionInfo = {
      ...emptyMain,
      key: 'agent:main:webchat:default:direct:chat_old',
      updatedAt: '2026-06-13T10:00:00.000Z',
    };
    const picked = pickReusableEmptyShell([older, emptyMain, withMessages], { agentId: 'main' });
    expect(picked?.key).toBe(emptyMain.key);
  });

  it('keeps generic and project scopes separate', () => {
    const projectShell: SessionInfo = {
      ...emptyMain,
      key: 'agent:main:webchat:default:direct:chat_project',
      updatedAt: '2026-06-14T12:00:00.000Z',
      projectId: 'project-a',
    };
    const genericShell: SessionInfo = {
      ...emptyMain,
      key: 'agent:main:webchat:default:direct:chat_generic',
      updatedAt: '2026-06-14T11:00:00.000Z',
    };

    expect(pickReusableEmptyShell([projectShell, genericShell], { agentId: 'main' })?.key).toBe(genericShell.key);
    expect(pickReusableEmptyShell([projectShell, genericShell], { agentId: 'main', projectId: 'project-a' })?.key).toBe(projectShell.key);
  });
});
