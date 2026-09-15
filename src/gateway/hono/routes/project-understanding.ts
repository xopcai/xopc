import type { Hono } from 'hono';

import { getProjectUnderstandingRun } from '../../../work-discovery/repository.js';
import { getProjectUnderstandingOverview, saveProjectUnderstandingOverview } from '../../../work-discovery/project-understanding.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerProjectUnderstandingRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  authenticated.get('/api/projects/:id/understanding', (c) => {
    const projectId = c.req.param('id');
    if (!service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    const run = getProjectUnderstandingRun(projectId);
    const overview = getProjectUnderstandingOverview(projectId);
    return c.json({ ok: true, status: run?.status ?? 'not_started', overview: overview?.content ?? null,
      updatedAt: overview?.updatedAt ?? null });
  });

  authenticated.post('/api/projects/:id/understanding', (c) => {
    const projectId = c.req.param('id');
    if (!service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    try {
      const run = deps.service.workDiscovery.startProjectUnderstanding(projectId);
      return c.json({ ok: true, status: run.status }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.patch('/api/projects/:id/understanding', async (c) => {
    const projectId = c.req.param('id');
    if (!service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const content = body && typeof body.content === 'string' ? body.content.trim() : undefined;
    if (!content || content.length > 6_000) return c.json({ ok: false, error: 'Overview must contain 1–6000 characters' }, 400);
    const overview = saveProjectUnderstandingOverview({ projectId, content, correctedByUser: true });
    return c.json({ ok: true, overview: overview.content, updatedAt: overview.updatedAt });
  });

}
