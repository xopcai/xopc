import { describe, expect, it, vi } from 'vitest';

import {
  cleanupAbandonedTuiSessions,
  deleteGeneratedTuiSessionIfEmpty,
  GENERATED_TUI_SESSION_SHELL_PATCH,
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

const GENERATED_KEY = "a8426135-8ee1-494c-8a55-4b2cdec1efcf";

describe('TUI empty session cleanup', () => {
  it('marks generated startup shells as hidden until the first user message', () => {
    expect(GENERATED_TUI_SESSION_SHELL_PATCH).toEqual({
      hiddenFromSessionList: true,
      customData: { genericNewChatShell: true },
    });
  });

  it('does not delete a user-created conversation even when empty', async () => {
    const client = {
      getSessionInfo: vi.fn(async () => ({ generatedShell: false })),
      getSessionStats: vi.fn(async () => EMPTY_STATS),
      deleteSession: vi.fn(async () => ({ ok: true })),
    };
    expect(await deleteGeneratedTuiSessionIfEmpty(client, GENERATED_KEY)).toBe(false);
    expect(client.deleteSession).not.toHaveBeenCalled();
  });

  it('deletes a generated session only when its transcript is empty', async () => {
    const deleteSession = vi.fn(async () => ({ ok: true }));
    const emptyClient = {
      getSessionInfo: vi.fn(async () => ({ generatedShell: true })),
      getSessionStats: vi.fn(async () => EMPTY_STATS),
      deleteSession,
    };

    await expect(deleteGeneratedTuiSessionIfEmpty(emptyClient, GENERATED_KEY)).resolves.toBe(true);
    expect(deleteSession).toHaveBeenCalledWith(GENERATED_KEY);

    const nonEmptyClient = {
      getSessionInfo: vi.fn(async () => ({ generatedShell: true })),
      getSessionStats: vi.fn(async () => ({ ...EMPTY_STATS, totalMessages: 1, userMessages: 1 })),
      deleteSession: vi.fn(async () => ({ ok: true })),
    };
    await expect(deleteGeneratedTuiSessionIfEmpty(nonEmptyClient, GENERATED_KEY)).resolves.toBe(false);
    expect(nonEmptyClient.deleteSession).not.toHaveBeenCalled();
  });

  it('cleans abandoned empty sessions without touching the current or non-empty session', async () => {
    const oldEmpty = GENERATED_KEY;
    const current = "0839fe8d-d78c-497b-85fa-71e8070cb95f";
    const nonEmpty = "3f52b692-1c7b-413b-8caf-4a461bac8612";
    const deleteSession = vi.fn(async () => ({ ok: true }));
    const client = {
      listSessions: vi.fn(async () => [
        { key: oldEmpty, generatedShell: true, messageCount: 0, updatedAt: 0 },
        { key: current, generatedShell: true, messageCount: 0, updatedAt: 0 },
        { key: nonEmpty, messageCount: 1, updatedAt: 0 },
      ]),
      getSessionInfo: vi.fn(async () => ({ generatedShell: true })),
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
      listSessions: vi.fn(async () => [{ key: GENERATED_KEY, generatedShell: true, messageCount: 0, updatedAt: 90_000 }]),
      getSessionInfo: vi.fn(async () => ({ generatedShell: true })),
      getSessionStats: vi.fn(async () => EMPTY_STATS),
      deleteSession,
    };

    await expect(cleanupAbandonedTuiSessions(client, "47266c46-b6a1-4102-8ef2-7f614bd2b238", 100_000)).resolves.toEqual([]);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
