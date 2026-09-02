import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchProject, fetchProjectActivity, fetchProjectSessions, fetchProjectSkills, pinProject, updateProjectStatus } from '../projects';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

describe('project queries', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('loads project chats with an encoded project id', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      sessions: [{ key: 'agent:main:webchat:one', name: 'Planning', messageCount: 3 }],
    })));

    await expect(fetchProjectSessions('project/one')).resolves.toEqual([
      expect.objectContaining({ key: 'agent:main:webchat:one', name: 'Planning' }),
    ]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project%2Fone/sessions?limit=100');
  });

  it('loads the compact project activity timeline', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      items: [{
        id: 'activity-1',
        type: 'task.updated',
        primaryObject: { kind: 'task', id: 'task-1', title: 'Ship mobile' },
        actor: { kind: 'user', name: 'User' },
        payload: {},
        importance: 'normal',
        createdAt: 10,
      }],
    })));

    await expect(fetchProjectActivity('project-1')).resolves.toMatchObject([{ id: 'activity-1' }]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project-1/activity?visibility=timeline&limit=8');
  });

  it('loads project progress details with safe empty collections', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      project: { id: 'project-1', name: 'Mobile', status: 'active', outcome: 'Ship the app' },
    })));

    await expect(fetchProject('project-1')).resolves.toMatchObject({
      outcome: 'Ship the app',
      milestones: [],
      recentUpdates: [],
    });
  });

  it('loads project and inherited skill summaries', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      workspaceRoot: '/workspace',
      sources: [{ origin: 'xopc-workspace', rootDir: '/workspace/.xopc/skills', state: 'active' }],
      items: [{
        key: 'xopc-workspace:review',
        directoryId: 'review',
        name: 'review',
        description: 'Review changes',
        origin: 'xopc-workspace',
        path: '/workspace/.xopc/skills/review',
        effective: true,
        disableModelInvocation: false,
      }],
      inheritedItems: [],
      diagnostics: [],
    })));

    await expect(fetchProjectSkills('project/one')).resolves.toMatchObject({
      items: [{ name: 'review', effective: true }],
    });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project%2Fone/skills');
  });

  it('uses explicit project actions for pinning and archiving', async () => {
    const project = { id: 'project-1', name: 'Mobile', status: 'active' };
    mockedApiFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: true, project })));

    await pinProject('project-1');
    expect(mockedApiFetch).toHaveBeenLastCalledWith('/api/projects/project-1/pin', { method: 'POST' });

    await updateProjectStatus('project-1', 'archived');
    expect(mockedApiFetch).toHaveBeenLastCalledWith('/api/projects/project-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
  });

});
