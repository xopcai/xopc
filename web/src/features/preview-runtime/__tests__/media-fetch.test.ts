import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('@/lib/fetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/lib/url', () => ({
  apiUrl: (path: string) => path,
}));

import { fetchMediaUriBlob } from '../media-fetch';

describe('fetchMediaUriBlob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockResolvedValue(new Response('file', { status: 200 }));
  });

  it('loads canonical workspace file artifacts through the files API', async () => {
    const result = await fetchMediaUriBlob({
      uri: 'xopc-file:space-id.cmVwb3J0cy9zYWxlcy54bHN4',
      sessionKey: 'session-1',
    });

    expect(result.ok).toBe(true);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/files/space-id.cmVwb3J0cy9zYWxlcy54bHN4/content',
    );
  });

  it('keeps persisted media on the media endpoint', async () => {
    await fetchMediaUriBlob({ uri: 'media://outbound/report.xlsx', sessionKey: 'session-1' });

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/media/read?uri=media%3A%2F%2Foutbound%2Freport.xlsx&sessionKey=session-1',
    );
  });
});
