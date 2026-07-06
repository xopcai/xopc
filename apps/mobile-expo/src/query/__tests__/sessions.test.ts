import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSession, fetchSessionActiveRun, fetchSessionsList } from '../sessions';
import { sessionDisplayName } from '../../lib/session-helpers';
import { apiFetch } from '../../api/client';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  notifyUnauthorizedIfNeeded: vi.fn(),
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
}));

vi.mock('../../api/dual-fire-fetch', () => ({
  dualFireFetch: vi.fn(),
  hasCachedRouteWinner: vi.fn(() => true),
}));

vi.mock('../../features/gateway/sessions-cache', () => ({
  readCachedSessions: vi.fn(() => null),
  writeCachedSessions: vi.fn(),
  clearCachedSessions: vi.fn(),
}));

vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ activeGatewayId: null })),
  }),
}));

const mockedApiFetch = vi.mocked(apiFetch);

describe('createSession', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        session: {
          key: 'agent:main:webchat:default:direct:chat_test',
          sessionId: 'sess_test',
        },
      }),
    } as Response);
  });

  it('creates webchat sessions without client-generated peer ids', async () => {
    await createSession('MainAgent');

    const [, init] = mockedApiFetch.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(body.channel).toBe('webchat');
    expect(body.agentId).toBe('mainagent');
    expect(body).toEqual({ channel: 'webchat', agentId: 'mainagent' });
  });

  it('does not send client session identity by default so empty sessions can be reused', async () => {
    await createSession('MainAgent');

    const [, init] = mockedApiFetch.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(body).toEqual({ channel: 'webchat', agentId: 'mainagent' });
  });
});

describe('fetchSessionsList', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, limit: 20, offset: 0, hasMore: false }),
    } as Response);
  });

  it('forwards limit, offset, and search into the URL query string', async () => {
    await fetchSessionsList({ limit: 20, offset: 40, search: '  hello  ' });

    const [url] = mockedApiFetch.mock.calls[0] as [string];
    expect(url.startsWith('/api/sessions?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('40');
    expect(params.get('search')).toBe('hello');
    expect(params.get('channel')).toBe('webchat');
  });

  it('omits the search param when empty', async () => {
    await fetchSessionsList({ limit: 20, offset: 0 });

    const [url] = mockedApiFetch.mock.calls[0] as [string];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.has('search')).toBe(false);
    expect(params.get('offset')).toBe('0');
  });

  it('normalizes title into name for list display', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            key: 'agent:main:webchat:default:direct:chat_a',
            title: '真实会话标题',
            messageCount: 2,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
    } as Response);

    const page = await fetchSessionsList({ limit: 20, offset: 0 });

    expect(page.items[0].name).toBe('真实会话标题');
  });

  it('does not expose session key when title is missing', async () => {
    const title = sessionDisplayName({
      key: 'agent:main:webchat:default:direct:chat_1781231485063_5yf0uh',
      messageCount: 0,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    expect(title).toBe('New chat');
  });

  it('returns the full pagination payload', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { key: 'agent:main:webchat:default:direct:chat_a', messageCount: 2, updatedAt: '2026-01-01T00:00:00Z' },
        ],
        total: 42,
        limit: 20,
        offset: 0,
        hasMore: true,
      }),
    } as Response);

    const page = await fetchSessionsList({ limit: 20, offset: 0 });
    expect(page.total).toBe(42);
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].key).toBe('agent:main:webchat:default:direct:chat_a');
  });
});

describe('fetchSessionActiveRun', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('returns active run id from the gateway source of truth', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ payload: { active: true, runId: ' run-123 ' } }),
    } as Response);

    await expect(fetchSessionActiveRun('agent:main:webchat:default:direct:chat_a')).resolves.toEqual({
      active: true,
      runId: 'run-123',
    });

    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/api/sessions/agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_a/run',
    );
  });

  it('treats missing or inactive runs as inactive', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ payload: { active: false } }),
    } as Response);

    await expect(fetchSessionActiveRun('session-a')).resolves.toEqual({ active: false });
  });

  it('returns inactive when the session is missing', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    await expect(fetchSessionActiveRun('missing')).resolves.toEqual({ active: false });
  });
});
