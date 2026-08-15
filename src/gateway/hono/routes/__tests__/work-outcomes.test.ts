import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  completeTaskOutcome,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startTaskOutcome,
} from '../../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerTaskOutcomeRoutes } from '../task-outcomes.js';

describe('work outcome receipt routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-outcomes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('session-1', stateDir);
    startTaskOutcome({
      runId: 'run-1',
      sessionKey: 'session-1',
      channel: 'webchat',
      objective: 'Prepare the release',
      context: { projectId: 'project-1', origin: 'chat', triggerKind: 'user' },
      now: 100,
    });
    completeTaskOutcome({ runId: 'run-1', status: 'succeeded', summary: 'Release prepared', now: 200 });
    app = new Hono();
    registerTaskOutcomeRoutes(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as AuthenticatedRouteDeps);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('lists receipts by project and records direct feedback', async () => {
    const list = await app.request('/api/work/outcomes?projectId=project-1');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      ok: true,
      items: [{ runId: 'run-1', status: 'completed', summary: 'Release prepared' }],
    });

    const feedback = await app.request('/api/work/outcomes/run-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'helpful' }),
    });
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toMatchObject({
      ok: true,
      receipt: { feedback: { outcome: 'helpful' } },
    });
  });
});
