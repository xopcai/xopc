import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ getActiveProfile: () => ({ routes: [{ url: 'https://gateway.example' }] }) }) } }));
vi.mock('../client', () => ({ apiFetch: vi.fn(async () => Response.json({})) }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn(async () => Response.json({})) }));
import { fetch } from 'expo/fetch';
import { apiFetch } from '../client';
import { fetchGatewayAsset, fetchPublicAsset, gatewayAssetPath } from '../gateway-assets';
beforeEach(() => vi.clearAllMocks());
it('rejects malformed, credential-bearing and different-origin private asset URLs before transport', () => {
  for (const uri of ['https://', 'https://evil.example/a', 'https://gateway.example.evil/a', 'https://user@gateway.example/a']) {
    expect(gatewayAssetPath(uri)).toBeNull();
    expect(() => fetchGatewayAsset(uri)).toThrow('GATEWAY_ASSET_ORIGIN_MISMATCH');
  }
  expect(apiFetch).not.toHaveBeenCalled();
});
it('uses verified transport for private assets and strips all credentials for public assets', async () => {
  await fetchGatewayAsset('https://gateway.example/api/avatar?v=2');
  expect(apiFetch).toHaveBeenCalledWith('/api/avatar?v=2', expect.objectContaining({ timeoutMs: 30000 }));
  await fetchPublicAsset('https://share.example/image', { headers: { Authorization: 'Bearer secret' }, credentials: 'include', redirect: 'follow' });
  expect(fetch).toHaveBeenCalledWith('https://share.example/image', expect.objectContaining({ headers: undefined, credentials: 'omit', redirect: 'error' }));
});
