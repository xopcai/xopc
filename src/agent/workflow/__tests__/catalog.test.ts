import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkflowCatalog,
  WorkflowNameConflictError,
  WorkflowRevisionConflictError,
} from '../catalog.js';

const graph = {
  schemaVersion: 1 as const,
  nodes: [
    { id: 'input', kind: 'input' as const, title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'output', kind: 'output' as const, title: 'Output', position: { x: 300, y: 0 }, config: {} },
  ],
  edges: [{ id: 'edge', source: 'input', target: 'output' }],
};

describe('visual workflow catalog', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xopc-wf-catalog-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lists and loads graph-based built-ins', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    expect(catalog.list().map((entry) => entry.name)).toContain('research');
    expect(catalog.load('research').graph.nodes.length).toBeGreaterThan(3);
  });

  it('saves JSON definitions and increments revisions', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    const first = catalog.save({ name: 'my_workflow', graph, manifest: { title: 'My workflow' }, expectedRevision: 0 });
    expect(first.path).toBe(join(dir, 'my_workflow.json'));
    expect(first.definition.revision).toBe(1);
    const second = catalog.save({ name: 'my_workflow', graph, expectedRevision: 1 });
    expect(second.definition.revision).toBe(2);
    expect(catalog.load('my_workflow').metadata.source).toBe('user');
  });

  it('rejects stale saves', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    catalog.save({ name: 'my_workflow', graph, expectedRevision: 0 });
    expect(() => catalog.save({ name: 'my_workflow', graph, expectedRevision: 0 })).toThrow(WorkflowRevisionConflictError);
  });

  it('distinguishes a duplicate create from a stale update', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    catalog.save({ name: 'my_workflow', graph, expectedRevision: 0, intent: 'create' });
    expect(() => catalog.save({
      name: 'my_workflow',
      graph,
      expectedRevision: 0,
      intent: 'create',
    })).toThrow(WorkflowNameConflictError);
  });

  it('does not create a user workflow over a builtin in create mode', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    expect(() => catalog.save({
      name: 'research',
      graph,
      expectedRevision: 0,
      intent: 'create',
    })).toThrow(WorkflowNameConflictError);
  });

  it('keeps revision history and restores a snapshot as a new revision', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    catalog.save({ name: 'my_workflow', graph, manifest: { title: 'First' }, expectedRevision: 0 });
    catalog.save({ name: 'my_workflow', graph, manifest: { title: 'Second' }, expectedRevision: 1 });
    expect(catalog.listRevisions('my_workflow').map((item) => item.revision)).toEqual([2, 1]);
    expect(catalog.loadRevision('my_workflow', 1).title).toBe('First');
    const restored = catalog.restore('my_workflow', 1, 2);
    expect(restored.definition).toMatchObject({ revision: 3, title: 'First' });
  });

  it('lets a user definition override a builtin without mutating the builtin', () => {
    const catalog = createWorkflowCatalog({ userDir: dir });
    catalog.save({ name: 'research', graph, manifest: { title: 'Custom research' } });
    expect(catalog.load('research').title).toBe('Custom research');
    expect(catalog.remove('research')).toBe(true);
    expect(catalog.load('research').metadata.source).toBe('builtin');
  });
});
