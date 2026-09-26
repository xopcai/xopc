import { describe, expect, it } from 'vitest';

import type { SessionIndex } from '../../../session/index.js';
import { GatewaySessionsApi } from '../sessions-api.js';
import { describeActiveExecution } from '../active-execution.js';

describe('active execution shutdown policy', () => {
  it('classifies interactive and background origins', () => {
    expect(describeActiveExecution({
      conversationId: 'chat', runId: 'run-user',
      origin: { type: 'endpoint', endpointId: 'desktop' },
    })).toMatchObject({ kind: 'chat', initiator: 'user', phase: 'running' });
    expect(describeActiveExecution({
      conversationId: 'workflow', runId: 'run-workflow',
      origin: { type: 'system', source: 'workflow' }, taskRunId: 'task-run',
    })).toMatchObject({ kind: 'workflow', initiator: 'user' });
    expect(describeActiveExecution({
      conversationId: 'automation', runId: 'run-automation',
      origin: { type: 'system', source: 'automation' },
    })).toMatchObject({ kind: 'automation', initiator: 'background' });
  });

  it('only blocks quit for user-initiated executions', async () => {
    const userRun = describeActiveExecution({
      conversationId: 'chat', runId: 'run-user',
      origin: { type: 'channel', channel: 'webchat' },
    });
    const backgroundRun = describeActiveExecution({
      conversationId: 'automation', runId: 'run-background',
      origin: { type: 'system', source: 'automation' },
    });
    const automationWorkflowRun = describeActiveExecution({
      conversationId: 'automation-workflow', runId: 'run-automation-workflow',
      origin: { type: 'system', source: 'workflow' },
    });
    const sessionIndex = {
      getSession: async (conversationId: string) => {
        if (conversationId === 'chat') return { name: 'Active chat' };
        if (conversationId === 'automation-workflow') return { customData: { triggerSource: 'automation' } };
        return null;
      },
    } as unknown as SessionIndex;
    const api = new GatewaySessionsApi({
      sessionIndex,
      getAgentService: () => { throw new Error('unused'); },
      getActiveWebchatRunId: () => undefined,
      listActiveWebchatRuns: () => [],
      listActiveExecutions: () => [userRun, backgroundRun, automationWorkflowRun],
    });

    await expect(api.getQuitImpact()).resolves.toMatchObject({
      shouldConfirm: true,
      blockingCount: 1,
      blockingRuns: [{ runId: 'run-user', title: 'Active chat' }],
      backgroundCount: 2,
    });
  });
});
