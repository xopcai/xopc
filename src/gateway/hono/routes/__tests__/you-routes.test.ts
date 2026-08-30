import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase, openXopcDatabase, recordContextRun, resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { upsertUserFocus } from '../../../../user-context/sources/repository.js';
import { registerYouRoutes } from '../you.js';

describe('structured user context routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-you-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    registerYouRoutes(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
      service: {},
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('serves profile, understanding, and rules as separate domains', async () => {
    const profile = await app.request('/api/you/profile', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callName: 'Mic', timezone: 'Asia/Shanghai' }),
    });
    expect(profile.status).toBe(200);

    const understanding = await app.request('/api/you/understandings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'preference', statement: 'Lead with the conclusion.' }),
    });
    expect(understanding.status).toBe(201);

    const rule = await app.request('/api/you/rules', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'execution', statement: 'Run tests before handoff.' }),
    });
    expect(rule.status).toBe(201);

    upsertUserFocus({
      canonicalKey: 'focus:ship', title: 'Ship xopc', summary: 'Prepare the release',
      horizon: 'current', status: 'active', confidence: 1, evidenceRefs: [],
    });

    const response = await app.request('/api/you');
    await expect(response.json()).resolves.toMatchObject({
      profile: { callName: 'Mic', timezone: 'Asia/Shanghai' },
      understandings: [{ kind: 'preference', statement: 'Lead with the conclusion.', status: 'active' }],
      focuses: [{ title: 'Ship xopc', status: 'active' }],
      rules: [{ category: 'execution', statement: 'Run tests before handoff.', status: 'active' }],
    });
  });

  it('offers a local call-name suggestion without persisting it', async () => {
    const response = await app.request('/api/you/profile');
    const body = await response.json() as { profile: { callName: string }; suggestedCallName: string };
    expect(body.profile.callName).toBe('');
    expect(typeof body.suggestedCallName).toBe('string');
  });

  it('rejects invalid domain values and exposes no Markdown profile endpoint', async () => {
    const invalid = await app.request('/api/you/understandings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'unknown', statement: 'Something' }),
    });
    expect(invalid.status).toBe(400);
    const invalidTimezone = await app.request('/api/you/profile', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'not/a-timezone' }),
    });
    expect(invalidTimezone.status).toBe(400);
    expect((await app.request('/api/user-profile')).status).toBe(404);
  });

  it('returns a conflict instead of failing when understanding already exists', async () => {
    const body = JSON.stringify({ kind: 'preference', statement: 'Use concise answers.' });
    expect((await app.request('/api/you/understandings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).status).toBe(201);
    expect((await app.request('/api/you/understandings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).status).toBe(409);
  });

  it('rejects feedback for objects outside the turn and unknown consent requests', async () => {
    recordContextRun({
      turnId: 'turn-1', sessionKey: 'session-1', query: 'test', budget: 100, durationMs: 1,
      items: [{
        objectType: 'understanding', objectId: 'known', decision: 'selected', reason: 'test',
        content: 'Known context', sourceLabel: 'test', origin: 'inferred', injectedChars: 13,
      }],
    });
    const feedback = await app.request('/api/you/turns/turn-1/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'wrong', objectType: 'understanding', objectId: 'other' }),
    });
    expect(feedback.status).toBe(400);

    const consent = await app.request('/api/you/consents/missing', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'once' }),
    });
    expect(consent.status).toBe(404);
  });

  it('lists evidence-first review objects and applies batch decisions', async () => {
    const focus = upsertUserFocus({
      canonicalKey: 'focus:review', title: 'Review launch', summary: 'Prepare the launch review',
      horizon: 'current', status: 'candidate', confidence: 0.72, evidenceRefs: ['source://launch'],
    });
    const review = await app.request('/api/you/context-objects?view=review');
    expect(review.status).toBe(200);
    await expect(review.json()).resolves.toMatchObject({
      objects: [{
        objectType: 'focus', objectId: focus.id, status: 'candidate', origin: 'inferred',
        evidence: [{ sourceRef: 'source://launch' }],
      }],
    });

    const decision = await app.request('/api/you/context-objects/batch-review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: [{ objectType: 'focus', objectId: focus.id, action: 'accept' }] }),
    });
    expect(decision.status).toBe(200);
    await expect(decision.json()).resolves.toMatchObject({ objects: [{ id: focus.id, status: 'active' }] });
    await expect((await app.request('/api/you/context-objects?view=current')).json()).resolves.toMatchObject({
      objects: [expect.objectContaining({ objectType: 'focus', objectId: focus.id, status: 'active' })],
    });
  });

  it('accepts focus feedback only when the focus shaped the turn', async () => {
    const focus = upsertUserFocus({
      canonicalKey: 'focus:feedback', title: 'Feedback target', summary: 'Target focus',
      horizon: 'current', status: 'active', confidence: 1, evidenceRefs: [],
    });
    recordContextRun({
      turnId: 'turn-focus', sessionKey: 'session-1', query: 'target', budget: 100, durationMs: 1,
      items: [{
        objectType: 'focus', objectId: focus.id, decision: 'selected', reason: 'test',
        content: 'Feedback target: Target focus', sourceLabel: 'You set this focus',
        origin: 'told_by_user', injectedChars: 29,
      }],
    });
    const response = await app.request('/api/you/turns/turn-focus/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'wrong', objectType: 'focus', objectId: focus.id }),
    });
    expect(response.status).toBe(200);
    await expect((await app.request('/api/you')).json()).resolves.toMatchObject({
      focuses: [expect.objectContaining({ id: focus.id, status: 'rejected' })],
    });
  });
});
