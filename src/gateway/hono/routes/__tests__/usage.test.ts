import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import {
  finishAiUsageEvent,
  insertAiUsageEvent,
  summarizeAiUsageByConversations,
} from '../../../../storage/sqlite/ai-usage-repository.js';
import { registerUsageRoutes } from '../usage.js';

describe('usage routes', () => {
  let app: Hono;

  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    app = new Hono();
    registerUsageRoutes(app, {} as never);
    insertAiUsageEvent({
      id: 'call-1',
      traceId: 'trace-1',
      conversationId: 'conversation-a',
      category: 'chat',
      operation: 'agent.answer',
      trigger: 'user',
      reasonKey: 'usage.reason.agentAnswer',
      provider: 'openai',
      model: 'gpt-test',
      status: 'running',
      startedAt: 100,
      costSource: 'model_catalog',
    });
    finishAiUsageEvent('call-1', {
      status: 'succeeded',
      finishedAt: 150,
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      estimatedCostMicrousd: 42,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('returns summaries, events, details, and traces from the ledger', async () => {
    const summary = await app.request('/api/usage/summary?from=1&to=200');
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ totals: { calls: 1, totalTokens: 15, knownCostUsd: '0.000042' } });

    const events = await app.request('/api/usage/events?from=1&to=200&limit=10');
    expect(events.status).toBe(200);
    expect(await events.json()).toMatchObject({ items: [{ id: 'call-1', reasonKey: 'usage.reason.agentAnswer' }] });

    expect(await (await app.request('/api/usage/events/call-1')).json()).toMatchObject({ event: { id: 'call-1' } });
    expect(await (await app.request('/api/usage/traces/trace-1')).json()).toMatchObject({ events: [{ id: 'call-1' }] });
  });

  it('rejects invalid ranges and cursors', async () => {
    expect((await app.request('/api/usage/summary?from=200&to=100')).status).toBe(400);
    expect((await app.request('/api/usage/events?from=1&to=200&cursor=invalid')).status).toBe(400);
  });

  it('aggregates retained token and cost totals by conversation', () => {
    expect(summarizeAiUsageByConversations(['conversation-a', 'conversation-missing'])).toEqual(new Map([
      ['conversation-a', {
        calls: 1,
        unknownCostCalls: 0,
        totalTokens: 15,
        knownCostUsd: '0.000042',
        costCompleteness: 'complete',
      }],
    ]));

    insertAiUsageEvent({
      id: 'call-unknown',
      traceId: 'trace-unknown',
      conversationId: 'conversation-a',
      category: 'chat',
      operation: 'agent.answer',
      trigger: 'user',
      reasonKey: 'usage.reason.agentAnswer',
      provider: 'custom',
      model: 'unpriced-model',
      status: 'running',
      startedAt: 160,
      costSource: 'unknown',
    });
    finishAiUsageEvent('call-unknown', {
      status: 'succeeded',
      finishedAt: 180,
      usage: {
        input: 20,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });

    expect(summarizeAiUsageByConversations(['conversation-a']).get('conversation-a')).toMatchObject({
      calls: 2,
      unknownCostCalls: 1,
      totalTokens: 45,
      knownCostUsd: '0.000042',
      costCompleteness: 'partial',
    });
  });
});
