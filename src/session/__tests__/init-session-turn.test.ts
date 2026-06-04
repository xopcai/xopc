import { describe, expect, it, vi, beforeEach } from 'vitest';

import { initSessionTurn } from '../init-session-turn.js';
import type { Config } from '../../config/schema.js';

vi.mock('../parity/sessions-json-file.js', () => ({
  readSessionsJsonFile: vi.fn(),
}));

import { readSessionsJsonFile } from '../parity/sessions-json-file.js';

const baseCfg = {
  session: {
    scope: 'per-sender' as const,
    mainKey: 'main',
    dmScope: 'main' as const,
    reset: { mode: 'daily' as const, atHour: 4 },
  },
} as Config;

const sessionKey = 'agent:main:telegram:default:direct:1';

function mockExistingEntry(sessionStartedAt: number) {
  vi.mocked(readSessionsJsonFile).mockResolvedValue({
    [sessionKey]: {
      sessionId: 'old-id',
      sessionFile: 'old-id.jsonl',
      updatedAt: Date.now(),
      sessionStartedAt,
      pluginExtensions: {
        xopc: {
          metadata: {
            updatedAt: new Date().toISOString(),
            sourceChannel: 'telegram',
          },
        },
      },
    },
  } as never);
}

describe('initSessionTurn', () => {
  beforeEach(() => {
    vi.mocked(readSessionsJsonFile).mockResolvedValue({});
  });

  it('calls resetSession on explicit /new trigger when session exists', async () => {
    mockExistingEntry(Date.now());
    const resetSession = vi.fn().mockResolvedValue({
      sessionId: 'new-id',
      previousSessionId: 'old-id',
    });

    const result = await initSessionTurn({
      cfg: baseCfg,
      sessionKey,
      body: '/new',
      resetSession,
    });

    expect(resetSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      resetTriggered: true,
      bareReset: true,
      isNewSession: true,
      sessionId: 'new-id',
      previousSessionId: 'old-id',
      ackMessage: '✅ New session started.',
    });
  });

  it('calls resetSession on stale daily rollover without trigger', async () => {
    mockExistingEntry(Date.now() - 48 * 60 * 60_000);
    const resetSession = vi.fn().mockResolvedValue({
      sessionId: 'fresh-id',
      previousSessionId: 'old-id',
    });

    const result = await initSessionTurn({
      cfg: baseCfg,
      sessionKey,
      body: 'hello after idle',
      resetSession,
    });

    expect(resetSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      resetTriggered: false,
      staleRollover: true,
      isNewSession: true,
      bodyStripped: 'hello after idle',
    });
  });

  it('strips tail after /reset and does not bare-ack', async () => {
    const resetSession = vi.fn().mockResolvedValue({
      sessionId: 'new-id',
      previousSessionId: 'old-id',
    });

    const result = await initSessionTurn({
      cfg: baseCfg,
      sessionKey: 'agent:main:main',
      body: '/reset continue here',
      resetSession,
    });

    expect(result.bodyStripped).toBe('continue here');
    expect(result.bareReset).toBe(false);
    expect(result.ackMessage).toBeUndefined();
  });

  it('does not call resetSession when session is fresh and no trigger', async () => {
    const resetSession = vi.fn();

    const result = await initSessionTurn({
      cfg: baseCfg,
      sessionKey: 'agent:main:brand-new-key',
      body: 'hello',
      resetSession,
    });

    expect(resetSession).not.toHaveBeenCalled();
    expect(result.resetTriggered).toBe(false);
    expect(result.bodyStripped).toBe('hello');
    expect(result.isNewSession).toBe(true);
  });
});
