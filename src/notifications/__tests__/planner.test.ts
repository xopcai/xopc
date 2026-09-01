import { describe, expect, it } from 'vitest';

import { notificationPlanFromGatewayEvent } from '../planner.js';

describe('notificationPlanFromGatewayEvent', () => {
  it('maps chat completion to a localized conversation notification', () => {
    const plan = notificationPlanFromGatewayEvent('agent.run.ended', {
      schemaVersion: 1,
      runId: 'run-chat',
      sessionKey: 'agent:main:webchat:default:direct:one',
      status: 'success',
      completedAtMs: 1,
      source: 'webchat',
      target: { kind: 'chat', sessionKey: 'agent:main:webchat:default:direct:one' },
      sessionTitle: 'Research notifications',
    });
    expect(plan).toMatchObject({
      dedupeKey: 'chat.completed:run-chat',
      notification: {
        type: 'chat.completed',
        target: { kind: 'chat', sessionKey: 'agent:main:webchat:default:direct:one' },
        title: { en: 'Response ready', zh: '回答已就绪' },
        body: { en: 'Research notifications', zh: 'Research notifications' },
      },
    });
  });

  it('maps task attention and completion with durable outbox identity', () => {
    expect(notificationPlanFromGatewayEvent('task.attention_required.v2', {
      sourceEventId: 'event-1',
      task: { id: 'task-1', title: 'Approve deployment' },
      reason: 'approval',
    })).toMatchObject({
      dedupeKey: 'task.needs_input:event-1',
      notification: { type: 'task.needs_input', target: { kind: 'task', taskId: 'task-1' } },
    });
    expect(notificationPlanFromGatewayEvent('task.phase_changed.v2', {
      sourceEventId: 'event-2',
      task: { id: 'task-1', title: 'Approve deployment' },
      to: 'closed',
      resolution: 'done',
    })).toMatchObject({
      dedupeKey: 'task.completed:event-2',
      notification: { type: 'task.completed' },
    });
    expect(notificationPlanFromGatewayEvent('task.attention_required.v2', {
      sourceEventId: 'event-3',
      task: { id: 'task-1', title: 'Approve deployment' },
      reason: 'failed',
    })).toMatchObject({
      dedupeKey: 'task.failed:event-3',
      notification: { type: 'task.failed', title: { en: 'Task failed', zh: '任务失败' } },
    });
  });

  it('honors automation notification policy', () => {
    const run = {
      id: 'run-1', automationId: 'automation-1', automationName: 'Nightly backup', status: 'succeeded',
    };
    expect(notificationPlanFromGatewayEvent('automation.run.completed', {
      run, notificationPolicy: 'attention', requiresAttention: false,
    })).toBeNull();
    expect(notificationPlanFromGatewayEvent('automation.run.completed', {
      run, notificationPolicy: 'all', requiresAttention: false,
    })).toMatchObject({
      dedupeKey: 'automation.completed:run-1',
      notification: { type: 'automation.completed' },
    });
  });

  it('ignores unrelated and malformed events', () => {
    expect(notificationPlanFromGatewayEvent('session.updated', {})).toBeNull();
    expect(notificationPlanFromGatewayEvent('task.attention_required.v2', {
      taskId: 'task-1', reason: 'blocked',
    })).toBeNull();
  });
});
