import { describe, expect, it } from 'vitest';

import {
  parseWorkflowRunLinksFromTranscriptRows,
  WORKFLOW_RUN_LINK_CONTEXT_KIND,
} from '@/features/workflows/parse-workflow-run-links';

describe('parseWorkflowRunLinksFromTranscriptRows', () => {
  it('extracts workflow run link context rows', () => {
    const rows = [
      {
        kind: 'context',
        id: 'workflow-run-link:run-1',
        text: 'Workflow running',
        data: {
          kind: WORKFLOW_RUN_LINK_CONTEXT_KIND,
          runId: 'run-1',
          workflowSessionKey: 'agent:main:webchat:default:direct:wf_run-1',
          definitionId: 'audit_repo',
          goal: 'Check repo',
          status: 'running',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    expect(parseWorkflowRunLinksFromTranscriptRows(rows)).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        workflowSessionKey: 'agent:main:webchat:default:direct:wf_run-1',
        definitionId: 'audit_repo',
      }),
    ]);
  });
});
