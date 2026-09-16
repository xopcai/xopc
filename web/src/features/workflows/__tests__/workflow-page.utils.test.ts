import { describe, expect, it } from 'vitest';

import type { WorkflowRunView } from '@/features/workflows/workflow-api';
import {
  collectWorkflowRunDiagnostics,
  resolveWorkflowConversationId,
  workflowChatHref,
} from '@/features/workflows/workflow-page.utils';

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
      source: { kind: 'webui', conversationId: 'd72b7a76-8f3b-459d-b19b-bd0c519482d7' },
      metadata: {
        conversationId: 'd72b7a76-8f3b-459d-b19b-bd0c519482d7',
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
    nodes: [],
    logs: [],
    artifacts: [],
    timeline: [],
    controls: { canCancel: false, canRetry: false, canArchive: false },
  };
}

describe('resolveWorkflowConversationId', () => {
  it('returns the dedicated workflow web chat session key', () => {
    const view = minimalView({});
    expect(resolveWorkflowConversationId(view)).toBe('d72b7a76-8f3b-459d-b19b-bd0c519482d7');
  });

  it('returns null when metadata session key is not a web chat session', () => {
    const view = minimalView({
      metadata: { conversationId: 'telegram:123', triggerSource: 'im', definition: {} as never },
    });
    expect(resolveWorkflowConversationId(view)).toBeNull();
  });
});

describe('workflowChatHref', () => {
  it('builds a chat route for the workflow session', () => {
    const key = 'd72b7a76-8f3b-459d-b19b-bd0c519482d7';
    expect(workflowChatHref(key)).toBe(`/chat/${encodeURIComponent(key)}`);
  });

  it('adds a draft handoff when provided', () => {
    const key = 'd72b7a76-8f3b-459d-b19b-bd0c519482d7';
    expect(workflowChatHref(key, 'Next step?')).toBe(
      `/chat/${encodeURIComponent(key)}?draft=Next+step%3F`,
    );
  });
});

describe('collectWorkflowRunDiagnostics', () => {
  it('collects run, agent, and step errors', () => {
    const view = minimalView({
      status: 'failed',
      error: { code: 'runtime_error', message: 'Workflow failed', recoverable: true },
    });
    view.agents = [
      {
        id: 'reviewer',
        label: 'Reviewer',
        status: 'error',
        conversationId: 'd72b7a76-8f3b-459d-b19b-bd0c519482d7:reviewer',
        transcriptMessageCount: 2,
        error: 'Model failed',
        steps: [
          {
            id: 'step-1',
            label: 'Review files',
            kind: 'llm',
            status: 'error',
            error: 'Context overflow',
          },
        ],
      },
    ];

    expect(collectWorkflowRunDiagnostics(view)).toMatchObject([
      { kind: 'run_error', code: 'runtime_error', message: 'Workflow failed' },
      { kind: 'agent_error', agentId: 'reviewer', message: 'Model failed' },
      { kind: 'step_error', agentId: 'reviewer', stepId: 'step-1', message: 'Context overflow' },
    ]);
  });
});
