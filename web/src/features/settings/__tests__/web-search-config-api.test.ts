import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasUsableManualSearchProvider, normalizeWebSearchSettingsFromConfig, patchWebSearchSettings } from '../web-search-config-api';

const request = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/fetch', () => ({ fetchJson: request }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/features/gateway/gateway-config-swr', () => ({ revalidateGatewayConfig: vi.fn() }));
afterEach(() => request.mockClear());

describe('DeepSeek search settings', () => {
  it('round trips provider identity, API key and custom URL through settings saves', async () => {
    const form = normalizeWebSearchSettingsFromConfig({ tools: { web: { search: { maxResults: 5, providers: [
      { type: 'deepseek', apiKey: 'masked-key', url: 'https://proxy.example/v1/' },
    ] } } } });
    expect(form.providers[0]?.type).toBe('deepseek');
    expect(hasUsableManualSearchProvider(form.providers)).toBe(true);
    await patchWebSearchSettings(form);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/config');
    expect(JSON.parse(String(init.body)).tools.web.search.providers).toEqual([
      { type: 'deepseek', apiKey: 'masked-key', url: 'https://proxy.example/v1' },
    ]);
    expect(hasUsableManualSearchProvider(form.providers.map(row => ({ ...row, disabled: true })))).toBe(false);
  });
});
