import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSessionMetadata, deleteSessionRecord } from '../../storage/sqlite/session-repository.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

vi.mock('../../providers/index.js', async importOriginal => ({ ...await importOriginal<object>(), resolveModel: () => ({ id: 'model' }) }));
vi.mock('../../providers/model-thinking.js', () => ({ getModelThinking: () => ({ options: ['off'] }) }));
vi.mock('../../tui/tui-startup-resources.js', () => ({ collectTuiStartupResources: (_config: object, conversationId?: string, options?: { agentId?: string }) => ({
  context: [], skills: [], workflows: [], connectors: [], conversationId, agentId: options?.agentId,
}) }));
vi.mock('../../review/review-git.js', () => ({ resolveGitRoot: async (workspace: string) => workspace, buildReviewContext: async (workspace: string) => ({ workspace }) }));

it('receives strict first inputs through a listening authenticated Gateway, replays receipts and refuses resurrection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-command-http-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  seedTestAgentCatalog();
  const token = 'session-command-test-token';
  const drain = vi.fn(async () => {});
  const service = {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
    projects: { get: () => null },
    sessions: { getSession: async (id: string) => getSessionMetadata(id), getAgentConfig: async () => ({ model: 'test/model', thinkingLevel: 'off', fixedModel: true }) },
    getSessionInputState,
    emit: vi.fn(),
    prepareSessionCommandInput: async (input: { content: string; origin: object }) => ({ status: 'queued', requestedDelivery: 'next', effectiveDelivery: 'next', content: input.content, origin: input.origin }),
    drainSessionInputs: drain, sessionPreparations: { wake: vi.fn() },
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const base = `http://127.0.0.1:${address.port}`;
    const id = randomUUID();
    const path = `/api/sessions/${id}/inputs`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const startup = await fetch(`${base}/api/tui/startup-resources?agentId=main`, { headers });
    expect(startup.status).toBe(200);
    expect((await startup.json()).payload).toMatchObject({ agentId: 'main' });
    const review = await fetch(`${base}/api/review/context?agentId=main`, { headers });
    expect(review.status, await review.clone().text()).toBe(200);
    expect(getSessionMetadata(id)).toBeNull();
    const command = { kind: 'start', clientMessageId: randomUUID(),
      creation: { agentId: 'main', projectId: null, execution: null, model: 'test/model', thinkingLevel: 'off', temporary: false },
      input: { content: 'hello' }, origin: { type: 'system', source: 'cli' } };
    const post = (body: object) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await fetch(base + path, { method: 'POST', body: JSON.stringify(command) })).status).toBe(401);
    expect((await post({ content: 'old flat request', clientMessageId: 'old', delivery: 'next' })).status).toBe(400);
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', headers, body: '{}' })).status).toBe(404);
    const accepted = await post(command);
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    const first = await accepted.json();
    expect(first.payload.receipt.conversationId).toBe(id);
    const replay = await (await post(command)).json();
    expect(replay.payload.receipt).toEqual(first.payload.receipt);
    expect(getSessionInputState(id).inputs).toHaveLength(1);
    expect((await post({ ...command, input: { content: 'changed' } })).status).toBe(409);
    const receiptPath = `${base}/api/sessions/${id}/input-receipts/${command.clientMessageId}`;
    expect((await fetch(receiptPath, { headers })).status).toBe(200);
    deleteSessionRecord(id);
    expect((await post(command)).status).toBe(410);
    expect((await fetch(receiptPath, { headers })).status).toBe(410);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
