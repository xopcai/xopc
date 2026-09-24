import { describe, expect, it } from 'vitest';

import { useTestDatabase } from '../../../storage/sqlite/__tests__/test-database.js';
import { WorkflowDraftStore } from '../../../workflows/authoring/index.js';
import { createWorkflowManageTool } from '../workflow-manage-tool.js';

useTestDatabase();

describe('workflow_manage', () => {
  it('opens a durable starter draft in an ordinary conversation', async () => {
    const result = await createWorkflowManageTool().execute('open', {
      action: 'open_draft',
      workflowName: 'demo',
    });

    expect(result.details).toMatchObject({
      draft: {
        id: expect.any(String),
        workflowName: 'demo',
        baseRevision: 0,
      },
    });
  });

  it('rejects invalid replacements without changing the durable draft', async () => {
    const tool = createWorkflowManageTool();
    const opened = await tool.execute('open', { action: 'open_draft', workflowName: 'invalid_demo' });
    const draft = opened.details.draft;

    const result = await tool.execute('replace', {
      action: 'replace_draft',
      draftId: draft.id,
      graph: { schemaVersion: 1, nodes: [], edges: [] },
      expectedUpdatedAtMs: draft.updatedAtMs,
    });

    expect(result.details).toMatchObject({ error: expect.any(String) });
    expect(new WorkflowDraftStore().get(draft.id)?.updatedAtMs).toBe(draft.updatedAtMs);
  });

  it('refuses to publish a stale draft version', async () => {
    const tool = createWorkflowManageTool();
    const opened = await tool.execute('open', { action: 'open_draft', workflowName: 'stale_demo' });
    const draft = opened.details.draft;
    const store = new WorkflowDraftStore();
    store.save({
      id: draft.id,
      workflowName: draft.workflowName,
      graph: draft.graph,
      manifest: draft.manifest,
      expectedUpdatedAtMs: draft.updatedAtMs,
    });

    const result = await tool.execute('publish', {
      action: 'publish_draft',
      draftId: draft.id,
      expectedUpdatedAtMs: draft.updatedAtMs,
      confirmed: true,
    });

    expect(result.details).toMatchObject({ code: 'WORKFLOW_DRAFT_CONFLICT' });
  });

  it('requires explicit confirmation before publishing', async () => {
    const tool = createWorkflowManageTool();
    const opened = await tool.execute('open', { action: 'open_draft', workflowName: 'confirmation_demo' });
    const draft = opened.details.draft;

    const result = await tool.execute('publish', {
      action: 'publish_draft',
      draftId: draft.id,
      expectedUpdatedAtMs: draft.updatedAtMs,
    });

    expect(result.details).toMatchObject({ error: expect.stringContaining('confirmation') });
  });

  it('publishes a validated draft after confirmation', async () => {
    const tool = createWorkflowManageTool();
    const opened = await tool.execute('open', { action: 'open_draft', workflowName: 'publish_demo' });
    const draft = opened.details.draft;

    const result = await tool.execute('publish', {
      action: 'publish_draft',
      draftId: draft.id,
      expectedUpdatedAtMs: draft.updatedAtMs,
      confirmed: true,
    });

    expect(result.details).toMatchObject({
      definition: { name: 'publish_demo', revision: 1 },
      delivery: { primary: { kind: 'workflow_definition', status: 'ready' } },
    });
  });
});
