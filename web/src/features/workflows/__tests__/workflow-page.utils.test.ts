import { describe, expect, it } from 'vitest';

import type { WorkflowRunView } from '@/features/workflows/workflow-api';
import { resolveWorkflowSessionKey, workflowChatHref } from '@/features/workflows/workflow-page.utils';

function minimalView(overrides: Partial<WorkflowRunView['run']>): WorkflowRunView {
  return {
    run: {
      id: 'run-1',
      definitionId: 'audit_repo',
      definitionVersion: '1',
      title: 'Audit',
      goal: 'Check repo',
      input: {},
      status: 'succeeded',
      source: { kind: 'webui', sessionKey: 'agent:main:webchat:default:direct:wf_run-1' },
      metadata: {
        sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
        triggerSource: 'webui',
        definition: {} as never,
      },
      metrics: {
        agentCount: 1,
        doneAgentCount: 1,
        errorAgentCount: 0,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs: 1,
      ...overrides,
    },
    phases: [],
    agents: [],
    logs: [],
    artifacts: [],
    timeline: [],
    controls: { canCancel: false, canRetry: false, canArchive: false },
  };
}

describe('resolveWorkflowSessionKey', () => {
  it('returns the dedicated workflow web chat session key', () => {
    const view = minimalView({});
    expect(resolveWorkflowSessionKey(view)).toBe('agent:main:webchat:default:direct:wf_run-1');
  });

  it('returns null when metadata session key is not a web chat session', () => {
    const view = minimalView({
      metadata: { sessionKey: 'telegram:123', triggerSource: 'im', definition: {} as never },
    });
    expect(resolveWorkflowSessionKey(view)).toBeNull();
  });
});

describe('workflowChatHref', () => {
  it('builds a chat route for the workflow session', () => {
    const key = 'agent:main:webchat:default:direct:wf_run-1';
    expect(workflowChatHref(key)).toBe(`/chat/${encodeURIComponent(key)}`);
  });
});
