import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { OutcomeExecutionService } from '../../work/index.js';
import { GoalNotificationService, type GoalNotificationSendInput } from '../goal-notifications.js';
import { GoalService } from '../goal-service.js';

describe('GoalNotificationService', () => {
  let stateDir: string;
  let goals: GoalService;
  let sent: GoalNotificationSendInput[];
  let config: Config;
  let notifications: GoalNotificationService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goal-notifications-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    goals = new GoalService();
    sent = [];
    config = {
      goals: {
        notifications: {
          enabled: true,
          includeLinkedSessions: true,
          channels: ['telegram', 'weixin'],
          events: ['done', 'blocked', 'needs_input', 'queue_failed', 'queue_retry'],
          targets: [],
        },
      },
    } as Config;
    notifications = new GoalNotificationService({
      getConfig: () => config,
      getSessionMetadata: async (sessionKey) =>
        sessionKey === 'agent:main:telegram:default:direct:123456'
          ? ({
              key: sessionKey,
              routing: {
                agentId: 'main',
                source: 'telegram',
                accountId: 'default',
                peerKind: 'direct',
                peerId: '123456',
              },
              sourceChannel: 'telegram',
              sourceChatId: 'default:direct:123456',
            } as never)
          : null,
      send: async (input) => {
        sent.push(input);
      },
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('notifies linked Telegram sessions for terminal goal status', async () => {
    const goal = new OutcomeExecutionService().create({
      objective: 'Ship release',
      sessionKey: 'agent:main:telegram:default:direct:123456',
      maxTurns: 5,
    }).goal;
    const done = goals.setStatus(goal.id, 'done');

    notifications.handleGatewayEvent('goal.status.updated', {
      goal: done,
      previousStatus: 'active',
      status: 'done',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      channel: 'telegram',
      chatId: '123456',
      accountId: 'default',
    });
    expect(sent[0]?.text).toContain('Goal completed: Ship release');
  });

  it('notifies fixed targets for queue failures and deduplicates repeated events', async () => {
    const goal = new OutcomeExecutionService().create({
      objective: 'Investigate deploy',
      sessionKey: 'agent:main:webchat:default:direct:g1',
      maxTurns: 5,
    }).goal;
    config = {
      goals: {
        notifications: {
          enabled: true,
          includeLinkedSessions: false,
          channels: ['telegram', 'weixin'],
          events: ['queue_failed'],
          targets: [{ channel: 'weixin', chatId: 'wx-user', accountId: 'work' }],
        },
      },
    } as Config;

    const payload = {
      item: {
        id: 'q1',
        goalId: goal.id,
        status: 'failed',
        source: 'api',
        attempts: 3,
        maxRetries: 2,
        enqueuedAt: Date.now(),
        lastError: 'Model timeout',
      },
    };
    notifications.handleGatewayEvent('goal.queue.updated', payload);
    notifications.handleGatewayEvent('goal.queue.updated', payload);
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      channel: 'weixin',
      chatId: 'wx-user',
      accountId: 'work',
    });
    expect(sent[0]?.text).toContain('Goal run failed: Investigate deploy');
    expect(sent[0]?.text).toContain('Model timeout');
  });
});
