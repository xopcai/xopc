import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  pendingAgentRunStorageKey,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import { fetchSessionActiveRun, resolveResumeRunId } from '@/features/chat/session/resolve-resume-run-id';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';

vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({ token: 'test-token', onUnauthorized: () => {} }),
  },
}));

import { apiFetch } from '@/lib/fetch';

describe('resolveResumeRunId', () => {
  const sessionKey = 'main:webchat:default:direct:abc';
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    storage.clear();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
    });
  });

  it('fetchSessionActiveRun reads gateway payload', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ payload: { active: true, runId: 'run-gateway' } }),
    } as Response);

    await expect(fetchSessionActiveRun(sessionKey)).resolves.toEqual({
      active: true,
      runId: 'run-gateway',
    });
  });

  it('prefers gateway active run and syncs sessionStorage', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ payload: { active: true, runId: 'run-gateway' } }),
    } as Response);

    const runId = await resolveResumeRunId(sessionKey);
    expect(runId).toBe('run-gateway');
    expect(sessionStorage.getItem(pendingAgentRunStorageKey(sessionKey))).toContain('run-gateway');
  });

  it('falls back to sessionStorage when gateway reports inactive', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ payload: { active: false } }),
    } as Response);
    setPendingAgentRun(sessionKey, 'run-local');

    const runId = await resolveResumeRunId(sessionKey);
    expect(runId).toBe('run-local');
  });
});

describe('selectDisplayMessages', () => {
  it('returns empty when view key mismatches session key', () => {
    expect(
      selectDisplayMessages({
        viewSessionKey: 'a',
        sessionKey: 'b',
        messages: [{ role: 'user', content: [], timestamp: 1 }],
        streamingMsg: null,
      }),
    ).toEqual([]);
  });
});
