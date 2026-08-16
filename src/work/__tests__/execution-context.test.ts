import { describe, expect, it } from 'vitest';

import type { SessionMetadata } from '../../session/types.js';
import { resolveExecutionContext } from '../execution-context.js';

function metadata(patch: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    key: 'agent:main:webchat:default:direct:test',
    status: 'active',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 0,
    estimatedTokens: 0,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: 'test',
    sessionType: 'chat',
    ...patch,
  };
}

describe('resolveExecutionContext', () => {
  it('links project work and explicit execution metadata', () => {
    const context = resolveExecutionContext({
      runId: 'run-1',
      sessionKey: 'session-1',
      channel: 'webchat',
      metadata: metadata({
        projectId: 'project-1',
        customData: {
          goalId: 'goal-1',
          workItemId: 'work-1',
          origin: 'goal',
          triggerKind: 'retry',
          parentRunId: 'run-0',
        },
      }),
    });

    expect(context).toMatchObject({
      projectId: 'project-1',
      goalId: 'goal-1',
      workItemId: 'work-1',
      origin: 'goal',
      triggerKind: 'retry',
      parentRunId: 'run-0',
    });
  });

  it('derives automation and proactive origins from the session type', () => {
    expect(resolveExecutionContext({
      runId: 'run-1', sessionKey: 'session-1', channel: 'webchat', metadata: metadata({ sessionType: 'cron' }),
    })).toMatchObject({ origin: 'automation', triggerKind: 'schedule' });
    expect(resolveExecutionContext({
      runId: 'run-2', sessionKey: 'session-2', channel: 'webchat', metadata: metadata({ sessionType: 'heartbeat' }),
    })).toMatchObject({ origin: 'proactive', triggerKind: 'proactive' });
  });
});
