import { describe, expect, it } from 'vitest';

import { notificationPlanFromGatewayEvent } from '../planner.js';

describe('notificationPlanFromGatewayEvent', () => {
  it('maps chat completion to a localized conversation notification', () => {
    const plan = notificationPlanFromGatewayEvent('agent.run.ended', {
      schemaVersion: 1,
      runId: 'run-chat',
      conversationId: 'agent:main:webchat:default:direct:one',
      status: 'success',
      completedAtMs: 1,
      source: 'webchat',
      target: { kind: 'chat', conversationId: 'agent:main:webchat:default:direct:one' },
      sessionTitle: 'Research notifications',
      responsePreview: 'The notification flow is implemented and all tests pass.',
    });
    expect(plan).toMatchObject({
      dedupeKey: 'chat.completed:run-chat',
      notification: {
        type: 'chat.completed',
        target: { kind: 'chat', conversationId: 'agent:main:webchat:default:direct:one' },
        title: { en: 'Response ready', zh: '回答已就绪' },
        body: {
          en: 'The notification flow is implemented and all tests pass.',
          zh: 'The notification flow is implemented and all tests pass.',
        },
      },
    });
  });

  it('renders Markdown response previews as plain notification text', () => {
    const plan = notificationPlanFromGatewayEvent('agent.run.ended', {
      schemaVersion: 1,
      runId: 'run-markdown',
      conversationId: 'conversation-markdown',
      status: 'success',
      completedAtMs: 1,
      source: 'webchat',
      target: { kind: 'chat', conversationId: 'conversation-markdown' },
      responsePreview: '## **Deployment complete**\n\n- Updated `api.ts`\n- See [release notes](https://example.com)',
    });

    expect(plan).toMatchObject({
      notification: {
        body: {
          en: 'Deployment complete • Updated api.ts • See release notes',
          zh: 'Deployment complete • Updated api.ts • See release notes',
        },
      },
    });
  });

  it('keeps failed chat notifications free of response content', () => {
    const plan = notificationPlanFromGatewayEvent('agent.run.ended', {
      schemaVersion: 1,
      runId: 'run-failed',
      conversationId: 'agent:main:webchat:default:direct:one',
      status: 'error',
      completedAtMs: 1,
      source: 'webchat',
      target: { kind: 'chat', conversationId: 'agent:main:webchat:default:direct:one' },
      sessionTitle: 'Research notifications',
      responsePreview: 'This content must not be shown.',
    });

    expect(plan).toMatchObject({
      notification: {
        type: 'chat.failed',
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


  it('maps work discovery completion and failure to review notifications', () => {
    expect(notificationPlanFromGatewayEvent('work-discovery.completed', {
      runId: 'run-understanding',
      conversationId: 'agent:main:webchat:one',
      status: 'completed',
    })).toMatchObject({
      dedupeKey: 'work_discovery.completed:run-understanding',
      notification: {
        type: 'work_discovery.completed',
        target: {
          kind: 'work_discovery',
          runId: 'run-understanding',
          conversationId: 'agent:main:webchat:one',
        },
        priority: 'normal',
      },
    });
    expect(notificationPlanFromGatewayEvent('work-discovery.failed', {
      runId: 'run-understanding',
      conversationId: 'agent:main:webchat:one',
      status: 'failed',
    })).toMatchObject({
      dedupeKey: 'work_discovery.failed:run-understanding',
      notification: { type: 'work_discovery.failed', priority: 'high' },
    });
  });

  it('maps a high-value home opportunity to a stable home notification', () => {
    expect(notificationPlanFromGatewayEvent('home.opportunity.ready', {
      notificationKey: 'stable-key',
      opportunityId: 'opportunity-1',
      title: 'Prepare the launch review',
    })).toMatchObject({
      dedupeKey: 'home.opportunity:stable-key',
      notification: {
        type: 'home.opportunity',
        target: { kind: 'home' },
        priority: 'high',
        body: { en: 'Prepare the launch review', zh: 'Prepare the launch review' },
      },
    });
  });


  it('ignores unrelated and malformed events', () => {
    expect(notificationPlanFromGatewayEvent('session.updated', {})).toBeNull();
    expect(notificationPlanFromGatewayEvent('task.attention_required.v2', {
      taskId: 'task-1', reason: 'blocked',
    })).toBeNull();
  });
});
