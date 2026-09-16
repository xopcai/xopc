import { stat } from 'node:fs/promises';

import type { ProjectEnvironmentOptions } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import { inspectGitRepository } from '../../../execution-environments/git.js';
import { LocalWorktreeManager } from '../../../execution-environments/local-worktree-manager.js';
import { SessionEnvironmentService } from '../../../execution-environments/session-environment-service.js';
import { ExecutionEnvironmentStore } from '../../../execution-environments/store.js';
import type { ProjectExecutionMode } from '../../../projects/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function executionMode(value: unknown): ProjectExecutionMode | undefined {
  return value === 'local_checkout' || value === 'managed_worktree' ? value : undefined;
}

function errorResponse(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function registerExecutionEnvironmentRoutes(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  const store = new ExecutionEnvironmentStore();
  const worktrees = new LocalWorktreeManager({ store });
  const sessions = new SessionEnvironmentService({ store, worktrees });

  authenticated.get('/api/projects/:projectId/environment-options', async (c) => {
    c.header('Cache-Control', 'no-store');
    const project = deps.service.projects.get(c.req.param('projectId'));
    if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);
    const root = project.workspaceRoot?.trim();
    const options: ProjectEnvironmentOptions = {
      localAvailable: Boolean(root && await stat(root).then((entry) => entry.isDirectory()).catch(() => false)),
    };
    if (!options.localAvailable) {
      options.worktreeUnavailableReason = 'workspace_unavailable';
    } else {
      try {
        const repository = await inspectGitRepository(root!);
        if (repository.dirty) options.worktreeUnavailableReason = 'uncommitted_changes';
      } catch {
        options.worktreeUnavailableReason = 'git_commit_required';
      }
    }
    return c.json({ ok: true, options });
  });

  authenticated.get('/api/projects/:projectId/environments', (c) => {
    const projectId = c.req.param('projectId');
    if (!deps.service.projects.get(projectId)) {
      return c.json({ ok: false, error: 'Project not found' }, 404);
    }
    return c.json({ ok: true, environments: store.list({ projectId, includeDeleted: c.req.query('includeDeleted') === 'true' }) });
  });

  authenticated.get('/api/sessions/:conversationId/environment', (c) => {
    const environment = sessions.get(c.req.param('conversationId'));
    return environment
      ? c.json({ ok: true, environment })
      : c.json({ ok: false, error: 'Execution environment not found' }, 404);
  });

  authenticated.post('/api/sessions/:conversationId/environment', async (c) => {
    const conversationId = c.req.param('conversationId');
    if (deps.service.getActiveWebchatRunId(conversationId)) {
      return c.json({ ok: false, error: 'Stop the active session run before changing its environment' }, 409);
    }
    const session = await deps.service.sessions.getSession(conversationId);
    if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
    const projectId = session.projectId?.trim();
    const project = projectId ? deps.service.projects.get(projectId) : null;
    if (!project) return c.json({ ok: false, error: 'Session is not attached to a project' }, 409);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = body.mode === undefined ? undefined : executionMode(body.mode);
    if (body.mode !== undefined && !mode) return c.json({ ok: false, error: 'Invalid execution mode' }, 400);
    try {
      const environment = await sessions.attach({
        conversationId,
        project,
        mode,
        baseRef: typeof body.baseRef === 'string' ? body.baseRef : undefined,
      });
      return c.json({ ok: true, environment }, 201);
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.delete('/api/sessions/:conversationId/environment', async (c) => {
    const conversationId = c.req.param('conversationId');
    if (deps.service.getActiveWebchatRunId(conversationId)) {
      return c.json({ ok: false, error: 'Stop the active session run before releasing its environment' }, 409);
    }
    try {
      const environment = await sessions.release(
        conversationId,
        c.req.query('keepManaged') !== 'true',
      );
      return c.json({ ok: true, environment });
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.get('/api/execution-environments/:environmentId', async (c) => {
    const environment = store.get(c.req.param('environmentId'));
    if (!environment) return c.json({ ok: false, error: 'Execution environment not found' }, 404);
    const inspection = environment.kind === 'managed_worktree'
      ? await worktrees.inspect(environment.id).catch(() => undefined)
      : undefined;
    return c.json({ ok: true, environment, ...(inspection ? { inspection } : {}) });
  });

  authenticated.post('/api/execution-environments/:environmentId/reconcile', async (c) => {
    try {
      const environment = await worktrees.reconcile(c.req.param('environmentId'));
      return c.json({ ok: true, environment });
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.delete('/api/execution-environments/:environmentId', async (c) => {
    try {
      const environment = await worktrees.remove(c.req.param('environmentId'));
      return c.json({ ok: true, environment });
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });
}
