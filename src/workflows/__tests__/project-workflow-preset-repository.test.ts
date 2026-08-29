import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../projects/project-service.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { ProjectWorkflowPresetRepository } from '../project-presets/project-workflow-preset-repository.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
let stateDir: string;

describe('ProjectWorkflowPresetRepository', () => {
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-project-workflow-'));
    process.env.XOPC_STATE_DIR = stateDir;
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(async () => {
    closeXopcDatabase();
    if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = originalStateDir;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('saves one current preset per project and workflow', () => {
    const project = new ProjectService().create({ name: 'Preset project' });
    const repository = new ProjectWorkflowPresetRepository();
    repository.save({
      projectId: project.id,
      definitionId: 'audit',
      contextRefs: [{ kind: 'task', id: 'task-a', role: 'objective' }],
      now: 100,
    });
    const updated = repository.save({
      projectId: project.id,
      definitionId: 'audit',
      contextRefs: [{ kind: 'note', id: 'note-a', role: 'reference' }],
      now: 200,
    });

    expect(updated).toMatchObject({ createdAt: 100, updatedAt: 200 });
    expect(repository.list(project.id)).toEqual([updated]);
    expect(repository.remove(project.id, 'audit')).toBe(true);
    expect(repository.list(project.id)).toEqual([]);

    repository.save({ projectId: project.id, definitionId: 'cleanup', contextRefs: [] });
    expect(repository.removeDefinition('cleanup')).toBe(1);
    expect(repository.list(project.id)).toEqual([]);
  });
});
