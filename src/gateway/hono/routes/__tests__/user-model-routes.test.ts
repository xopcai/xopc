import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { writeKnowledgeItem } from '../../../../knowledge-memory/index.js';
import { runMemoryMaintenance } from '../../../../memory-maintenance/index.js';
import { registerUserModelRoutes } from '../user-model.js';

describe('user model routes', () => {
  let root: string;
  let app: Hono;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-user-model-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    app = new Hono();
    registerUserModelRoutes(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates typed assertions, goals, and bounded priorities', async () => {
    const assertionResponse = await app.request('/api/user-model/assertions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        predicate: 'preference.response_style',
        value: 'concise',
        statement: 'Prefer concise answers.',
        kind: 'preference',
        scope: { type: 'global' },
        declaredImportance: 0.9,
      }),
    });
    expect(assertionResponse.status).toBe(201);
    await expect(assertionResponse.json()).resolves.toMatchObject({
      action: 'created', assertion: { authority: 'user_explicit', status: 'active' },
    });

    const goalResponse = await app.request('/api/user-model/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Ship user model',
        desiredOutcome: 'Agents receive precise context.',
        scope: { type: 'global' },
        declaredImportance: 1,
      }),
    });
    const goal = (await goalResponse.json()) as { goal: { id: string } };
    expect(goalResponse.status).toBe(201);

    const now = Date.now();
    const priorityResponse = await app.request('/api/user-model/priorities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetType: 'goal', targetId: goal.goal.id, rank: 'primary', urgency: 0.9,
        scope: { type: 'global' }, validFrom: now, validTo: now + 86_400_000,
      }),
    });
    expect(priorityResponse.status).toBe(201);

    runMemoryMaintenance({
      jobType: 'temporal_sweep', idempotencyKey: 'route-test:sweep', now,
    });
    writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'source-item:gmail:message-1', content: '{"subject":"Build failed"}',
      recordClass: 'source_index', confidence: 0.8, importance: 0.5,
      originClass: 'untrusted', status: 'active',
    });

    const summary = await app.request('/api/user-model');
    await expect(summary.json()).resolves.toMatchObject({
      assertions: [{
        predicate: 'preference.response_style',
        scope: { type: 'global' },
        statement: 'Prefer concise answers.',
      }],
      counts: { activeAssertions: 1, activeGoals: 1, activePriorities: 1 },
      knowledge: [],
      maintenance: {
        lastRun: { jobType: 'temporal_sweep', status: 'completed', startedAt: now, finishedAt: now },
      },
    });
  });

  it('rejects unbounded or invalid typed writes', async () => {
    const response = await app.request('/api/user-model/priorities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetType: 'topic', targetId: 'release', rank: 'primary', urgency: 2,
        scope: { type: 'global' }, validFrom: 20, validTo: 10,
      }),
    });
    expect(response.status).toBe(400);
  });

  it('updates explicit profile fields through the typed user model', async () => {
    const update = await app.request('/api/user-model/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callName: 'Mic',
        role: 'Founder',
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
      }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      profile: { callName: 'Mic', role: 'Founder', timezone: 'Asia/Shanghai', locale: 'zh-CN' },
    });

    const scoped = await app.request('/api/user-model/assertions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        predicate: 'identity.role',
        value: 'Project lead',
        statement: 'The user is the project lead in this project.',
        kind: 'identity',
        scope: { type: 'project', id: 'project-1' },
      }),
    });
    expect(scoped.status).toBe(201);
    const summary = await app.request('/api/user-model');
    await expect(summary.json()).resolves.toMatchObject({ profile: { role: 'Founder' } });

    const clear = await app.request('/api/user-model/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: '' }),
    });
    const result = await clear.json() as { profile: Record<string, unknown> };
    expect(clear.status).toBe(200);
    expect(result.profile).not.toHaveProperty('role');
  });
});
