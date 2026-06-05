import { describe, expect, it } from 'vitest';

import { projectWorkflowRunView } from '../engine/projector.js';
import type { WorkflowEventEnvelope, WorkflowRun } from '../domain/index.js';

function createRun(): WorkflowRun {
  return {
    id: 'run-1',
    definitionId: 'research',
    definitionVersion: '1.0.0',
    title: 'Research task',
    goal: 'Understand the repo',
    input: { query: 'workflow' },
    status: 'queued',
    source: { kind: 'chat', sessionKey: 'chat-1' },
    metrics: {
      agentCount: 0,
      doneAgentCount: 0,
      errorAgentCount: 0,
      skippedAgentCount: 0,
      artifactCount: 0,
    },
    createdAtMs: 1_000,
  };
}

function event(sequence: number, type: WorkflowEventEnvelope['type'], payload: WorkflowEventEnvelope['payload']): WorkflowEventEnvelope {
  return {
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    type,
    payload,
    createdAtMs: 1_000 + sequence,
  };
}

describe('projectWorkflowRunView', () => {
  it('projects append-only workflow events into a run view', () => {
    const view = projectWorkflowRunView([
      event(1, 'run_queued', { run: createRun() }),
      event(2, 'run_started', { startedAtMs: 1_002 }),
      event(3, 'phase_started', { phaseId: 'discover', title: 'Discover' }),
      event(4, 'agent_queued', {
        agentId: 'agent-1',
        label: 'Repo explorer',
        phaseId: 'discover',
        prompt: 'Find workflow code',
      }),
      event(5, 'agent_started', { agentId: 'agent-1' }),
      event(6, 'agent_step_started', {
        agentId: 'agent-1',
        stepId: 'step-1',
        label: 'Search code',
        kind: 'tool',
      }),
      event(7, 'agent_step_completed', { agentId: 'agent-1', stepId: 'step-1', status: 'done' }),
      event(8, 'agent_completed', {
        agentId: 'agent-1',
        status: 'done',
        resultPreview: 'Found workflow runtime',
      }),
      event(9, 'phase_completed', { phaseId: 'discover' }),
      event(10, 'log_appended', { message: 'Discovery complete' }),
      event(11, 'artifact_created', {
        artifact: {
          id: 'artifact-1',
          runId: 'run-1',
          name: 'summary.md',
          mimeType: 'text/markdown',
          sizeBytes: 42,
          createdAtMs: 1_011,
        },
      }),
      event(12, 'run_completed', {
        result: {
          summary: 'Workflow research complete',
          sections: [{ kind: 'text', title: 'Summary', content: 'Done' }],
        },
      }),
    ]);

    expect(view?.run.status).toBe('succeeded');
    expect(view?.run.metrics.agentCount).toBe(1);
    expect(view?.run.metrics.doneAgentCount).toBe(1);
    expect(view?.run.metrics.artifactCount).toBe(1);
    expect(view?.phases[0]).toMatchObject({ id: 'discover', status: 'completed', agentIds: ['agent-1'] });
    expect(view?.agents[0]).toMatchObject({ id: 'agent-1', status: 'done', resultPreview: 'Found workflow runtime' });
    expect(view?.agents[0]?.steps[0]).toMatchObject({ id: 'step-1', status: 'done' });
    expect(view?.logs[0]?.message).toBe('Discovery complete');
    expect(view?.controls.canCancel).toBe(false);
    expect(view?.controls.canRetry).toBe(true);
  });

  it('returns null without a run_queued seed event', () => {
    const view = projectWorkflowRunView([event(1, 'run_started', { startedAtMs: 1_001 })]);

    expect(view).toBeNull();
  });
});
