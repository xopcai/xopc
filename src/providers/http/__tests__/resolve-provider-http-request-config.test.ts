import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { resolveProviderHttpRequestConfig } from '../resolve-provider-http-request-config.js';

function cfgWith(providers: Record<string, unknown>): Config {
  return { providers } as unknown as Config;
}

describe('resolveProviderHttpRequestConfig', () => {
  it('returns fallbacks when cfg has nothing', () => {
    const r = resolveProviderHttpRequestConfig({
      providerId: 'openai',
      fallbackTimeoutMs: 60_000,
      fallbackHeaders: { 'user-agent': 'xopc/test' },
    });
    expect(r.timeoutMs).toBe(60_000);
    expect(r.headers['user-agent']).toBe('xopc/test');
  });

  it('cfg.providers.<id>.request.timeoutMs wins over provider-level and fallback', () => {
    const cfg = cfgWith({
      openai: {
        timeoutMs: 30_000,
        request: { timeoutMs: 5_000 },
      },
    });
    const r = resolveProviderHttpRequestConfig({ providerId: 'openai', cfg, fallbackTimeoutMs: 60_000 });
    expect(r.timeoutMs).toBe(5_000);
  });

  it('falls through to provider-level timeoutMs when request.timeoutMs is absent', () => {
    const cfg = cfgWith({ openai: { timeoutMs: 12_345 } });
    const r = resolveProviderHttpRequestConfig({ providerId: 'openai', cfg, fallbackTimeoutMs: 60_000 });
    expect(r.timeoutMs).toBe(12_345);
  });

  it('merges fallback + provider + request headers (request wins on conflict)', () => {
    const cfg = cfgWith({
      openai: {
        headers: { 'x-trace': 'provider', 'x-extra': 'p' },
        request: { headers: { 'x-trace': 'request' } },
      },
    });
    const r = resolveProviderHttpRequestConfig({
      providerId: 'openai',
      cfg,
      fallbackHeaders: { 'user-agent': 'xopc', 'x-trace': 'fallback' },
    });
    expect(r.headers).toEqual({
      'user-agent': 'xopc',
      'x-trace': 'request',
      'x-extra': 'p',
    });
  });

  it('skips invalid timeout values', () => {
    const cfg = cfgWith({
      openai: { request: { timeoutMs: -1 }, timeoutMs: 'oops' },
    });
    const r = resolveProviderHttpRequestConfig({ providerId: 'openai', cfg, fallbackTimeoutMs: 9_000 });
    expect(r.timeoutMs).toBe(9_000);
  });

  it('returns empty headers when no source provides any', () => {
    const r = resolveProviderHttpRequestConfig({ providerId: 'unknown' });
    expect(r.headers).toEqual({});
    expect(r.timeoutMs).toBeUndefined();
  });
});
