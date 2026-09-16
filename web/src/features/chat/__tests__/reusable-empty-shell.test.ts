import { describe, expect, it, beforeEach } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import {
  isReusableEmptyShell,
  pickReusableEmptyShell,
} from '@/features/chat/session/reusable-empty-shell';
import { resetWebchatEmptyShellCacheForTests } from '@/features/chat/session/webchat-empty-shell-cache';

const emptyMain: SessionInfo = {
  agentId: 'main', sourceChannel: 'webchat', customData: { genericNewChatShell: true },
  key: '4f38f9b5-6c58-5886-8d28-c9bde2ce4632',
  updatedAt: '2026-06-14T10:00:00.000Z',
  messageCount: 0,
};

const emptyOther: SessionInfo = {
  agentId: 'other', sourceChannel: 'webchat', customData: { genericNewChatShell: true },
  key: '95c1e544-60ad-5536-8341-4e79c26acece',
  updatedAt: '2026-06-14T09:00:00.000Z',
  messageCount: 0,
};

const withMessages: SessionInfo = {
  agentId: 'main', sourceChannel: 'webchat', customData: { genericNewChatShell: true },
  key: '26cbbfdf-7e03-5daa-a43f-0bba3d7ad351',
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
      agentId: 'main', sourceChannel: 'telegram',
      key: 'fccb9a2f-32d6-5f68-98dc-38eee1d3f8ac',
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
      key: 'e5b7fb9a-5ffc-5ea0-87f3-1c6c8d0c7352',
      updatedAt: '2026-06-13T10:00:00.000Z',
    };
    const picked = pickReusableEmptyShell([older, emptyMain, withMessages], { agentId: 'main' });
    expect(picked?.key).toBe(emptyMain.key);
  });

  it('keeps generic and project scopes separate', () => {
    const projectShell: SessionInfo = {
      ...emptyMain,
      key: '46e90173-8175-5371-93e4-0ce9d504d523',
      updatedAt: '2026-06-14T12:00:00.000Z',
      projectId: 'project-a',
    };
    const genericShell: SessionInfo = {
      ...emptyMain,
      key: '6a7839bb-eb38-5b17-ad07-b0c73e4bcad2',
      updatedAt: '2026-06-14T11:00:00.000Z',
    };

    expect(pickReusableEmptyShell([projectShell, genericShell], { agentId: 'main' })?.key).toBe(genericShell.key);
    expect(pickReusableEmptyShell([projectShell, genericShell], { agentId: 'main', projectId: 'project-a' })?.key).toBe(projectShell.key);
  });
});
