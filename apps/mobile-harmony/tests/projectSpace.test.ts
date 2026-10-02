import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));

import { XopcProjectSpaceRepository } from '../entry/src/main/ets/repository/projectSpaceRepository.ets';

describe('mobile project space', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
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
    expect(mocks.request.mock.calls.map((call) => call[0])).toEqual([
      '/api/projects/project%201', '/api/tasks?projectId=project%201&limit=30&offset=0',
      '/api/notes?projectId=project%201&limit=30&offset=0&sortBy=updatedAt&sortOrder=desc',
      '/api/automations?projectId=project%201'
    ]);
  });
});
