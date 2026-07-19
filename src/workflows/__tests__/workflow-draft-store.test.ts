import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkflowDraftConflictError, WorkflowDraftStore } from '../authoring/workflow-draft-store.js';

const graph = {
  schemaVersion: 1 as const,
  nodes: [
    { id: 'input', kind: 'input' as const, title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'output', kind: 'output' as const, title: 'Output', position: { x: 300, y: 0 }, config: {} },
  ],
  edges: [{ id: 'edge', source: 'input', target: 'output' }],
};

describe('WorkflowDraftStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xopc-wf-drafts-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('persists and updates an authoring draft', () => {
    const store = new WorkflowDraftStore({ userDir: dir });
    const first = store.save({ workflowName: 'demo', graph, baseRevision: 2 });
    const second = store.save({ id: first.id, workflowName: 'demo', graph, expectedUpdatedAtMs: first.updatedAtMs });
    expect(second.createdAtMs).toBe(first.createdAtMs);
    expect(store.get(first.id)?.baseRevision).toBe(2);
    expect(store.list('demo')).toHaveLength(1);
  });

  it('rejects stale autosaves and removes drafts', () => {
    const store = new WorkflowDraftStore({ userDir: dir });
    const draft = store.save({ workflowName: 'demo', graph });
    expect(() => store.save({ id: draft.id, workflowName: 'demo', graph, expectedUpdatedAtMs: draft.updatedAtMs - 1 })).toThrow(WorkflowDraftConflictError);
    expect(store.remove(draft.id)).toBe(true);
    expect(store.get(draft.id)).toBeNull();
  });
});
