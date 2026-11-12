import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { appendTranscriptEntry, closeXopcDatabase, createContextEvidence, ensureSessionRecord,
  openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { writeKnowledgeItem } from '../../../../knowledge-memory/index.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests, getLoadedLazyRouteBundleIdsForTests } from '../lazy-fallback.js';

describe('memory management through authenticated Gateway HTTP', () => {
  let server: ReturnType<typeof serve>;
  let origin: string;
  beforeEach(async () => {
    resetXopcDatabaseSingletonForTest();
    resetLazyRouteBundlesForTests();
    openXopcDatabase({ path: ':memory:' });
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'memory-test-token', allowTailscale: false }) }));
    registerAuthenticatedLazyRouteFallback(app, {
      service: { currentConfig: ConfigSchema.parse({}) },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    resetLazyRouteBundlesForTests();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${origin}${path}`, {
    method, headers: { authorization: 'Bearer memory-test-token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  it('edits and deletes both memory domains through the lazy bundle', async () => {
    const response = await request('/api/user-model/assertions', 'POST', {
      scope: { type: 'global' }, predicate: 'preference.detail', statement: 'Concise answers', value: 'concise',
    });
    expect(response.status).toBe(201);
    const { assertion } = await response.json();
    const mobileSummary = await request('/api/user-model/mobile-summary');
    expect(mobileSummary.status).toBe(200);
    await expect(mobileSummary.json()).resolves.toMatchObject({ counts: { total: 1, explicit: 1 } });
    const mobilePage = await request('/api/user-model/assertions?view=mobile&filter=explicit&limit=20');
    expect(mobilePage.status).toBe(200);
    await expect(mobilePage.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: assertion.id, statement: 'Concise answers' })],
    });
    const path = `/api/user-model/assertions/${assertion.id}`;
    expect((await fetch(`${origin}${path}`, { method: 'DELETE' })).status).toBe(401);
    const changed = await request(path, 'PATCH', { statement: 'Detailed answers' });
    expect(changed.status).toBe(200);
    const corrected = (await changed.json()).assertion;
    expect((await request(`/api/user-model/assertions/${corrected.id}`, 'DELETE')).status).toBe(200);
    expect((await request(path)).status).toBe(404);

    const knowledge = writeKnowledgeItem({ kind: 'project_fact', scope: { type: 'project', id: 'one' },
      content: 'Atlas uses pnpm', canonicalKey: 'atlas', confidence: 0.8, importance: 0.7, originClass: 'agent' }).item;
    const knowledgePath = `/api/knowledge-memory/${knowledge.id}`;
    expect((await request(`${knowledgePath}/review`, 'POST', { action: 'edit_and_approve', content: 'Atlas uses bun', expectedStatus: 'active' })).status).toBe(200);
    expect((await request(knowledgePath, 'DELETE')).status).toBe(200);
    expect((await request(knowledgePath)).status).toBe(404);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('user-model');
    expect((await request('/api/user-model-other')).status).toBe(404);
    expect((await request('/api/knowledge-memory-other')).status).toBe(404);
  });

  it('keeps work records out of the about view and searches beyond the first management page', async () => {
    for (let index = 0; index < 26; index++) {
      writeKnowledgeItem({
        kind: 'decision', scope: { type: 'project', id: 'atlas' },
        content: index === 0 ? '保留已下载的 H3 文件' : `Atlas decision ${index}`,
        canonicalKey: `decision-${index}`, confidence: 1, importance: 0.7, originClass: 'owner',
        now: 1_000 + index,
      });
    }
    const about = await (await request('/api/user-model?view=about')).json();
    expect(about).not.toHaveProperty('knowledge');
    expect(about).not.toHaveProperty('observations');
    const path = '/api/knowledge-memory?view=manage';
    expect((await fetch(origin + path)).status).toBe(401);
    const first = await (await request(path)).json();
    expect(first.items).toHaveLength(24);
    expect(first.items[0].content).toBe('Atlas decision 25');
    expect(first.items[0].version).toEqual(expect.any(String));
    const second = await (await request(path + '&cursor=' + encodeURIComponent(first.nextCursor))).json();
    expect(second.items.map((item: { content: string }) => item.content)).toEqual(['Atlas decision 1', '保留已下载的 H3 文件']);
    expect(second.nextCursor).toBeUndefined();
    const search = await request(path + '&kind=decision&q=' + encodeURIComponent('h3 文件'));
    await expect(search.json()).resolves.toMatchObject({ items: [{ content: '保留已下载的 H3 文件' }] });
  });

  it('authenticates scope changes and rejects stale knowledge revisions through lazy routing', async () => {
    const original = writeKnowledgeItem({ kind: 'decision', scope: { type: 'global' }, content: 'Use pnpm',
      canonicalKey: 'scope-http', confidence: 1, importance: 0.7, originClass: 'owner' }).item!;
    const path = `/api/knowledge-memory/${original.id}`;
    const { item } = await (await request(path)).json();
    expect(typeof item.version).toBe('string');
    expect((await fetch(`${origin}${path}/scope`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { type: 'agent', id: 'coder' }, version: item.version }) })).status).toBe(401);
    const change = await request(`${path}/scope`, 'PATCH', { scope: { type: 'agent', id: 'coder' }, version: item.version });
    expect(change.status).toBe(200);
    await expect(change.json()).resolves.toMatchObject({ item: { scope: { type: 'agent', id: 'coder' } } });
    expect((await request(`${path}/scope`, 'PATCH', { scope: { type: 'global' }, version: item.version })).status).toBe(409);
    expect((await request(`${path}/scope`, 'PATCH', { scope: { type: 'project' }, version: item.version })).status).toBe(400);
    expect((await request('/api/knowledge-memory-other/id/scope', 'PATCH', {})).status).toBe(404);
  });

  it('shows a scope review suggestion without disclosing tentative evidence excerpts', async () => {
    const conversationId = randomUUID();
    const workspaceId = '/workspace';
    ensureSessionRecord(conversationId, workspaceId, { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    const content = '请记住，在所有项目里，查询 Slack 消息统一使用 slacrawl CLI。';
    const row = appendTranscriptEntry(conversationId, { role: 'user', content, timestamp: Date.now() });
    const contentHash = createHash('sha256').update(content).digest('hex');
    const evidence = createContextEvidence({ sourceType: 'conversation', sourceRef: 'scope-review-http',
      conversationId, messageId: row.entry_id, contentHash, trustLevel: 'trusted', redactedExcerpt: content, observedAt: Date.now() });
    const item = writeKnowledgeItem({ kind: 'decision', scope: { type: 'workspace', id: workspaceId },
      content: 'Use slacrawl for Slack queries.', canonicalKey: 'scope-review-http', confidence: 0.6, importance: 0.7,
      verification: 'tentative', status: 'candidate', originClass: 'agent', sourceConversationId: conversationId,
      evidence: [{ id: evidence.id, contentHash }] }).item!;
    const path = `/api/knowledge-memory/${item.id}/evidence`;
    expect((await fetch(origin + path)).status).toBe(401);
    await expect((await request(path)).json()).resolves.toEqual({ evidence: [], reviewSuggestion: 'global_collaboration_rule' });
    expect((await request(path + '?workspaceId=/other')).status).toBe(404);
  });

  it('creates and edits a recent goal through the mobile user-model routes', async () => {
    const created = await request('/api/user-model/goals', 'POST', {
      title: 'Ship goal editing', desiredOutcome: 'Mobile users can keep their near-term goals accurate.',
      scope: { type: 'global' }, targetAt: 2_000,
    });
    expect(created.status).toBe(201);
    const goal = (await created.json()).goal;

    const summary = await request('/api/user-model/mobile-summary');
    await expect(summary.json()).resolves.toMatchObject({
      goals: [expect.objectContaining({ id: goal.id, title: 'Ship goal editing', status: 'active' })],
    });

    const changed = await request(`/api/user-model/goals/${goal.id}`, 'PATCH', {
      title: 'Ship polished goal editing',
      desiredOutcome: 'The goal is clear and paused while waiting for verification.',
      targetAt: null,
      status: 'paused',
    });
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({
      goal: { id: goal.id, title: 'Ship polished goal editing', status: 'paused' },
    });
  });
});
