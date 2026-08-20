import { z } from 'zod';

import { apiFetch } from '../api/client';
import { fetchNotes } from './notes';
import { fetchSessionsList } from './sessions';
import { fetchTasks } from './tasks';
import { fetchWorkflowRuns } from './workflows';

export type MobileSearchKind = 'note' | 'session' | 'project' | 'task' | 'workflow_run';

export type MobileSearchHit = {
  id: string;
  kind: MobileSearchKind;
  entityId: string;
  title: string;
  subtitle?: string;
  updatedAt?: number;
  route: string;
};

const ProjectSearchResponseSchema = z.object({
  ok: z.literal(true),
  hits: z.array(z.object({
    kind: z.literal('project'),
    id: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
    payload: z.object({ project: z.object({ id: z.string() }).passthrough() }),
  })),
});

function includes(value: string | undefined, query: string): boolean {
  return Boolean(value?.toLocaleLowerCase().includes(query));
}

export async function searchMobileWorkspace(input: {
  query: string;
  agentIds: string[];
}): Promise<MobileSearchHit[]> {
  const value = input.query.trim();
  const needle = value.toLocaleLowerCase();
  if (!needle) return [];

  const [notes, sessions, tasks, workflows, projectsResponse] = await Promise.all([
    fetchNotes({ search: value, limit: 50, sortBy: 'updatedAt', sortOrder: 'desc' }),
    fetchSessionsList({ search: value, limit: 50, channel: null }),
    fetchTasks(),
    fetchWorkflowRuns(input.agentIds),
    apiFetch(`/api/search?q=${encodeURIComponent(value)}&types=project&limit=50`),
  ]);
  if (!projectsResponse.ok) throw new Error(`Workspace search failed: ${projectsResponse.status}`);
  const projects = ProjectSearchResponseSchema.parse(await projectsResponse.json()).hits;

  const hits: MobileSearchHit[] = [
    ...notes.items.map((note) => ({
      id: `note:${note.id}`,
      kind: 'note' as const,
      entityId: note.id,
      title: note.title || note.snippet || '',
      subtitle: note.snippet,
      updatedAt: note.updatedAt,
      route: `/items/${encodeURIComponent(note.id)}`,
    })),
    ...sessions.items.map((session) => ({
      id: `session:${session.key}`,
      kind: 'session' as const,
      entityId: session.key,
      title: session.name || session.title || session.displayName || session.key,
      updatedAt: Date.parse(session.updatedAt),
      route: `/chat/${encodeURIComponent(session.key)}`,
    })),
    ...tasks.filter((item) => includes(item.task.title, needle) || includes(item.task.body, needle)).map((item) => ({
      id: `task:${item.task.id}`,
      kind: 'task' as const,
      entityId: item.task.id,
      title: item.task.title,
      subtitle: item.task.body,
      updatedAt: item.task.updatedAt,
      route: `/tasks/${encodeURIComponent(item.task.id)}`,
    })),
    ...workflows.filter((run) => includes(run.title, needle) || includes(run.definitionId, needle)).map((run) => ({
      id: `workflow_run:${run.id}`,
      kind: 'workflow_run' as const,
      entityId: run.id,
      title: run.title,
      subtitle: run.definitionId,
      updatedAt: run.completedAtMs ?? run.startedAtMs ?? run.createdAtMs,
      route: `/workflows/runs/${encodeURIComponent(run.id)}${run.ownerAgentId ? `?agentId=${encodeURIComponent(run.ownerAgentId)}` : ''}`,
    })),
    ...projects.map((hit) => ({
      id: hit.id,
      kind: 'project' as const,
      entityId: hit.payload.project.id,
      title: hit.title,
      subtitle: hit.subtitle,
      route: `/projects/${encodeURIComponent(hit.payload.project.id)}`,
    })),
  ];

  return [...new Map(hits.map((hit) => [hit.id, hit])).values()]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
