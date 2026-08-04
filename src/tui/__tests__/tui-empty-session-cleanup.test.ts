import { describe, expect, it, vi } from 'vitest';

import {
  cleanupAbandonedTuiSessions,
  deleteGeneratedTuiSessionIfEmpty,
  GENERATED_TUI_SESSION_SHELL_PATCH,
  hideLegacyEmptyTuiSessions,
  isGeneratedTuiSessionKey,
} from '../tui-empty-session-cleanup.js';

const EMPTY_STATS = {
  totalMessages: 0,
  userMessages: 0,
  assistantMessages: 0,
  toolCalls: 0,
  toolResults: 0,
  contextRows: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const GENERATED_KEY = 'agent:coder:tui-149a0524-cdc7-4495-b317-96b540c99c54';

describe('TUI empty session cleanup', () => {
  it('marks generated startup shells as hidden until the first user message', () => {
    expect(GENERATED_TUI_SESSION_SHELL_PATCH).toEqual({
      hiddenFromSessionList: true,
      customData: { genericNewChatShell: true },
    });
  });

  it('recognizes only automatically generated TUI session keys', () => {
    expect(isGeneratedTuiSessionKey(GENERATED_KEY)).toBe(true);
    expect(isGeneratedTuiSessionKey('agent:coder:tui-manual')).toBe(false);
    expect(isGeneratedTuiSessionKey('agent:coder:main')).toBe(false);
  });

  it('deletes a generated session only when its transcript is empty', async () => {
    const deleteSession = vi.fn(async () => ({ ok: true }));
    const emptyClient = {
      getSessionStats: vi.fn(async () => EMPTY_STATS),
      deleteSession,
    };

    await expect(deleteGeneratedTuiSessionIfEmpty(emptyClient, GENERATED_KEY)).resolves.toBe(true);
    expect(deleteSession).toHaveBeenCalledWith(GENERATED_KEY);

    const nonEmptyClient = {
      getSessionStats: vi.fn(async () => ({ ...EMPTY_STATS, totalMessages: 1, userMessages: 1 })),
      deleteSession: vi.fn(async () => ({ ok: true })),
    };
    await expect(deleteGeneratedTuiSessionIfEmpty(nonEmptyClient, GENERATED_KEY)).resolves.toBe(false);
    expect(nonEmptyClient.deleteSession).not.toHaveBeenCalled();
  });

  it('cleans abandoned empty sessions without touching the current or non-empty session', async () => {
    const oldEmpty = GENERATED_KEY;
    const current = 'agent:coder:tui-249a0524-cdc7-4495-b317-96b540c99c54';
    const nonEmpty = 'agent:coder:tui-349a0524-cdc7-4495-b317-96b540c99c54';
    const deleteSession = vi.fn(async () => ({ ok: true }));
    const client = {
      listSessions: vi.fn(async () => [
        { key: oldEmpty, messageCount: 0, updatedAt: 0 },
        { key: current, messageCount: 0, updatedAt: 0 },
        { key: nonEmpty, messageCount: 1, updatedAt: 0 },
      ]),
      getSessionStats: vi.fn(async () => EMPTY_STATS),
      deleteSession,
    };

    await expect(cleanupAbandonedTuiSessions(client, current, 2 * 60 * 60_000)).resolves.toEqual([oldEmpty]);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith(oldEmpty);
  });

  it('does not clean a recently updated empty session that may still be active', async () => {
    const deleteSession = vi.fn(async () => ({ ok: true }));
    const client = {
      listSessions: vi.fn(async () => [{ key: GENERATED_KEY, messageCount: 0, updatedAt: 90_000 }]),
      getSessionStats: vi.fn(async () => EMPTY_STATS),
      deleteSession,
    };

    await expect(cleanupAbandonedTuiSessions(client, 'agent:coder:main', 100_000)).resolves.toEqual([]);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('hides legacy visible generated shells without hiding non-empty sessions', async () => {
    const nonEmpty = 'agent:coder:tui-349a0524-cdc7-4495-b317-96b540c99c54';
    const patchSession = vi.fn(async () => {});
    const client = {
      listSessions: vi.fn(async () => [
        { key: GENERATED_KEY, messageCount: 0 },
        { key: nonEmpty, messageCount: 1 },
        { key: 'agent:coder:manual', messageCount: 0 },
      ]),
      patchSession,
    };

    await expect(hideLegacyEmptyTuiSessions(client)).resolves.toEqual([GENERATED_KEY]);
    expect(patchSession).toHaveBeenCalledWith(GENERATED_KEY, GENERATED_TUI_SESSION_SHELL_PATCH);
  });
});
