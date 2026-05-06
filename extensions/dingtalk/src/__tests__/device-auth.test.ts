import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginDingtalkRegistration, pollDingtalkRegistration } from '../auth/device-auth.js';

describe('device-auth', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('beginDingtalkRegistration returns verification URI from init+begin', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/app/registration/init')) {
        return {
          json: async () => ({ errcode: 0, nonce: 'nonce-abc' }),
        };
      }
      if (u.endsWith('/app/registration/begin')) {
        return {
          json: async () => ({
            errcode: 0,
            device_code: 'dev-1',
            verification_uri_complete: 'https://example.com/verify?x=1',
            verification_uri: 'https://example.com/verify',
            user_code: 'USER1',
            expires_in: 100,
            interval: 2,
          }),
        };
      }
      throw new Error(`unexpected url ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await beginDingtalkRegistration();
    expect(r.deviceCode).toBe('dev-1');
    expect(r.verificationUriComplete).toBe('https://example.com/verify?x=1');
    expect(r.userCode).toBe('USER1');
    expect(r.expiresInSeconds).toBe(100);
    expect(r.intervalSeconds).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pollDingtalkRegistration maps SUCCESS and credentials', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({
        errcode: 0,
        status: 'SUCCESS',
        client_id: 'cid',
        client_secret: 'csec',
      }),
    })) as unknown as typeof fetch;

    const r = await pollDingtalkRegistration({ deviceCode: 'dev-1' });
    expect(r.status).toBe('SUCCESS');
    expect(r.clientId).toBe('cid');
    expect(r.clientSecret).toBe('csec');
  });

  it('pollDingtalkRegistration maps WAITING', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ errcode: 0, status: 'WAITING' }),
    })) as unknown as typeof fetch;

    const r = await pollDingtalkRegistration({ deviceCode: 'dev-1' });
    expect(r.status).toBe('WAITING');
  });

  it('pollDingtalkRegistration throws on API error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ errcode: 400, errmsg: 'bad' }),
    })) as unknown as typeof fetch;

    await expect(pollDingtalkRegistration({ deviceCode: 'dev-1' })).rejects.toThrow(/poll/);
  });
});
