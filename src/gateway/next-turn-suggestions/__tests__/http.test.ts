import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const { modelFixture } = vi.hoisted(() => ({ modelFixture: {
  id: 'fast', name: 'Local next turn fixture', provider: 'fixture', api: 'openai-completions', baseUrl: '',
  reasoning: false, input: ['text'], contextWindow: 16000, maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} }));
vi.mock('../../../providers/index.js', async original => ({
  ...await original<typeof import('../../../providers/index.js')>(), resolveModel: () => modelFixture,
}));

import { NextTurnSuggestionService } from '../service.js';
import { auth } from '../../hono/middleware/auth.js';
import { gatewayScopes } from '../../hono/middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback, getLoadedLazyRouteBundleIdsForTests, resetLazyRouteBundlesForTests } from '../../hono/routes/lazy-fallback.js';
import type { AuthenticatedRouteDeps } from '../../hono/routes/deps.js';
import { ConfigSchema } from '../../../config/schema.js';
import { appendTranscriptEntry, claimNextSessionInput, closeXopcDatabase, ensureSessionRecord, finishSessionInputRun,
  getCurrentTranscriptId, insertSessionInput, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';

describe('next turn suggestion authenticated HTTP boundary', () => {
  it('uses production auth, lazy routing, credentials, and a bounded local provider request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-next-turn-http-'));
    const conversationId = randomUUID();
    const token = randomUUID();
    let modelRequests = 0;
    let requestBody: Record<string, unknown> | undefined;
    const provider = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      modelRequests++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fast',
        choices: [{ index: 0, delta: { role: 'assistant', content: '{"prompt":"把第一阶段拆成可评审的任务"}' }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(delta)}\n\n`);
      res.write(`data: ${JSON.stringify({ ...delta, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    modelFixture.baseUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(conversationId, '', { agentId: 'main', sessionType: 'chat' });
    insertSessionInput({ conversationId, id: randomUUID(), clientMessageId: randomUUID(), requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: '先给方案，不要实现',
      expectedTranscriptId: getCurrentTranscriptId(conversationId)!, origin: { type: 'endpoint', endpointId: 'browser' } });
    claimNextSessionInput(conversationId, 'finished-run');
    appendTranscriptEntry(conversationId, { role: 'user', content: '先给方案，不要实现', timestamp: 1 });
    appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'text', text: '方案已完成，第一阶段可进一步拆解。' }] } as never);
    finishSessionInputRun(conversationId, 'finished-run', 'completed');
    const suggestions = new NextTurnSuggestionService({ getConfig: () => ConfigSchema.parse({}),
      emit: () => {}, isAcceptingInput: () => false, resolveModel: () => 'fixture/fast' });
    resetLazyRouteBundlesForTests();
    const app = new Hono();
    app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token }) }));
    app.use('*', gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, {
      service: { isGatewayReady: () => true, agentRunner: { nextTurnSuggestions: suggestions } },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as AuthenticatedRouteDeps);
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => { if (server.listening) resolve(); else server.once('listening', resolve); });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const path = `/api/sessions/${conversationId}/next-turn-suggestion?locale=zh`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      expect((await fetch(base + path)).status).toBe(401);
      expect((await fetch(base + path, { headers })).status).toBe(200);
      let ready: { status: string; suggestion?: { id: string; prompt: string } } | undefined;
      await vi.waitFor(async () => {
        ready = await (await fetch(base + path, { headers })).json();
        expect(ready?.status).toBe('ready');
      });
      expect(ready?.suggestion?.prompt).toBe('把第一阶段拆成可评审的任务');
      expect(modelRequests).toBe(1);
      expect(JSON.stringify(requestBody)).toContain('先给方案，不要实现');
      expect(requestBody?.tools).toBeUndefined();
      expect(Number(requestBody?.max_tokens ?? requestBody?.max_completion_tokens)).toBe(200);
      expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('next-turn-suggestions');
      expect((await fetch(base + `/api/sessions/${conversationId}/next-turn-suggestion-other`, { headers })).status).toBe(404);
      expect((await fetch(base + path.replace('locale=zh', 'locale=bad'), { headers })).status).toBe(400);
      const body = { suggestionId: ready!.suggestion!.id, impressionId: randomUUID(), event: 'accepted' };
      expect((await fetch(base + `/api/sessions/${conversationId}/next-turn-suggestion-feedback`, {
        method: 'POST', headers, body: JSON.stringify(body),
      })).status).toBe(200);
      expect((await fetch(base + `/api/sessions/${conversationId}/next-turn-suggestion-feedback`, {
        method: 'POST', headers, body: JSON.stringify({ ...body, suggestionId: randomUUID() }),
      })).status).toBe(404);
    } finally {
      suggestions.dispose();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); resetLazyRouteBundlesForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
