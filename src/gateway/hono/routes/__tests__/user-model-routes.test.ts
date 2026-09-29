import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../../config/schema.js';
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
  let config: Config;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-user-model-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    app = new Hono();
    config = ConfigSchema.parse({});
    const service = {
      currentConfig: config,
      async saveConfig(nextConfig: Config) {
        config = nextConfig;
        service.currentConfig = nextConfig;
        return { saved: true };
      },
    };
    registerUserModelRoutes(app, {
      service,
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
      settings: {
        memoryEnabled: boolean;
        showMemoryReferences: boolean;
        sensitiveWritePolicy: string;
      };
    };
    const username = userInfo().username.trim();
    const expected = ['root', 'admin', 'administrator', 'user'].includes(username.toLocaleLowerCase())
      ? ''
      : username.slice(0, 100);

    expect(response.status).toBe(200);
    expect(body.profile.callName).toBeUndefined();
    expect(body.suggestedCallName).toBe(expected);
    expect(body).toMatchObject({
      settings: {
        memoryEnabled: true,
        showMemoryReferences: true,
        sensitiveWritePolicy: 'confirm',
      },
    });

    const exported = await app.request('/api/user-model/export');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('Content-Disposition')).toMatch(/^attachment; filename="xopc-memory-/);
    await expect(exported.json()).resolves.toMatchObject({
      format: 'xopc-user-memory',
      version: 1,
      data: { settings: { memoryEnabled: true } },
    });

    const updated = await app.request('/api/user-model/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memoryEnabled: false, showMemoryReferences: false, sensitiveWritePolicy: 'deny' }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({
      settings: { memoryEnabled: false, showMemoryReferences: false, sensitiveWritePolicy: 'deny' },
    });
    expect(config.userContext.userModel.enabled).toBe(false);
    expect(config.userContext.knowledgeMemory.enabled).toBe(false);
  });

  it('returns a bounded mobile summary and filtered assertion pages', async () => {
    for (const [predicate, authority, statement] of [
      ['preference.response_style', 'user_explicit', 'Prefer concise answers.'],
      ['routine.focus_time', 'system_inferred', 'Usually focuses in the morning.'],
    ] as const) {
      reconcileAssertion({
        subject: { type: 'user', id: 'self' },
        predicate,
        cardinality: 'single',
        scope: { type: 'global' },
        kind: predicate.startsWith('routine') ? 'routine' : 'preference',
        value: statement,
        normalizedValue: statement.toLocaleLowerCase(),
        statement,
        authority,
        confidence: 0.9,
        inferredImportance: 0.8,
        consequence: 'medium',
        actionability: 0.8,
        volatility: 'stable',
        sensitivity: 'normal',
        disclosurePolicy: 'referenceable',
        observedAt: Date.now(),
        createdBy: authority === 'user_explicit' ? 'user' : 'runtime',
      });
    }

    const summaryResponse = await app.request('/api/user-model/mobile-summary');
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      counts: { total: 2, explicit: 1, learned: 1, review: 0 },
      recent: expect.arrayContaining([
        expect.objectContaining({ statement: 'Prefer concise answers.' }),
      ]),
    });

    const learnedResponse = await app.request('/api/user-model/assertions?view=mobile&filter=learned&limit=1');
    expect(learnedResponse.status).toBe(200);
    await expect(learnedResponse.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ authority: 'system_inferred' })],
    });
    const textSearch = await app.request('/api/user-model/assertions?view=mobile&q=concise');
    expect(textSearch.status).toBe(200);
    await expect(textSearch.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ statement: 'Prefer concise answers.' })],
    });
    const statusSearch = await app.request('/api/user-model/assertions?view=mobile&q=' + encodeURIComponent('逐渐学到'));
    await expect(statusSearch.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ authority: 'system_inferred' })],
    });
    expect((await app.request('/api/user-model/assertions?view=mobile&filter=unknown')).status).toBe(400);
    expect((await app.request('/api/user-model/assertions?view=mobile&cursor=broken')).status).toBe(400);
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
    const assertionResult = await assertionResponse.json() as { assertion: { id: string } };
    expect(assertionResult).toMatchObject({
      action: 'created', assertion: { authority: 'user_explicit', status: 'active' },
    });

    const scopeResponse = await app.request(`/api/user-model/assertions/${assertionResult.assertion.id}/scope`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { type: 'agent', id: 'main' } }),
    });
    expect(scopeResponse.status).toBe(200);
    await expect(scopeResponse.json()).resolves.toMatchObject({
      assertion: { id: assertionResult.assertion.id, scope: { type: 'agent', id: 'main' } },
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
    const priority = await priorityResponse.json() as { priority: { id: string } };

    const revisedValidTo = now + 2 * 86_400_000;
    const priorityUpdate = await app.request(`/api/user-model/priorities/${priority.priority.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Ship a better user model',
        desiredOutcome: 'Agents receive accurate, editable context.',
        validTo: revisedValidTo,
      }),
    });
    expect(priorityUpdate.status).toBe(200);
    await expect(priorityUpdate.json()).resolves.toMatchObject({
      goal: {
        id: goal.goal.id,
        title: 'Ship a better user model',
        desiredOutcome: 'Agents receive accurate, editable context.',
      },
      priority: { id: priority.priority.id, validTo: revisedValidTo, status: 'active' },
    });

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
        scope: { type: 'agent', id: 'main' },
        statement: 'Prefer concise answers.',
      }],
      counts: { activeAssertions: 1, activeGoals: 1, activePriorities: 1 },
      goals: [{ title: 'Ship a better user model' }],
      knowledge: [],
      maintenance: {
        lastRun: { jobType: 'temporal_sweep', status: 'completed', startedAt: now, finishedAt: now },
      },
    });
  });

  it('lets the user end a current priority without deleting its goal', async () => {
    const goalResponse = await app.request('/api/user-model/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Finish the release', desiredOutcome: 'The release is live.', scope: { type: 'global' },
      }),
    });
    const goal = await goalResponse.json() as { goal: { id: string } };
    const now = Date.now();
    const priorityResponse = await app.request('/api/user-model/priorities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetType: 'goal', targetId: goal.goal.id, rank: 'primary', urgency: 0.9,
        scope: { type: 'global' }, validFrom: now, validTo: now + 86_400_000,
      }),
    });
    const priority = await priorityResponse.json() as { priority: { id: string } };

    const ended = await app.request(`/api/user-model/priorities/${priority.priority.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(ended.status).toBe(200);
    await expect(ended.json()).resolves.toMatchObject({ priority: { status: 'completed' } });

    const summary = await app.request('/api/user-model');
    await expect(summary.json()).resolves.toMatchObject({
      goals: [{ id: goal.goal.id, status: 'active' }],
      counts: { activeGoals: 1, activePriorities: 0 },
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
      authority: 'user_explicit',
      confidence: 1,
      inferredImportance: 0.6,
      consequence: 'low',
      actionability: 0.6,
      volatility: 'slow',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      observedAt: 1_500,
      reviewAt: Date.now() + 86_400_000,
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
    const mobileSearch = await app.request('/api/user-model/assertions?view=mobile&q=apple-notes');
    await expect(mobileSearch.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: assertion.id, sources: [expect.objectContaining({ label: 'apple-notes' })] })],
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

  it('reviews candidate knowledge with optimistic concurrency', async () => {
    const candidate = writeKnowledgeItem({
      kind: 'decision',
      scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'decision:candidate',
      content: 'Release on Friday.',
      status: 'candidate',
      confidence: 0.8,
      importance: 0.9,
      originClass: 'agent',
    }).item;
    const review = await app.request(`/api/knowledge-memory/${candidate.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'edit_and_approve',
        expectedStatus: 'candidate',
        content: 'Release on Monday.',
      }),
    });
    expect(review.status).toBe(200);
    await expect(review.json()).resolves.toMatchObject({
      item: { id: candidate.id, status: 'active', content: 'Release on Monday.' },
    });

    const staleReview = await app.request(`/api/knowledge-memory/${candidate.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'archive', expectedStatus: 'candidate' }),
    });
    expect(staleReview.status).toBe(409);
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
