import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchNotes } from '../notes';
import { searchMobileWorkspace } from '../search';
import { fetchSessionsList } from '../sessions';
import { fetchTasks } from '../tasks';
import { fetchWorkflowRuns } from '../workflows';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../notes', () => ({ fetchNotes: vi.fn() }));
vi.mock('../sessions', () => ({ fetchSessionsList: vi.fn() }));
vi.mock('../tasks', () => ({ fetchTasks: vi.fn() }));
vi.mock('../workflows', () => ({ fetchWorkflowRuns: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const mockedFetchNotes = vi.mocked(fetchNotes);
const mockedFetchSessions = vi.mocked(fetchSessionsList);
const mockedFetchTasks = vi.mocked(fetchTasks);
const mockedFetchWorkflows = vi.mocked(fetchWorkflowRuns);

describe('mobile workspace search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchNotes.mockResolvedValue({
      items: [{ id: 'note-1', kind: 'thought', status: 'processed', createdAt: 1, updatedAt: 5, title: 'Launch note' }],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
    mockedFetchSessions.mockResolvedValue({
      items: [{ key: 'chat-1', name: 'Launch chat', updatedAt: new Date(4).toISOString(), messageCount: 2 }],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    } as never);
    mockedFetchTasks.mockResolvedValue([{ task: { id: 'task-1', title: 'Launch task', updatedAt: 3 } }] as never);
    mockedFetchWorkflows.mockResolvedValue([{
      id: 'run-1',
      definitionId: 'launch-flow',
      title: 'Launch workflow',
      status: 'running',
      createdAtMs: 2,
      ownerAgentId: 'agent-1',
      metrics: { agentCount: 1, doneAgentCount: 0, errorAgentCount: 0, skippedAgentCount: 0, artifactCount: 0 },
    }]);
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      hits: [{
        kind: 'project',
        id: 'project:project-1',
        title: 'Launch project',
        payload: { project: { id: 'project-1' } },
      }],
    }), { status: 200 }));
  });

  it('returns current product types with native routes', async () => {
    const hits = await searchMobileWorkspace({ query: 'launch', agentIds: ['agent-1'] });
    expect(hits.map((hit) => hit.kind)).toEqual(['note', 'session', 'task', 'workflow_run', 'project']);
    expect(hits.find((hit) => hit.kind === 'workflow_run')?.route)
      .toBe('/workflows/runs/run-1?agentId=agent-1');
    expect(hits.find((hit) => hit.kind === 'project')?.route).toBe('/projects/project-1');
    expect(mockedFetchWorkflows).toHaveBeenCalledWith(['agent-1']);
  });
});
