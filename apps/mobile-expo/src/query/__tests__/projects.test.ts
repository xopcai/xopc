import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchProjectActivity, fetchProjectFiles, fetchProjectSessions, pinProject, updateProjectStatus, uploadProjectFile } from '../projects';

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

  it('loads a project directory with an encoded relative path', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      root: '/workspace',
      path: 'docs/design',
      parentPath: 'docs',
      entries: [{ name: 'brief.md', path: 'docs/design/brief.md', type: 'file', size: 12 }],
    })));

    await expect(fetchProjectFiles('project-1', 'docs/design')).resolves.toMatchObject({
      path: 'docs/design',
      entries: [{ name: 'brief.md', type: 'file' }],
    });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project-1/files?path=docs%2Fdesign');
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

  it('uploads a file into a project directory', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      entry: { name: 'brief.txt', path: 'docs/brief.txt', type: 'file', size: 5 },
    }), { status: 201 }));

    await expect(uploadProjectFile({
      projectId: 'project-1',
      path: 'docs/brief.txt',
      uri: 'file:///tmp/brief.txt',
      name: 'brief.txt',
      mimeType: 'text/plain',
    })).resolves.toMatchObject({ path: 'docs/brief.txt' });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project-1/files/upload', expect.objectContaining({
      method: 'POST',
      timeoutMs: 30_000,
    }));
  });
});
