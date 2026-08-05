import { describe, expect, it, vi } from 'vitest';

import { XopcCloudAccountError, XopcCloudAccountService } from '../xopc-cloud-account-service.js';

const summary = {
  balance: { credits: 84_320, updatedAt: '2026-08-05T08:30:00.000Z' },
  usage: {
    days: 7 as const,
    requests: 38,
    inputTokens: 98_420,
    outputTokens: 28_060,
    totalTokens: 126_480,
    errors: 1,
    averageLatencyMs: 842,
    chargedCredits: 1_842,
  },
  links: {
    details: 'https://console.xopc.ai/models',
    purchase: 'https://console.xopc.ai/models/billing',
  },
};

describe('XopcCloudAccountService', () => {
  it('does not call XOPC Cloud when its OAuth credential is not configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new XopcCloudAccountService({
      fetchImpl,
      credentials: { resolveApiKey: async () => null },
    });

    await expect(service.getSummary()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('loads the account summary using the XOPC Cloud access token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://router.test/v1/account/summary?days=7');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-access');
      return Response.json(summary);
    });
    const service = new XopcCloudAccountService({
      fetchImpl,
      routerUrl: 'https://router.test/v1/',
      credentials: { resolveApiKey: async () => 'oauth-access' },
    });

    await expect(service.getSummary()).resolves.toEqual(summary);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('preserves structured account service errors', async () => {
    const service = new XopcCloudAccountService({
      fetchImpl: async () => Response.json({
        error: { message: 'OAuth grant revoked', code: 'invalid_token' },
      }, { status: 401 }),
      credentials: { resolveApiKey: async () => 'expired-token' },
    });

    await expect(service.getSummary()).rejects.toMatchObject<XopcCloudAccountError>({
      name: 'XopcCloudAccountError',
      status: 401,
      code: 'invalid_token',
      message: 'OAuth grant revoked',
    });
  });
});
