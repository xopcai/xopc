import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), listProject: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
vi.mock('../entry/src/main/ets/service/localSessionStore.ets', () => ({ localSessionStore: { listProject: mocks.listProject } }));

import { XopcProjectSpaceRepository } from '../entry/src/main/ets/repository/projectSpaceRepository.ets';

describe('mobile project space', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.listProject.mockReset();
    mocks.listProject.mockResolvedValue([]);
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/sessions?limit=100')) return JSON.stringify({ ok: true, sessions: [
        { key: 'project-chat', messageCount: 2, updatedAt: '2026-10-03T00:00:00Z' },
        { key: 'task-chat', messageCount: 1, updatedAt: '2026-10-03T00:00:00Z', customData: { origin: 'task' } }
      ] });
      if (path.startsWith('/api/projects/')) return JSON.stringify({ project: { id: 'project 1', name: 'Project', status: 'active' } });
      if (path.startsWith('/api/tasks?')) return JSON.stringify({ total: 1, items: [{ task: {
        id: 'task-1', title: 'Task', phase: 'ready', version: 1, projectId: 'project 1', priority: 'normal'
      } }] });
      if (path.startsWith('/api/notes?')) return JSON.stringify({ total: 1, items: [{
        id: 'note-1', title: 'Note', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 2
      }] });
      if (path.startsWith('/api/automations?')) return JSON.stringify({ automations: [{
        id: 'automation-1', name: 'Automation', enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent' }
      }] });
      throw new Error(path);
    });
  });

  it('loads project content using the project id for each section', async () => {
    const repository = new XopcProjectSpaceRepository();
    expect((await repository.project('project 1')).name).toBe('Project');
    expect((await repository.tasks('project 1')).items.map((item) => item.id)).toEqual(['task-1']);
    expect((await repository.notes('project 1')).items.map((item) => item.id)).toEqual(['note-1']);
    expect((await repository.automations('project 1')).map((item) => item.id)).toEqual(['automation-1']);
    expect((await repository.sessions('project 1')).map((item) => item.key)).toEqual(['project-chat']);
    expect(mocks.request.mock.calls.map((call) => call[0])).toEqual([
      '/api/projects/project%201', '/api/tasks?projectId=project%201&limit=30&offset=0',
      '/api/notes?projectId=project%201&limit=30&offset=0&sortBy=updatedAt&sortOrder=desc',
      '/api/automations?projectId=project%201', '/api/projects/project%201/sessions?limit=100'
    ]);
  });

  it('keeps new local project conversations visible before their first message', async () => {
    mocks.listProject.mockResolvedValue([{ conversationId: 'draft-chat', createdAt: '2026-10-03T01:00:00Z',
      creation: { projectId: 'project 1' } }]);
    const items = await new XopcProjectSpaceRepository().sessions('project 1');
    expect(items.map((item) => item.key)).toEqual(['draft-chat', 'project-chat']);
    expect(items[0].status).toBe('draft');
    expect(mocks.listProject).toHaveBeenCalledWith('project 1');
  });
});
