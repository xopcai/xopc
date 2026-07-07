import type { Hono } from 'hono';

import type { Project } from '../../../projects/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

type GlobalSearchHitKind = 'project';

type GlobalSearchHit = {
  kind: GlobalSearchHitKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  score: number;
  payload: {
    project: Project;
  };
};

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 20;
  return Math.min(50, Math.max(1, Number.isFinite(parsed) ? parsed : 20));
}

function parseTypes(value: string | undefined): Set<GlobalSearchHitKind> {
  if (!value?.trim()) return new Set<GlobalSearchHitKind>(['project']);
  return new Set(
    value
      .split(',')
      .map((type) => type.trim())
      .filter((type): type is GlobalSearchHitKind => type === 'project'),
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

    return c.json({ ok: true, query, hits, total: hits.length });
  });
}
