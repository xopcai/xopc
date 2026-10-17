import { describe, expect, it, vi } from 'vitest';

import { cloudCreditBudgetStopMessage, hasCloudCreditBudget, reportCloudCreditError, withCloudCreditBudget } from '../../providers/xopc-cloud-credit-budget.js';
import { getAsyncLogContext, runWithLogContext } from '../../utils/logger/context.js';
import { getEmbeddedExecutionSession, runWithEmbeddedExecutionSession } from '../embedded/execution-context.js';
import { runInIndependentAgentExecution } from '../independent-execution.js';
import { getDelegationScope, withDelegationScope } from '../orchestration/delegation-scope.js';
import { createDataBatchTool, withDataToolPermissions } from '../tools/dataBatch.js';
import { currentSearchCache, withSearchCache } from '../tools/search/cache.js';

describe('independent Agent execution', () => {
  const batchArgs = { operations: [{ id: 'search', kind: 'web_search' as const, query: 'exhibitions' }] };

  it('drops the origin execution policies and data while preserving correlation', async () => {
    const search = { name: 'web_search', label: 'Search', description: 'Search', parameters: {},
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Found' }], details: {} })) };
    const batch = createDataBatchTool('/tmp', () => new Set(['web_search']), { getTools: () => [search] });
    const originPolicy = { tools: [], authorizeToolCall: vi.fn(async () => ({ block: true, reason: 'Origin only' })) };
    const cache = { get: vi.fn(), set: vi.fn() };
    await runWithLogContext({ requestId: 'request' }, () =>
      runWithEmbeddedExecutionSession('origin', () => withDelegationScope(originPolicy, () =>
        withDataToolPermissions(new Set(), () => withSearchCache(cache, () =>
          withCloudCreditBudget({ conversationId: 'origin', runId: 'origin-run', limitCreditMicro: '100' }, async () => {
            reportCloudCreditError('credit_budget_exhausted');
            await runInIndependentAgentExecution(async () => {
              await Promise.resolve();
              expect(getEmbeddedExecutionSession()).toBeUndefined();
              expect(getDelegationScope()).toBeUndefined();
              expect(currentSearchCache()).toBeUndefined();
              expect(hasCloudCreditBudget()).toBe(false);
              expect(cloudCreditBudgetStopMessage()).toBeUndefined();
              expect(getAsyncLogContext()?.requestId).toBe('request');
              expect((await batch.execute('target', batchArgs)).details).toMatchObject({ status: 'completed' });
            });
            expect(getEmbeddedExecutionSession()).toBe('origin');
            expect(getDelegationScope()).toBe(originPolicy);
            expect(currentSearchCache()).toBe(cache);
            expect(cloudCreditBudgetStopMessage()).toContain('credit_budget_exhausted');
            expect((await batch.execute('origin', batchArgs)).details).toMatchObject({ status: 'failed', sourceRequests: 0 });
          }))))));
    expect(search.execute).toHaveBeenCalledOnce();
    expect(originPolicy.authorizeToolCall).not.toHaveBeenCalled();
  });

  it('keeps concurrent and nested executors independent without bypassing their own denials', async () => {
    const search = { name: 'web_search', label: 'Search', description: 'Search', parameters: {},
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Found' }], details: {} })) };
    const batch = createDataBatchTool('/tmp', () => new Set(['web_search']), { getTools: () => [search] });
    const execute = (conversationId: string, allowed: boolean) => runInIndependentAgentExecution(() =>
      runWithEmbeddedExecutionSession(conversationId, () => withDataToolPermissions(new Set(allowed ? ['web_search'] : []), async () => {
        await Promise.resolve();
        expect(getEmbeddedExecutionSession()).toBe(conversationId);
        const own = await batch.execute(conversationId, batchArgs);
        expect(own.details).toMatchObject({ status: allowed ? 'completed' : 'failed' });
        if (conversationId === 'agent-a') {
          await execute('agent-c', true);
          expect(getEmbeddedExecutionSession()).toBe('agent-a');
          expect((await batch.execute('again', batchArgs)).details).toMatchObject({ status: 'failed' });
        }
      })));
    await Promise.all([execute('agent-a', false), execute('agent-b', true)]);
    expect(search.execute).toHaveBeenCalledTimes(2);
  });
});
