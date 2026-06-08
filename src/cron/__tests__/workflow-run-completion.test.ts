import { describe, expect, it } from 'vitest';

import type { WorkflowRunView } from '../../workflows/domain/index.js';
import {
  buildWorkflowRunCronSummary,
  isWorkflowRunCronSuccess,
  resolveWorkflowCronWaitMs,
  waitForWorkflowRunView,
} from '../workflow-run-completion.js';

function minimalView(status: WorkflowRunView['run']['status']): WorkflowRunView {
  return {
    run: {
      id: 'run-1',
      definitionId: 'weekly_review',
      definitionVersion: '1',
      title: 'Weekly Review',
      goal: 'Review the week',
      input: {},
      status,
      source: { kind: 'cron', scheduleId: 'job-1' },
      metrics: {
        agentCount: 1,
        doneAgentCount: 1,
        errorAgentCount: 0,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs: 1,
    },
    phases: [],
    agents: [],
    logs: [],
    artifacts: [],
    timeline: [],
    controls: { canCancel: false, canRetry: false, canArchive: false },
  };
}

describe('resolveWorkflowCronWaitMs', () => {
  it('uses at least the default workflow wait budget', () => {
    expect(resolveWorkflowCronWaitMs(60_000)).toBeGreaterThanOrEqual(35 * 60 * 1000);
  });
});

describe('buildWorkflowRunCronSummary', () => {
  it('describes success and failure differently', () => {
    expect(buildWorkflowRunCronSummary(minimalView('succeeded'))).toContain('succeeded');
    expect(buildWorkflowRunCronSummary(minimalView('failed'))).toContain('failed');
    expect(isWorkflowRunCronSuccess(minimalView('succeeded'))).toBe(true);
    expect(isWorkflowRunCronSuccess(minimalView('failed'))).toBe(false);
  });
});

describe('waitForWorkflowRunView', () => {
  it('returns when the run reaches a terminal status', async () => {
    let calls = 0;
    const result = await waitForWorkflowRunView({
      readView: async () => {
        calls += 1;
        return calls < 2 ? minimalView('running') : minimalView('succeeded');
      },
      runId: 'run-1',
      signal: new AbortController().signal,
      timeoutMs: 5000,
      pollIntervalMs: 1,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.view.run.status).toBe('succeeded');
    }
  });
});
