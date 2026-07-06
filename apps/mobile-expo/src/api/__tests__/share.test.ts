import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAutoShare,
  extendShare,
  listShares,
  probeThumbnail,
  revokeShare,
} from '../share';
import { apiFetch } from '../client';

vi.mock('../client', () => ({
  apiFetch: vi.fn(),
  notifyUnauthorizedIfNeeded: vi.fn(),
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

function errJson(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    statusText: 'Bad Request',
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe('createAutoShare', () => {
  it('posts to /api/shares/auto and unwraps the payload', async () => {
    const payload = {
      share: {
        id: 'sh1',
        kind: 'site',
        title: 'plan',
        description: '',
        shareUrl: 'https://abc.share.xopc.ai/',
        lanUrl: null,
        reachability: 'public',
        reachabilityHint: null,
        expiresAt: '2026-06-06T00:00:00Z',
        maxViews: null,
      },
      thumbnail: { url: 'https://abc.share.xopc.ai/thumbnail', status: 'pending', width: 1200, height: 630 },
      routing: { reason: 'html-single-file', hint: 'HTML 文件' },
    };
    mockedApiFetch.mockResolvedValue(okJson({ ok: true, payload }));

    const result = await createAutoShare({ path: 'plan.html', audience: 'friend' });

    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/api/shares/auto',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = mockedApiFetch.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { path: string; audience: string };
    expect(body.path).toBe('plan.html');
    expect(body.audience).toBe('friend');
    expect(result).toEqual(payload);
  });

  it('surfaces server error messages', async () => {
    mockedApiFetch.mockResolvedValue(
      errJson(400, { error: { message: 'workspace not configured' } }),
    );
    await expect(createAutoShare({ path: 'x' })).rejects.toThrow(/workspace not configured/);
  });
});

describe('listShares', () => {
  it('returns payload.shares array', async () => {
    mockedApiFetch.mockResolvedValue(
      okJson({ ok: true, payload: { shares: [{ id: 'a' }, { id: 'b' }] } }),
    );
    const list = await listShares();
    expect(list).toHaveLength(2);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/shares');
  });
});

describe('revokeShare', () => {
  it('DELETEs /api/shares/:id and url-encodes the id', async () => {
    mockedApiFetch.mockResolvedValue(okJson({ ok: true }));
    await revokeShare('id with spaces');
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/api/shares/id%20with%20spaces',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('extendShare', () => {
  it('PATCHes with the provided patch body', async () => {
    mockedApiFetch.mockResolvedValue(okJson({ ok: true }));
    await extendShare('sh1', { extendTtlMs: 86_400_000 });
    const [, init] = mockedApiFetch.mock.calls[0];
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ extendTtlMs: 86_400_000 });
  });
});

describe('probeThumbnail', () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ready on 200 and sends a HEAD with Authorization', async () => {
    fetchMock.mockResolvedValue({ status: 200 } as Response);
    const s = await probeThumbnail('https://x/thumb', 'tok');
    expect(s).toBe('ready');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe('HEAD');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('returns pending on 202', async () => {
    fetchMock.mockResolvedValue({ status: 202 } as Response);
    expect(await probeThumbnail('https://x/thumb', undefined)).toBe('pending');
  });

  it('returns gone on 404 / 410', async () => {
    fetchMock.mockResolvedValueOnce({ status: 404 } as Response);
    expect(await probeThumbnail('https://x/thumb', undefined)).toBe('gone');
    fetchMock.mockResolvedValueOnce({ status: 410 } as Response);
    expect(await probeThumbnail('https://x/thumb', undefined)).toBe('gone');
  });

  it('returns unknown on network error', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    expect(await probeThumbnail('https://x/thumb', undefined)).toBe('unknown');
  });

  it('returns unknown when url is empty', async () => {
    expect(await probeThumbnail('', undefined)).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
