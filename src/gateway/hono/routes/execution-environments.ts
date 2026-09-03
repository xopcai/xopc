import type { Hono } from 'hono';

import { LocalWorktreeManager } from '../../../execution-environments/local-worktree-manager.js';
import {
  ExecutionEnvironmentHandoffPendingError,
  ExecutionEnvironmentHandoffService,
} from '../../../execution-environments/handoff-service.js';
import { ExecutionEnvironmentHandoffStore } from '../../../execution-environments/handoff-store.js';
import { RemoteWorktreeManager } from '../../../execution-environments/remote-worktree-manager.js';
import { SessionEnvironmentService } from '../../../execution-environments/session-environment-service.js';
import { SnapshotTransferService } from '../../../execution-environments/snapshot-transfer-service.js';
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
  const getRegistry = () => deps.service.executionHosts.registry;
  const remoteWorktrees = new RemoteWorktreeManager({ store, getRegistry });
  const handoffStore = new ExecutionEnvironmentHandoffStore();
  const sessions = new SessionEnvironmentService({ store, worktrees, remoteWorktrees, handoffs: handoffStore });
  const handoffs = new ExecutionEnvironmentHandoffService({
    store,
    handoffs: handoffStore,
    localWorktrees: worktrees,
    remoteWorktrees,
    snapshots: new SnapshotTransferService({ getRegistry }),
    onEnvironmentFrozen: (sessionKey) => deps.service.evictSessionAgent(sessionKey),
  });

  authenticated.get('/api/projects/:projectId/environments', (c) => {
    const projectId = c.req.param('projectId');
    if (!deps.service.projects.get(projectId)) {
      return c.json({ ok: false, error: 'Project not found' }, 404);
    }
    return c.json({ ok: true, environments: store.list({ projectId, includeDeleted: c.req.query('includeDeleted') === 'true' }) });
  });

  authenticated.get('/api/sessions/:sessionKey/environment', (c) => {
    const environment = sessions.get(c.req.param('sessionKey'));
    return environment
      ? c.json({ ok: true, environment })
      : c.json({ ok: false, error: 'Execution environment not found' }, 404);
  });

  authenticated.post('/api/sessions/:sessionKey/environment', async (c) => {
    const sessionKey = c.req.param('sessionKey');
    const session = await deps.service.sessions.getSession(sessionKey);
    if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
    const projectId = session.projectId?.trim();
    const project = projectId ? deps.service.projects.get(projectId) : null;
    if (!project) return c.json({ ok: false, error: 'Session is not attached to a project' }, 409);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = body.mode === undefined ? undefined : executionMode(body.mode);
    if (body.mode !== undefined && !mode) return c.json({ ok: false, error: 'Invalid execution mode' }, 400);
    try {
      const environment = await sessions.attach({
        sessionKey,
        project,
        mode,
        baseRef: typeof body.baseRef === 'string' ? body.baseRef : undefined,
      });
      deps.service.evictSessionAgent(sessionKey);
      return c.json({ ok: true, environment }, 201);
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.delete('/api/sessions/:sessionKey/environment', async (c) => {
    try {
      const sessionKey = c.req.param('sessionKey');
      const environment = await sessions.release(
        sessionKey,
        c.req.query('keepManaged') !== 'true',
      );
      if (environment) deps.service.evictSessionAgent(sessionKey);
      return c.json({ ok: true, environment });
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.get('/api/sessions/:sessionKey/environment/handoff', (c) => {
    const handoff = handoffs.getActiveForSession(c.req.param('sessionKey'));
    return handoff
      ? c.json({ ok: true, handoff, events: handoffStore.listEvents(handoff.id) })
      : c.json({ ok: false, error: 'Active execution environment handoff not found' }, 404);
  });

  authenticated.post('/api/sessions/:sessionKey/environment/handoff', async (c) => {
    const sessionKey = c.req.param('sessionKey');
    if (deps.service.getActiveWebchatRunId(sessionKey)) {
      return c.json({ ok: false, error: 'Wait for the active session run to finish before handoff' }, 409);
    }
    const session = await deps.service.sessions.getSession(sessionKey);
    if (!session) return c.json({ ok: false, error: 'Session not found' }, 404);
    const project = session.projectId ? deps.service.projects.get(session.projectId) : null;
    if (!project) return c.json({ ok: false, error: 'Session is not attached to a project' }, 409);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const targetHostId = typeof body.targetHostId === 'string' ? body.targetHostId.trim() : '';
    if (!targetHostId) return c.json({ ok: false, error: 'targetHostId is required' }, 400);
    try {
      const result = await handoffs.start({ sessionKey, project, targetHostId });
      return c.json({ ok: true, ...result }, result.cleanupPending ? 202 : 200);
    } catch (error) {
      if (error instanceof ExecutionEnvironmentHandoffPendingError) {
        return c.json({ ok: false, pending: true, handoff: error.handoff, error: error.message }, 202);
      }
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.post('/api/execution-environment-handoffs/:handoffId/reconcile', async (c) => {
    const handoff = handoffStore.get(c.req.param('handoffId'));
    if (!handoff) return c.json({ ok: false, error: 'Execution environment handoff not found' }, 404);
    const source = store.get(handoff.sourceEnvironmentId);
    const project = source?.projectId ? deps.service.projects.get(source.projectId) : null;
    if (!project) return c.json({ ok: false, error: 'Handoff project not found' }, 409);
    try {
      const result = await handoffs.reconcile({ handoffId: handoff.id, project });
      return c.json({ ok: true, ...result }, result.cleanupPending ? 202 : 200);
    } catch (error) {
      if (error instanceof ExecutionEnvironmentHandoffPendingError) {
        return c.json({ ok: false, pending: true, handoff: error.handoff, error: error.message }, 202);
      }
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.get('/api/execution-environment-handoffs/:handoffId', (c) => {
    const handoff = handoffStore.get(c.req.param('handoffId'));
    return handoff
      ? c.json({ ok: true, handoff, events: handoffStore.listEvents(handoff.id) })
      : c.json({ ok: false, error: 'Execution environment handoff not found' }, 404);
  });

  authenticated.get('/api/execution-environments/:environmentId', async (c) => {
    const environment = store.get(c.req.param('environmentId'));
    if (!environment) return c.json({ ok: false, error: 'Execution environment not found' }, 404);
    const inspection = environment.kind === 'managed_worktree'
      ? await (environment.hostId === 'local'
          ? worktrees.inspect(environment.id)
          : remoteWorktrees.inspect(environment.id)).catch(() => undefined)
      : undefined;
    return c.json({ ok: true, environment, ...(inspection ? { inspection } : {}) });
  });

  authenticated.post('/api/execution-environments/:environmentId/reconcile', async (c) => {
    try {
      const existing = store.getRequired(c.req.param('environmentId'));
      const environment = await (existing.hostId === 'local'
        ? worktrees.reconcile(existing.id)
        : remoteWorktrees.reconcile(existing.id));
      return c.json({ ok: true, environment });
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });

  authenticated.delete('/api/execution-environments/:environmentId', async (c) => {
    try {
      const environmentId = c.req.param('environmentId');
      if (handoffStore.getActiveForEnvironment(environmentId)) {
        return c.json({ ok: false, error: 'Execution environment has an active handoff' }, 409);
      }
      const existing = store.getRequired(environmentId);
      const environment = await (existing.hostId === 'local'
        ? worktrees.remove(existing.id)
        : remoteWorktrees.remove(existing.id));
      return c.json({ ok: true, environment });
    } catch (error) {
      return c.json(errorResponse(error), 409);
    }
  });
}
