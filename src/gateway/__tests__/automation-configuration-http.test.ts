import { buildExecutionScopeContextForPrompt } from '../../agent/context/execution-scope.js';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { createAutomationTool } from '../../agent/tools/automation-tool.js';
import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { getAutomationSetup, buildAutomationSetupContext } from '../../automations/configuration-conversation.js';

it('closes task creation, persistent configuration, live reads and revision-safe form edits over authenticated lazy HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-task-config-'));
  const dbPath = join(dir, 'xopc.db');
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: dbPath });
  seedTestAgentCatalog();
  const service = new AutomationService();
  const token = 'automation-configuration-test-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null, emit: vi.fn(),
    automationServiceInstance: service,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
    const base = `http://127.0.0.1:${address.port}/api/automations`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const open = (body: unknown) => fetch(`${base}/configuration-conversations`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await fetch(`${base}/configuration-conversations`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await open({ projectId: 3 })).status).toBe(400);
    expect((await open({ automationId: 'missing' })).status).toBe(404);
    const response = await open({});
    expect(response.status).toBe(200);
    const { conversationId } = await response.json() as { conversationId: string };
    expect(getAutomationSetup(conversationId)).toEqual({});
    expect(await service.list()).toHaveLength(0);
    expect(buildAutomationSetupContext(conversationId)).toContain('Draft: no scheduled task exists yet');
    const deps = { getAutomationService: () => service, getCurrentConversationId: () => conversationId };
    const direct = createAutomationTool(deps);
    const input = { name: 'Weekly report', trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * 1', tz: 'Asia/Shanghai' } }, action: { kind: 'agent', instruction: 'Summarize the week.' } };
    const created = await direct.execute('create', { action: 'create', automation: input, idempotencyKey: 'create-weekly' });
    const task = created.details.automation as { id: string; updatedAtMs: number };
    expect(created.details.delivery).toMatchObject({ primary: { kind: 'automation', id: task.id } });
    expect(getAutomationSetup(conversationId)).toEqual({ automationId: task.id });
    expect(buildAutomationSetupContext(conversationId)).toContain(task.id);
    await expect(direct.execute('duplicate', { action: 'create', automation: input })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await service.list()).toHaveLength(1);
    const failedDraft = await (await open({})).json() as { conversationId: string };
    const failedTool = createAutomationTool({ getAutomationService: () => service, getCurrentConversationId: () => failedDraft.conversationId });
    await expect(failedTool.execute('collision', { action: 'create', automation: { ...input, id: task.id } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(getAutomationSetup(failedDraft.conversationId)).toEqual({});
    expect(await service.list()).toHaveLength(1);
    const noRevision = await direct.execute('unsafe-update', { action: 'update', automationId: task.id, patch: { name: 'Must not save' } });
    expect(noRevision.details).toMatchObject({ ok: false });
    // Replaying a committed create still returns its receipt, without creating a second task.
    expect((await direct.execute('replay', { action: 'create', automation: input, idempotencyKey: 'create-weekly' })).details.automation).toMatchObject({ id: task.id });
    const read = await direct.execute('get', { action: 'get', automationId: task.id });
    expect(read.details.automation).toMatchObject({ id: task.id });
    const unified = createXopcUseTool(deps);
    const updated = await unified.execute('update', { mode: 'automation', command: 'update', args: { automationId: task.id, expectedRevision: task.updatedAtMs, patch: { name: 'Updated in chat' } } });
    expect(updated.details.result).toMatchObject({ automation: { id: task.id, name: 'Updated in chat' } });
    const current = (await service.get(task.id))!;
    const formSave = await fetch(`${base}/${task.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Edited in form', expectedRevision: current.updatedAtMs }) });
    expect(formSave.status).toBe(200);
    const stale = await fetch(`${base}/${task.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Stale overwrite', expectedRevision: current.updatedAtMs }) });
    expect(stale.status).toBe(409);
    expect(buildExecutionScopeContextForPrompt(conversationId)).toContain('Edited in form');
    expect(await (await fetch(`${base}/configuration-conversations/${conversationId}`, { headers })).json()).toMatchObject({ deleted: false, automation: { id: task.id, name: 'Edited in form' } });
    expect(await (await open({ automationId: task.id })).json()).toEqual({ conversationId });
    // Reopening the database proves the relation is not held in process or browser memory.
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: dbPath });
    expect(await (await open({ automationId: task.id })).json()).toEqual({ conversationId });
    await service.remove(task.id);
    expect(await (await fetch(`${base}/configuration-conversations/${conversationId}`, { headers })).json()).toEqual({ automation: null, deleted: true });
    expect(buildAutomationSetupContext(conversationId)).toContain('The task was deleted');
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
