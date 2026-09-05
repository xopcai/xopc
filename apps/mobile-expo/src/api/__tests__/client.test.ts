import { beforeEach, describe, expect, it, vi } from 'vitest';

const consent = vi.hoisted(() => ({ authorize: vi.fn(async () => {}) }));
vi.mock('../../features/privacy/data-sharing-consent', () => ({ authorizeMobileRequest: consent.authorize }));

const gateway = vi.hoisted(() => ({
  activeGatewayId: 'gateway-1',
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
      activeGatewayId: gateway.activeGatewayId,
      getActiveProfile: () => ({ ...gateway.profile, activeRouteId: gateway.activeRouteId }),
      selectRoute: gateway.selectRoute,
      onUnauthorized: vi.fn(),
    }),
  },
}));

import { apiFetch, apiUploadFile } from '../client';

describe('mobile gateway client', () => {
  beforeEach(() => {
    gateway.activeGatewayId = 'gateway-1';
    consent.authorize.mockReset().mockResolvedValue(undefined);
    gateway.activeRouteId = 'secure-link';
    gateway.selectRoute.mockClear();
    nativeFile.exists = true;
    nativeFile.size = 1024;
    nativeFile.uris.length = 0;
    nativeFile.upload.mockReset();
    vi.restoreAllMocks();
  });

  it('does not send content when authorization is denied', async () => {
    consent.authorize.mockRejectedValue(new Error('Permission declined'));
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(apiFetch('/api/notes', { method: 'POST', body: '{"title":"private"}' })).rejects.toThrow('Permission declined');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not upload audio when authorization is denied', async () => {
    consent.authorize.mockRejectedValue(new Error('Permission declined'));
    await expect(apiUploadFile('/api/voice/transcriptions', { uri: 'file:///voice.m4a', fieldName: 'audio', mimeType: 'audio/mp4' })).rejects.toThrow('Permission declined');
    expect(nativeFile.upload).not.toHaveBeenCalled();
  });

  it('does not send a queued payload to a gateway selected during authorization', async () => {
    consent.authorize.mockImplementation(async () => { gateway.activeGatewayId = 'gateway-2'; });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(apiFetch('/api/notes', { method: 'POST', body: '{}' })).rejects.toThrow('Active gateway changed');
    expect(fetchMock).not.toHaveBeenCalled();
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
  it('returns the exact ticket route even if the selected route changes during the request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      gateway.activeRouteId = 'tailscale';
      return new Response('{}', { status: 201 });
    });
    const origin = vi.fn();
    await apiFetch('/api/voice/realtime/sessions', { method: 'POST', onResolvedOrigin: origin });
    expect(origin).toHaveBeenCalledExactlyOnceWith('https://primary.gateway');
  });
  it('does not replay an ambiguous voice ticket creation on another route', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const origin = vi.fn();
    await expect(apiFetch('/api/voice/realtime/sessions', { method: 'POST', onResolvedOrigin: origin })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(origin).not.toHaveBeenCalled();
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
