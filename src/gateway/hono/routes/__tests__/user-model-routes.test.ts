import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createContextEvidence,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { upsertUnderstandingSourceGrant } from '../../../../user-context/sources/repository.js';
import { linkAssertionEvidence, reconcileAssertion } from '../../../../user-model/index.js';
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

  it('offers the local account name as a non-persisted call-name suggestion', async () => {
    const response = await app.request('/api/user-model');
    const body = await response.json() as {
      profile: { callName?: string };
      suggestedCallName: string;
    };
    const username = userInfo().username.trim();
    const expected = ['root', 'admin', 'administrator', 'user'].includes(username.toLocaleLowerCase())
      ? ''
      : username.slice(0, 100);

    expect(response.status).toBe(200);
    expect(body.profile.callName).toBeUndefined();
    expect(body.suggestedCallName).toBe(expected);
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

  it('returns global understanding with the channel that formed it', async () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'local:apple-notes',
      adapterId: 'apple-notes',
      category: 'notes',
      platform: 'darwin',
      displayName: 'apple-notes',
      accessMode: 'once',
      retentionPolicy: 'derived_only',
      processingPolicy: 'local_only',
      config: { readOnly: true },
      lastCollectedAt: 2_000,
      nowMs: 2_000,
    });
    const evidence = createContextEvidence({
      sourceType: 'runtime',
      sourceRef: `understanding-source-grant:${grant.id}:candidate-1`,
      trustLevel: 'trusted',
      observedAt: 1_500,
    });
    const assertion = reconcileAssertion({
      subject: { type: 'user', id: 'self' },
      predicate: 'routine.work_discovery.weekly-planning',
      cardinality: 'single',
      scope: { type: 'global' },
      kind: 'routine',
      value: 'Plans the week on Mondays.',
      normalizedValue: 'plans the week on mondays',
      statement: 'Plans the week on Mondays.',
      authority: 'system_inferred',
      confidence: 0.8,
      inferredImportance: 0.6,
      consequence: 'low',
      actionability: 0.6,
      volatility: 'slow',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      observedAt: 1_500,
      createdBy: 'runtime',
    }, 1_500).assertion;
    linkAssertionEvidence(assertion.id, evidence.id, 'supports', 0.8, 1_500);

    const response = await app.request('/api/user-model');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sources: [{
        id: grant.id,
        kind: 'local_source',
        adapterId: 'apple-notes',
        category: 'notes',
        displayName: 'apple-notes',
        lastCollectedAt: 2_000,
      }],
      assertions: [{
        id: assertion.id,
        scope: { type: 'global' },
        sources: [{
          id: 'source:apple-notes',
          kind: 'local_source',
          label: 'apple-notes',
          category: 'notes',
          observedAt: 1_500,
        }],
      }],
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

  it('bootstraps explicit role, goals, collaboration rules, and relationships idempotently', async () => {
    const payload = {
      profile: { callName: 'Mic', role: 'Founder', timezone: 'Asia/Shanghai', locale: 'zh-CN' },
      responsibilities: ['Own product direction'],
      goals: ['Ship the private beta'],
      communicationPreferences: ['Lead with the conclusion'],
      boundaries: ['Ask before sending anything externally'],
      relationships: ['Alice is my cofounder'],
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.request('/api/user-model/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(201);
      if (attempt === 1) {
        await expect(response.json()).resolves.toMatchObject({
          created: { assertions: 0, goals: 0, rules: 0 },
        });
      }
    }

    const summary = await (await app.request('/api/user-model')).json() as {
      profile: Record<string, unknown>;
      assertions: Array<{ kind: string; statement: string; status: string }>;
      goals: Array<{ desiredOutcome: string; status: string }>;
      rules: Array<{ category: string; statement: string; status: string; conditions: Record<string, unknown> }>;
      priorities: Array<{ targetType: string; status: string }>;
    };
    expect(summary.profile).toMatchObject({ callName: 'Mic', role: 'Founder', locale: 'zh-CN' });
    expect(summary.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'identity', statement: 'Own product direction', status: 'active' }),
      expect.objectContaining({ kind: 'relationship', statement: 'Alice is my cofounder', status: 'active' }),
    ]));
    expect(summary.goals).toEqual([
      expect.objectContaining({ desiredOutcome: 'Ship the private beta', status: 'active' }),
    ]);
    expect(summary.priorities).toEqual([
      expect.objectContaining({ targetType: 'goal', status: 'active' }),
    ]);
    expect(summary.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'communication', statement: 'Lead with the conclusion', status: 'active' }),
      expect.objectContaining({
        category: 'boundary', statement: 'Ask before sending anything externally', status: 'active',
        conditions: expect.objectContaining({ enforcementLevel: 'prompt' }),
      }),
    ]));
  });
});
