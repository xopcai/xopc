import type { Hono } from 'hono';

import type { Task, TaskOperationalState, TaskPresentation } from '@xopcai/gateway-contract';

import type { Project } from '../../../projects/types.js';
import { TaskReadModelProjector } from '../../../tasks/task-read-model-projector.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

type GlobalSearchHitKind = 'project' | 'task';

type GlobalSearchHit =
  | {
    kind: 'project';
    id: string;
    title: string;
    subtitle?: string;
    href: string;
    score: number;
    payload: {
      project: Project;
    };
  }
  | {
    kind: 'task';
    id: string;
    title: string;
    subtitle?: string;
    href: string;
    score: number;
    payload: {
      task: Task;
      operationalState: TaskOperationalState;
      presentation: TaskPresentation;
    };
  };

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 20;
  return Math.min(50, Math.max(1, Number.isFinite(parsed) ? parsed : 20));
}

function parseTypes(value: string | undefined): Set<GlobalSearchHitKind> {
  if (!value?.trim()) return new Set<GlobalSearchHitKind>(['project', 'task']);
  return new Set(
    value
      .split(',')
      .map((type) => type.trim())
      .filter((type): type is GlobalSearchHitKind => type === 'project' || type === 'task'),
  );
}

function projectSubtitle(project: Project): string | undefined {
  return project.description ?? project.workspaceRoot ?? project.brief ?? project.slug;
}

export function registerSearchRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.get('/api/search', (c) => {
    const query = c.req.query('q')?.trim() ?? '';
    const limit = parseLimit(c.req.query('limit'));
    const types = parseTypes(c.req.query('types'));
    const hits: GlobalSearchHit[] = [];

    if (query && types.has('project')) {
      const projects = service.projects.list({ search: query, limit, offset: 0 }).items;
      hits.push(
        ...projects.map((project, index) => ({
          kind: 'project' as const,
          id: `project:${project.id}`,
          title: project.name,
          subtitle: projectSubtitle(project),
          href: `/projects/${encodeURIComponent(project.id)}`,
          score: index,
          payload: { project },
        })),
      );
    }

    if (query && types.has('task')) {
      const tasks = new TaskRepository().list({ search: query, limit, offset: 0 });
      const projector = new TaskReadModelProjector();
      hits.push(
        ...tasks.map((task, index) => {
          const model = projector.project(task);
          return {
            kind: 'task' as const,
            id: `task:${task.id}`,
            title: task.title,
            subtitle: model.presentation.reason ?? task.contract?.objective ?? task.body,
            href: `/tasks/${encodeURIComponent(task.id)}`,
            score: index,
            payload: {
              task: model.task,
              operationalState: model.operationalState,
              presentation: model.presentation,
            },
          };
        }),
      );
    }

    return c.json({ ok: true, query, hits, total: hits.length });
  });
}
