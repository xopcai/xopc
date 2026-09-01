import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  activeBaseUrl: 'http://lan.gateway',
  baseUrl: 'https://tunnel.gateway',
  lanUrl: 'http://lan.gateway',
  token: 'token-1',
  refreshActiveBaseUrl: vi.fn(),
}));

const nativeFile = vi.hoisted(() => ({
  exists: true,
  size: 1024,
  uris: [] as string[],
  upload: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  UploadType: { MULTIPART: 1 },
  File: class MockFile {
    exists = nativeFile.exists;
    size = nativeFile.size;
    upload = nativeFile.upload;

    constructor(uri: string) {
      nativeFile.uris.push(uri);
    }
  },
}));

vi.mock('../../features/gateway/connection-log', () => ({
  recordConnectionEvent: vi.fn(),
}));

vi.mock('../../features/gateway/network-info', () => ({
  getNetworkSnapshot: () => ({ kind: 'wifi', key: 'wifi:test' }),
}));

vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({
      ...gateway,
      apiUrl: (path: string) => `${gateway.activeBaseUrl}${path}`,
      refreshActiveBaseUrl: gateway.refreshActiveBaseUrl,
    }),
  },
}));

vi.mock('../dual-fire-fetch', () => ({
  dualFireFetch: vi.fn(),
  hasCachedRouteWinner: vi.fn(() => true),
}));

vi.mock('../notify-unauthorized', () => ({
  notifyUnauthorizedIfNeeded: vi.fn(),
}));

import { apiFetch, apiUploadFile } from '../client';

describe('apiFetch route recovery', () => {
  beforeEach(() => {
    gateway.activeBaseUrl = gateway.lanUrl;
    gateway.refreshActiveBaseUrl.mockReset();
    gateway.refreshActiveBaseUrl.mockImplementation(async () => {
      gateway.activeBaseUrl = gateway.baseUrl;
      return gateway.activeBaseUrl;
    });
    nativeFile.exists = true;
    nativeFile.size = 1024;
    nativeFile.uris.length = 0;
    nativeFile.upload.mockReset();
    vi.restoreAllMocks();
  });

  it('re-resolves LAN versus tunnel and retries an explicitly replay-safe POST once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const response = await apiFetch('/api/notes', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'voice-operation-1' },
      body: JSON.stringify({ kind: 'voice' }),
      recoverRouteOnNetworkError: true,
    });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://lan.gateway/api/notes');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://tunnel.gateway/api/notes');
  });

  it('uploads readable local files through the native multipart task', async () => {
    nativeFile.upload.mockResolvedValue({
      body: JSON.stringify({ ok: true }),
      status: 201,
      headers: { 'content-type': 'application/json' },
    });

    const response = await apiUploadFile('/api/voice/transcriptions', {
      uri: 'file:///data/user/0/ai.xopc.xopc/cache/Audio/recording.m4a',
      fieldName: 'audio',
      mimeType: 'audio/mp4',
      parameters: { language: 'zh-CN' },
      timeoutMs: 60_000,
    });

    expect(response.status).toBe(201);
    expect(nativeFile.uris).toEqual([
      'file:///data/user/0/ai.xopc.xopc/cache/Audio/recording.m4a',
    ]);
    expect(nativeFile.upload).toHaveBeenCalledWith(
      'http://lan.gateway/api/voice/transcriptions',
      expect.objectContaining({
        httpMethod: 'POST',
        uploadType: 1,
        fieldName: 'audio',
        mimeType: 'audio/mp4',
        parameters: { language: 'zh-CN' },
        headers: { Authorization: 'Bearer token-1' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects missing or empty recordings before starting a request', async () => {
    nativeFile.exists = false;
    await expect(apiUploadFile('/api/media', {
      uri: 'file:///missing.m4a',
      fieldName: 'file',
      mimeType: 'audio/mp4',
    })).rejects.toThrow('Recording file is no longer available');

    nativeFile.exists = true;
    nativeFile.size = 0;
    await expect(apiUploadFile('/api/media', {
      uri: 'file:///empty.m4a',
      fieldName: 'file',
      mimeType: 'audio/mp4',
    })).rejects.toThrow('Recording file is empty');

    expect(nativeFile.upload).not.toHaveBeenCalled();
  });

  it('creates a fresh native upload after recovering the active gateway route', async () => {
    nativeFile.upload
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ body: '{}', status: 200, headers: {} });

    const response = await apiUploadFile('/api/voice/transcriptions', {
      uri: 'file:///recording.m4a',
      fieldName: 'audio',
      mimeType: 'audio/mp4',
      recoverRouteOnNetworkError: true,
    });

    expect(response.status).toBe(200);
    expect(nativeFile.upload).toHaveBeenCalledTimes(2);
    expect(nativeFile.upload.mock.calls[0]?.[0]).toBe(
      'http://lan.gateway/api/voice/transcriptions',
    );
    expect(nativeFile.upload.mock.calls[1]?.[0]).toBe(
      'https://tunnel.gateway/api/voice/transcriptions',
    );
  });
});
