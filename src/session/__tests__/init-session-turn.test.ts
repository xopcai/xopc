import { describe, expect, it, vi, beforeEach } from 'vitest';

import { initSessionTurn } from '../init-session-turn.js';
import type { Config } from '../../config/schema.js';
import { SessionStatus, type SessionMetadata } from '../types.js';

vi.mock('../../storage/sqlite/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage/sqlite/index.js')>();
  return {
    ...actual,
    isXopcDatabaseOpen: vi.fn(() => true),
    openXopcDatabase: vi.fn(),
    requireXopcDatabase: vi.fn(() => ({ db: {}, path: ':memory:' })),
    getSessionMetadata: vi.fn(),
  };
});

import { getSessionMetadata } from '../../storage/sqlite/index.js';

const baseCfg = {
  session: {
    scope: 'per-sender' as const,
    mainKey: 'main',
    dmScope: 'main' as const,
    reset: { mode: 'daily' as const, atHour: 4 },
  },
} as Config;

const conversationId = 'agent:main:telegram:default:direct:1';

function baseMetadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  const now = new Date().toISOString();
  return {
    key: conversationId,
    status: SessionStatus.ACTIVE,
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    messageCount: 0,
    estimatedTokens: 0,
    compactedCount: 0,
    sourceChannel: 'telegram',
    sourceChatId: 'default:direct:1',
    stats: { messageCount: 0, tokenCount: 0 },
    ...overrides,
  };
}

function mockExistingEntry(sessionStartedAt: number) {
  vi.mocked(getSessionMetadata).mockImplementation((key) => {
    if (key !== conversationId) {
      return null;
    }
    return baseMetadata({
      transcriptId: 'old-id',
      sessionStartedAt: new Date(sessionStartedAt).toISOString(),
    });
  });
}

describe('initSessionTurn', () => {
  beforeEach(() => {
    vi.mocked(getSessionMetadata).mockReturnValue(null);
  });

  it('calls resetSession on explicit /new trigger when session exists', async () => {
    mockExistingEntry(Date.now());
    const resetSession = vi.fn().mockResolvedValue({
      transcriptId: 'new-id',
      previousTranscriptId: 'old-id',
    });

    const result = await initSessionTurn({
      cfg: baseCfg,
      conversationId,
      body: '/new',
      resetSession,
    });

    expect(resetSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      resetTriggered: true,
      bareReset: true,
      isNewSession: true,
      transcriptId: 'new-id',
      previousTranscriptId: 'old-id',
      ackMessage: '✅ New session started.',
    });
  });

  it('calls resetSession on stale daily rollover without trigger', async () => {
    mockExistingEntry(Date.now() - 48 * 60 * 60_000);
    const resetSession = vi.fn().mockResolvedValue({
      transcriptId: 'fresh-id',
      previousTranscriptId: 'old-id',
    });

    const result = await initSessionTurn({
      cfg: baseCfg,
      conversationId,
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

  it('keeps a stale session when no implicit reset policy is configured', async () => {
    mockExistingEntry(Date.now() - 48 * 60 * 60_000);
    const resetSession = vi.fn();
    const cfg = {
      ...baseCfg,
      session: {
        scope: 'per-sender' as const,
        mainKey: 'main',
        dmScope: 'main' as const,
      },
    } as Config;

    const result = await initSessionTurn({
      cfg,
      conversationId,
      body: 'continue the same conversation',
      resetSession,
    });

    expect(resetSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      resetTriggered: false,
      staleRollover: false,
      isNewSession: false,
      transcriptId: 'old-id',
      bodyStripped: 'continue the same conversation',
    });
  });

  it('still honors explicit reset triggers without an implicit reset policy', async () => {
    mockExistingEntry(Date.now() - 48 * 60 * 60_000);
    const resetSession = vi.fn().mockResolvedValue({
      transcriptId: 'new-id',
      previousTranscriptId: 'old-id',
    });
    const cfg = {
      ...baseCfg,
      session: {
        scope: 'per-sender' as const,
        mainKey: 'main',
        dmScope: 'main' as const,
      },
    } as Config;

    const result = await initSessionTurn({
      cfg,
      conversationId,
      body: '/new',
      resetSession,
    });

    expect(resetSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      resetTriggered: true,
      staleRollover: false,
      isNewSession: true,
      transcriptId: 'new-id',
    });
  });

  it('strips tail after /reset and does not bare-ack', async () => {
    const resetSession = vi.fn().mockResolvedValue({
      transcriptId: 'new-id',
      previousTranscriptId: 'old-id',
    });

    const result = await initSessionTurn({
      cfg: baseCfg,
      conversationId: 'agent:main:main',
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
      conversationId: 'agent:main:brand-new-key',
      body: 'hello',
      resetSession,
    });

    expect(resetSession).not.toHaveBeenCalled();
    expect(result.resetTriggered).toBe(false);
    expect(result.bodyStripped).toBe('hello');
    expect(result.isNewSession).toBe(true);
  });
});
