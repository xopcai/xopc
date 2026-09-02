import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  activeRouteId: 'secure-link',
  selectRoute: vi.fn((_: string, routeId: string) => { gateway.activeRouteId = routeId; }),
  profile: {
    gatewayId: 'gateway-1',
    routes: [
      { id: 'secure-link', url: 'https://primary.gateway' },
      { id: 'tailscale', url: 'https://backup.gateway' },
    ],
  },
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
    constructor(uri: string) { nativeFile.uris.push(uri); }
  },
}));

vi.mock('../../features/gateway/device-auth-session', () => ({
  getDeviceAccessToken: vi.fn(async () => 'access-token'),
  refreshDeviceAccessToken: vi.fn(async () => 'refreshed-access-token'),
}));

vi.mock('../../features/gateway/connection-log', () => ({ recordConnectionEvent: vi.fn() }));
vi.mock('../../features/gateway/network-info', () => ({
  getNetworkSnapshot: () => ({ kind: 'wifi', key: 'wifi:test' }),
}));
vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({
      activeGatewayId: 'gateway-1',
      getActiveProfile: () => ({ ...gateway.profile, activeRouteId: gateway.activeRouteId }),
      selectRoute: gateway.selectRoute,
      onUnauthorized: vi.fn(),
    }),
  },
}));

import { apiFetch, apiUploadFile } from '../client';

describe('mobile gateway client', () => {
  beforeEach(() => {
    gateway.activeRouteId = 'secure-link';
    gateway.selectRoute.mockClear();
    nativeFile.exists = true;
    nativeFile.size = 1024;
    nativeFile.uris.length = 0;
    nativeFile.upload.mockReset();
    vi.restoreAllMocks();
  });

  it('tries secure routes sequentially for a replay-safe write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const response = await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ kind: 'voice' }),
      recoverRouteOnNetworkError: true,
    });

    expect(response.status).toBe(201);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://primary.gateway/api/notes',
      'https://backup.gateway/api/notes',
    ]);
    expect(gateway.selectRoute).toHaveBeenCalledWith('gateway-1', 'tailscale');
  });

  it('uploads readable local files with device access', async () => {
    nativeFile.upload.mockResolvedValue({ body: '{}', status: 201, headers: {} });
    const response = await apiUploadFile('/api/voice/transcriptions', {
      uri: 'file:///recording.m4a', fieldName: 'audio', mimeType: 'audio/mp4',
    });
    expect(response.status).toBe(201);
    expect(nativeFile.upload).toHaveBeenCalledWith(
      'https://primary.gateway/api/voice/transcriptions',
      expect.objectContaining({ headers: { Authorization: 'Bearer access-token' } }),
    );
  });

  it('rejects missing or empty recordings before starting a request', async () => {
    nativeFile.exists = false;
    await expect(apiUploadFile('/api/media', { uri: 'file:///missing', fieldName: 'file', mimeType: 'audio/mp4' }))
      .rejects.toThrow('Recording file is no longer available');
    nativeFile.exists = true;
    nativeFile.size = 0;
    await expect(apiUploadFile('/api/media', { uri: 'file:///empty', fieldName: 'file', mimeType: 'audio/mp4' }))
      .rejects.toThrow('Recording file is empty');
    expect(nativeFile.upload).not.toHaveBeenCalled();
  });
});
