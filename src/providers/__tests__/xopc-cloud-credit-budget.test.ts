import { afterEach, describe, expect, it, vi } from 'vitest';

import { XopcCloudAccountService } from '../xopc-cloud-account-service.js';
import { cloudCreditBudgetHeaders, withCloudCreditBudget, reportCloudCreditError, assertCloudCreditBudgetActive, rejectUnbudgetedCloudTransport } from '../xopc-cloud-credit-budget.js';

const budget = { id: '00000000-0000-4000-8000-000000000001', limitCreditMicro: '10000', remainingCreditMicro: '10000', reservedCreditMicro: '0', chargedCreditMicro: '0', revision: 1, createdAt: 1 };
const options = { conversationId: 'conversation', runId: 'run', limitCreditMicro: '10000' };

describe('Cloud run budget scope', () => {
  afterEach(() => vi.restoreAllMocks());
  it('creates once for parallel calls and shares the parent scope with children', async () => {
    const create = vi.spyOn(XopcCloudAccountService.prototype, 'createBudget').mockResolvedValue(budget);
    await withCloudCreditBudget(options, async () => {
      const [a, b] = await Promise.all([
        cloudCreditBudgetHeaders(),
        withCloudCreditBudget({ ...options, runId: 'child', limitCreditMicro: '20000' }, () => cloudCreditBudgetHeaders()),
      ]);
      expect(a).toEqual({ 'x-xopc-credit-budget': budget.id });
      expect(b).toEqual(a);
    });
    expect(create).toHaveBeenCalledOnce();
    const key = create.mock.calls[0][1];
    await withCloudCreditBudget(options, () => cloudCreditBudgetHeaders());
    expect(create.mock.calls[1][1]).toBe(key);
    expect(await cloudCreditBudgetHeaders()).toEqual({});
  });
  it('stays lazy for BYOK-only runs and isolates simultaneous runs', async () => {
    const create = vi.spyOn(XopcCloudAccountService.prototype, 'createBudget').mockResolvedValue(budget);
    await withCloudCreditBudget(options, async () => 'byok');
    expect(create).not.toHaveBeenCalled();
    await Promise.all([
      withCloudCreditBudget(options, () => cloudCreditBudgetHeaders()),
      withCloudCreditBudget({ ...options, runId: 'other' }, () => cloudCreditBudgetHeaders()),
    ]);
    expect(create.mock.calls[0][1]).not.toBe(create.mock.calls[1][1]);
  });
  it('does not proceed without a budget when creation fails', async () => {
    const create = vi.spyOn(XopcCloudAccountService.prototype, 'createBudget').mockRejectedValue(new Error('network down'));
    await withCloudCreditBudget(options, async () => {
      await expect(cloudCreditBudgetHeaders()).rejects.toThrow('network down');
      await expect(cloudCreditBudgetHeaders()).rejects.toThrow('network down');
    });
    expect(create).toHaveBeenCalledOnce();
  });
  it('stops all subsequent calls at exhaustion and rejects unsupported transport', async () => {
    await withCloudCreditBudget(options, async () => {
      expect(() => rejectUnbudgetedCloudTransport()).toThrow('do not support realtime voice');
      reportCloudCreditError('credit_budget_exhausted: Credit task budget exhausted');
      expect(() => assertCloudCreditBudgetActive()).toThrow('credit_budget_exhausted');
      await expect(cloudCreditBudgetHeaders()).rejects.toThrow('credit_budget_exhausted');
    });
    expect(() => assertCloudCreditBudgetActive()).not.toThrow();
  });
});
