import { describe, expect, it } from 'vitest';

import type { Project } from './api';
import { mergeProjectSettingsDraft, projectSettingsDraft } from './project-settings-draft';

const project = { name: 'Original', status: 'active', executionMode: 'local_checkout' } as Project;

describe('project settings realtime reconciliation', () => {
  it('refreshes all untouched fields so autosave does not write stale values back', () => {
    const next = { ...project, name: 'Remote edit', description: 'Remote description', defaultAgentId: 'coder', workspaceRoot: '/workspace' };
    expect(mergeProjectSettingsDraft(projectSettingsDraft(project), project, next)).toEqual(projectSettingsDraft(next));
  });

  it('keeps local edits while accepting unrelated server changes', () => {
    const draft = { ...projectSettingsDraft(project), name: 'Local edit', instructions: 'Local instructions' };
    const next = { ...project, name: 'Remote edit', description: 'Remote description', instructions: 'Remote instructions' };
    expect(mergeProjectSettingsDraft(draft, project, next)).toEqual({ ...projectSettingsDraft(next), name: 'Local edit', instructions: 'Local instructions' });
    expect(draft.name).toBe('Local edit');
  });

  it('preserves intentional clearing and accepts remote clearing for untouched fields', () => {
    const before = { ...project, description: 'Description', brief: 'Brief' };
    const draft = { ...projectSettingsDraft(before), description: '' };
    expect(mergeProjectSettingsDraft(draft, before, { ...before, description: 'Remote', brief: undefined }))
      .toMatchObject({ description: '', brief: '' });
  });
});
