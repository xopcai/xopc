import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { getAiUsageEventView, insertAiUsageEvent, listAiUsageEvents, summarizeAiUsage } from '../../storage/sqlite/ai-usage-repository.js';
import { XopcCloudAccountService } from '../../providers/xopc-cloud-account-service.js';
import { reconcileCloudUsageReceipt, withCloudUsageResponse, withUsageReceiptContext, captureCloudUsageResponse } from '../cloud-receipts.js';
import { trackCloudCapabilityUsage } from '../cloud-capability.js';
import { runWithEmbeddedExecutionSession } from '../../agent/embedded/execution-context.js';

const receipt = { requestId: 'physical-request', model: 'cloud', state: 'reserved', reservedCreditMicro: '50000',
  chargedCreditMicro: null, releasedCreditMicro: '0', ratedCreditMicro: null, absorbedCreditMicro: null,
  priceSnapshot: null, createdAt: 1, settledAt: null };

describe('Cloud usage receipt correlation', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    insertAiUsageEvent({ id: 'usage', traceId: 'trace', provider: 'xopc-cloud', model: 'cloud',
      category: 'chat', operation: 'agent.answer', trigger: 'user', reasonKey: 'usage.reason.agentAnswer',
      status: 'running', startedAt: 1, costSource: 'unknown' });
  });
  afterEach(() => { vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('preserves response callbacks and synchronizes pending then settled platform amounts', async () => {
    const original = vi.fn();
    await withUsageReceiptContext('usage', async () => {
      const options = withCloudUsageResponse({ onResponse: original });
      await options.onResponse!({ status: 200, headers: { 'X-Xopc-Request-Id': 'physical-request' } }, { provider: 'xopc-cloud' } as never);
    });
    expect(original).toHaveBeenCalledOnce();
    const getReceipt = vi.spyOn(XopcCloudAccountService.prototype, 'getReceipt').mockResolvedValue(receipt);
    await reconcileCloudUsageReceipt('usage');
    expect(getAiUsageEventView('usage')?.billing).toMatchObject({ state: 'pending', reservedCreditMicro: '50000', chargedCreditMicro: null });
    getReceipt.mockResolvedValue({ ...receipt, state: 'settled', chargedCreditMicro: '23500', settledAt: 2, releasedCreditMicro: '26500' });
    await reconcileCloudUsageReceipt('usage');
    expect(getAiUsageEventView('usage')?.billing).toMatchObject({ state: 'settled', chargedCreditMicro: '23500', reservedCreditMicro: '0' });
    await reconcileCloudUsageReceipt('usage');
    expect(getReceipt).toHaveBeenCalledTimes(2);
  });

  it('does not fabricate zero charges on authorization or receipt lookup failure', async () => {
    await withUsageReceiptContext('usage', () => withCloudUsageResponse().onResponse!(
      { status: 200, headers: { 'x-xopc-request-id': 'physical-request' } }, { provider: 'xopc-cloud' } as never));
    vi.spyOn(XopcCloudAccountService.prototype, 'getReceipt').mockRejectedValue(new Error('scope denied'));
    await reconcileCloudUsageReceipt('usage');
    expect(getAiUsageEventView('usage')?.billing).toMatchObject({ state: 'unavailable', chargedCreditMicro: null });
  });

  it('ignores external providers and rejected HTTP responses even when they include request IDs', async () => {
    await withUsageReceiptContext('usage', async () => {
      await withCloudUsageResponse().onResponse!({ status: 200, headers: { 'x-xopc-request-id': 'external-request' } }, { provider: 'openai' } as never);
      await withCloudUsageResponse().onResponse!({ status: 402, headers: { 'x-xopc-request-id': 'rejected-request' } }, { provider: 'xopc-cloud' } as never);
    });
    expect(getAiUsageEventView('usage')?.billing).toMatchObject({ state: 'unavailable', requestId: undefined });
  });

  it('records a Cloud tool separately inside a BYOK task and links its confirmed charge', async () => {
    vi.spyOn(XopcCloudAccountService.prototype, 'getReceipt').mockResolvedValue({ ...receipt, state: 'settled', chargedCreditMicro: '23500', settledAt: 2 });
    const result = await runWithEmbeddedExecutionSession('mixed-conversation', () => trackCloudCapabilityUsage('cloud-image', 'images.generate', async () => {
      captureCloudUsageResponse({ status: 200, headers: new Headers({ 'x-xopc-request-id': 'physical-request' }) });
      return 'generated';
    }), 'byok-task');
    expect(result).toBe('generated');
    const event = listAiUsageEvents({ from: 0, to: Date.now() + 1 }).items.find(item => item.operation === 'images.generate')!;
    await reconcileCloudUsageReceipt(event.id);
    expect(getAiUsageEventView(event.id)).toMatchObject({ provider: 'xopc-cloud', runId: 'byok-task', conversationId: 'mixed-conversation',
      reasonKey: 'usage.reason.imageGeneration', billing: { chargedCreditMicro: '23500' }, estimatedCostUsd: undefined });
    expect(summarizeAiUsage({ from: 0, to: Date.now() + 1 }).totals.billing.cloud.chargedCreditMicro).toBe('23500');
  });
});
