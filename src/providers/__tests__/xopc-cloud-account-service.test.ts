import { describe, expect, it, vi } from 'vitest';

import { XopcCloudAccountError, XopcCloudAccountService } from '../xopc-cloud-account-service.js';

const summary = {
  schemaVersion: 2 as const,
  creditUnit: { unit: 'credit', microPerCredit: '10000', version: 'credit-v1', standardCreditsPerYuan: '100' },
  balance: { availableCreditMicro: '84320', purchasedCreditMicro: '84000', grantedCreditMicro: '320', usageReservedCreditMicro: '1000', refundReservedCreditMicro: '0', expiring: [], updatedAt: '2026-08-05T08:30:00.000Z' },
  usage: {
    days: 7 as const,
    requests: 38,
    inputTokens: 98_420,
    outputTokens: 28_060,
    totalTokens: 126_480,
    errors: 1,
    averageLatencyMs: 842,
    chargedCreditMicro: '1842',
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
      expect(String(input)).toBe('https://router.test/v1/account/summary?version=2&days=7');
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

  it.each([
    { ...summary, schemaVersion: 1 },
    { ...summary, creditUnit: { ...summary.creditUnit, microPerCredit: '1000000' } },
    { ...summary, balance: { ...summary.balance, availableCreditMicro: 84320 } },
    { ...summary, balance: { ...summary.balance, availableCreditMicro: '9007199254740992' } },
  ])('rejects ambiguous or unsupported wallet quantities', async body => {
    const service = new XopcCloudAccountService({ fetchImpl: async () => Response.json(body), credentials: { resolveApiKey: async () => 'token' } });
    await expect(service.getSummary()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('creates a budget using its stable key and exact quantity', async () => {
    const budget = { id: '00000000-0000-4000-8000-000000000001', limitCreditMicro: '100001', reservedCreditMicro: '0', chargedCreditMicro: '0', remainingCreditMicro: '100001', revision: 1, createdAt: 1 };
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://router.test/v1/account/budgets');
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('run-test-key');
      expect(JSON.parse(init?.body as string)).toEqual({ limitCreditMicro: '100001' });
      return Response.json({ creditUnit: summary.creditUnit, budget });
    });
    const service = new XopcCloudAccountService({ fetchImpl, routerUrl: 'https://router.test/v1', credentials: { resolveApiKey: async () => 'token' } });
    await expect(service.createBudget('100001', 'run-test-key')).resolves.toEqual(budget);
    await expect(service.createBudget('0', 'run-test-key')).rejects.toThrow('Invalid Credit budget');
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
