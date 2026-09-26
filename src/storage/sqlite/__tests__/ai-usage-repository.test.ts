import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../connection.js';
import {
  finishAiUsageEvent,
  getAiUsageEvent,
  insertAiUsageEvent,
  listAiUsageEvents,
  markStaleAiUsageEventsUnknown,
  pruneAiUsageEvents,
  summarizeAiUsage,
} from '../ai-usage-repository.js';

describe('AI usage repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-ai-usage-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records and finalizes one physical model request', () => {
    insertAiUsageEvent({
      id: 'call-1', traceId: 'run-1', conversationId: 'conversation-1', runId: 'run-1',
      category: 'chat', operation: 'agent.answer', trigger: 'user',
      reasonKey: 'usage.reason.agentAnswer', provider: 'openai', model: 'gpt-test',
      status: 'running', startedAt: 100, costSource: 'model_catalog',
      pricingSnapshot: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
    });
    finishAiUsageEvent('call-1', {
      status: 'succeeded', finishedAt: 150, estimatedCostMicrousd: 42,
      usage: {
        input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.000042 },
      },
    });

    expect(getAiUsageEvent('call-1')).toMatchObject({
      status: 'succeeded', duration_ms: 50, input_tokens: 10, output_tokens: 5,
      total_tokens: 17, estimated_cost_microusd: 42,
    });
    const query = { from: 0, to: 1_000 };
    expect(summarizeAiUsage(query)).toMatchObject({
      totals: { calls: 1, succeededCalls: 1, totalTokens: 17, knownCostUsd: '0.000042', costCompleteness: 'complete' },
      byCategory: [{ key: 'chat' }],
      byModel: [{ key: 'openai/gpt-test' }],
    });
    expect(listAiUsageEvents(query).items[0]).toMatchObject({
      id: 'call-1', operation: 'agent.answer', estimatedCostUsd: '0.000042',
    });
  });

  it('redacts secrets and recovers stale running calls', () => {
    insertAiUsageEvent({
      id: 'call-2', traceId: 'run-2', category: 'other', operation: 'unknown',
      trigger: 'system', reasonKey: 'usage.reason.other', provider: 'vendor', model: 'model',
      status: 'running', startedAt: 100, costSource: 'unknown',
    });
    finishAiUsageEvent('call-2', { status: 'failed', finishedAt: 110, errorSummary: 'token=secret-value' });
    expect(getAiUsageEvent('call-2')?.error_summary).toBe('token=[REDACTED]');

    insertAiUsageEvent({
      id: 'call-3', traceId: 'run-3', category: 'chat', operation: 'agent.answer',
      trigger: 'user', reasonKey: 'usage.reason.agentAnswer', provider: 'vendor', model: 'model',
      status: 'running', startedAt: 50, costSource: 'unknown',
    });
    expect(markStaleAiUsageEventsUnknown(80, 120)).toBe(1);
    expect(getAiUsageEvent('call-3')?.status).toBe('unknown');
  });

  it('does not treat a failed priced call without usage as a known zero cost', () => {
    insertAiUsageEvent({
      id: 'call-4', traceId: 'run-4', category: 'chat', operation: 'agent.answer',
      trigger: 'user', reasonKey: 'usage.reason.agentAnswer', provider: 'vendor', model: 'priced',
      status: 'running', startedAt: 100, costSource: 'model_catalog',
      pricingSnapshot: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    });
    finishAiUsageEvent('call-4', { status: 'failed', finishedAt: 110, errorSummary: 'network error' });

    expect(summarizeAiUsage({ from: 0, to: 1_000 }).totals).toMatchObject({
      calls: 1,
      unknownCostCalls: 1,
      knownCostUsd: '0',
      costCompleteness: 'unknown',
    });
  });

  it('prunes completed history without deleting active calls', () => {
    for (const [id, startedAt] of [['old', 10], ['active', 20], ['recent', 100]] as const) {
      insertAiUsageEvent({
        id, traceId: `trace-${id}`, category: 'other', operation: 'test', trigger: 'system',
        reasonKey: 'usage.reason.other', provider: 'vendor', model: 'model', status: 'running',
        startedAt, costSource: 'unknown',
      });
    }
    finishAiUsageEvent('old', { status: 'succeeded', finishedAt: 11 });
    finishAiUsageEvent('recent', { status: 'succeeded', finishedAt: 101 });

    expect(pruneAiUsageEvents(50)).toBe(1);
    expect(getAiUsageEvent('old')).toBeUndefined();
    expect(getAiUsageEvent('active')).toMatchObject({ status: 'running' });
    expect(getAiUsageEvent('recent')).toMatchObject({ status: 'succeeded' });
  });
});
