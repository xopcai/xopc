import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { finishAiUsageEvent, insertAiUsageEvent } from '../../../../storage/sqlite/ai-usage-repository.js';
import type { GatewayService } from '../../../service.js';
import { registerSessionsRoutes } from '../sessions.js';

describe('session usage totals', () => {
  const conversationId = 'c0f12290-5df2-4203-8bfd-5d5f34467d20';
  let app: Hono;

  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    app = new Hono();
    registerSessionsRoutes(app, {
      service: {
        isGatewayReady: () => true,
        sessions: {
          listSessions: async () => ({
            items: [{
              key: conversationId,
              agentId: 'main',
              status: 'active',
              tags: [],
              createdAt: '2026-09-27T00:00:00.000Z',
              updatedAt: '2026-09-27T00:01:00.000Z',
              lastAccessedAt: '2026-09-27T00:01:00.000Z',
              messageCount: 2,
              estimatedTokens: 100,
              compactedCount: 0,
              sourceChannel: 'webchat',
              sourceChatId: conversationId,
              sessionType: 'chat',
            }, {
              key: '94df3aa1-75a7-4f61-8a4f-4a870b33d92b',
              agentId: 'main',
              status: 'active',
              tags: [],
              createdAt: '2026-09-27T00:00:00.000Z',
              updatedAt: '2026-09-27T00:01:00.000Z',
              lastAccessedAt: '2026-09-27T00:01:00.000Z',
              messageCount: 0,
              estimatedTokens: 0,
              compactedCount: 0,
              sourceChannel: 'webchat',
              sourceChatId: '94df3aa1-75a7-4f61-8a4f-4a870b33d92b',
              sessionType: 'chat',
            }],
            total: 2,
            limit: 20,
            offset: 0,
            hasMore: false,
          }),
        },
      } as unknown as GatewayService,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('includes all-time recorded usage on every listed session', async () => {
    insertAiUsageEvent({
      id: 'call-1',
      traceId: 'trace-1',
      conversationId,
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
      usage: {
        input: 70,
        output: 30,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      estimatedCostMicrousd: 2500,
    });

    const response = await app.request('/api/sessions?limit=20');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{
        key: conversationId,
        usage: {
          calls: 1,
          totalTokens: 100,
          knownCostUsd: '0.0025',
          costCompleteness: 'complete',
        },
      }, {
        usage: {
          calls: 0,
          totalTokens: 0,
          knownCostUsd: '0',
          costCompleteness: 'unknown',
        },
      }],
    });
  });
});
