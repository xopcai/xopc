import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalWorktreeManager } from '../../../../execution-environments/local-worktree-manager.js';
import { ExecutionEnvironmentStore } from '../../../../execution-environments/store.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import { registerExecutionEnvironmentRoutes } from '../execution-environments.js';
import { registerSessionsRoutes } from '../sessions.js';

describe('local execution environment routes', () => {
  let stateDir: string;
  let app: Hono;
  let store: ExecutionEnvironmentStore;
  let environmentId: string;
  const getActiveWebchatRunId = vi.fn();
  const deleteSession = vi.fn();

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-environment-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    store = new ExecutionEnvironmentStore();
    const environment = await new LocalWorktreeManager({ store }).registerLocalCheckout({ workspacePath: stateDir });
    environmentId = environment.id;
    store.bind({ sessionKey: 'session-a', environmentId });
    getActiveWebchatRunId.mockReset();
    deleteSession.mockReset();
    const service = {
      getActiveWebchatRunId,
      sessions: { delete: deleteSession },
    } as unknown as GatewayService;
    app = new Hono();
    registerExecutionEnvironmentRoutes(app, { service });
    registerSessionsRoutes(app, { service });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it.each([
    ['POST', '/api/sessions/session-a/environment'],
    ['DELETE', '/api/sessions/session-a/environment'],
    ['DELETE', '/api/sessions/session-a'],
  ])('rejects %s %s while the session is running', async (method, path) => {
    getActiveWebchatRunId.mockReturnValue('run-a');

    const response = await app.request(path, { method });

    expect(response.status).toBe(409);
    expect(store.resolveBinding('session-a')?.environmentId).toBe(environmentId);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('releases an idle local checkout without retiring the user directory', async () => {
    const response = await app.request('/api/sessions/session-a/environment', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(store.resolveBinding('session-a')).toBeUndefined();
    expect(store.get(environmentId)?.status).toBe('ready');
  });

  it('refuses direct deletion of a bound environment', async () => {
    const response = await app.request(`/api/execution-environments/${environmentId}`, { method: 'DELETE' });

    expect(response.status).toBe(409);
    expect(store.resolveBinding('session-a')).toBeDefined();
  });
});
