import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { resetSessionRecord } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { allowsPersonalTaskNotification } from '../notifications.js';
import { personalAgentId, personalConversationId } from '../repository.js';
import { markPersonalRead, personalUnreadSnapshot } from '../unread.js';

const conversationId = personalConversationId('local-owner');
let directory: string;
function reply(text = 'Done') {
  return appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'text', text }],
    api: 'openai-responses', provider: 'openai', model: 'test', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-unread-'));
  resetXopcDatabaseSingletonForTest();
  seedTestDatabase(join(directory, 'xopc.db'));
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  const catalog = new AgentCatalogRepository();
  catalog.ensureInitialized();
  catalog.create({ id: personalAgentId('local-owner'), profile: { name: 'Joyce' } }, { ready: true });
  createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } }, '', conversationId);
});
afterEach(() => {
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  rmSync(directory, { recursive: true, force: true });
});

describe('Personal AI unread replies', () => {
  it('counts replies rather than tool activity or artifact cards', () => {
    reply();
    appendTranscriptEntry(conversationId, { role: 'custom', customType: 'task_result_delivery', display: true,
      content: 'Artifact', details: { deliveryId: 'artifact' }, timestamp: Date.now() });
    appendTranscriptEntry(conversationId, { role: 'custom', customType: 'task_result_delivery', display: true,
      content: 'Result', details: { deliveryId: 'reply:result' }, timestamp: Date.now() });
    const tool = reply('Checking');
    getSqliteDatabase().prepare("UPDATE transcript_entries SET payload_json = json_set(payload_json, '$.stopReason', 'toolUse') WHERE entry_id = ?").run(tool.entry_id);
    expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(2);
  });

  it('suppresses delegated worker notifications while preserving user decisions and unrelated tasks', () => {
    const task = new TaskRepository().create({ title: 'Research', objective: 'Research' });
    const other = new TaskRepository().create({ title: 'Other', objective: 'Other' });
    getSqliteDatabase().prepare('INSERT INTO task_origin_links (task_id, conversation_id, created_at) VALUES (?, ?, ?)')
      .run(task.id, conversationId, Date.now());
    const worker = createConversation({ agentId: 'worker' }, directory);
    new TaskConversationRepository().activateExecutionSession({ taskId: task.id, conversationId: worker.key, agentId: 'worker' });
    expect(allowsPersonalTaskNotification({ type: 'chat.completed', target: { kind: 'chat', conversationId: worker.key } })).toBe(false);
    expect(allowsPersonalTaskNotification({ type: 'task.completed', target: { kind: 'task', taskId: task.id } })).toBe(false);
    expect(allowsPersonalTaskNotification({ type: 'task.failed', target: { kind: 'task', taskId: task.id } })).toBe(false);
    expect(allowsPersonalTaskNotification({ type: 'task.needs_input', target: { kind: 'task', taskId: task.id } })).toBe(true);
    expect(allowsPersonalTaskNotification({ type: 'task.completed', target: { kind: 'task', taskId: other.id } })).toBe(true);
    expect(allowsPersonalTaskNotification({ type: 'chat.completed', target: { kind: 'chat', conversationId, personal: true } })).toBe(true);
  });

  it('preserves new arrivals and refuses stale acknowledgements after reset', () => {
    reply();
    const first = personalUnreadSnapshot(conversationId)!;
    reply();
    markPersonalRead(conversationId, first.transcriptId, first.lastSeq);
    expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(1);
    const second = personalUnreadSnapshot(conversationId)!;
    markPersonalRead(conversationId, second.transcriptId, second.lastSeq);
    markPersonalRead(conversationId, first.transcriptId, first.lastSeq);
    expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(0);
    closeXopcDatabase();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(0);
    resetSessionRecord(conversationId, directory);
    reply();
    markPersonalRead(conversationId, second.transcriptId, second.lastSeq);
    expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(1);
  });

  it('serves counts and read acknowledgements through authenticated lazy routes on a running Gateway', async () => {
    reply();
    const token = 'personal-unread-test';
    const emit = vi.fn();
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
      isGatewayReady: () => true, getExtensionLoader: () => null, emit,
    } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    try {
      const address = server.address() as { port: number };
      const base = `http://127.0.0.1:${address.port}/api/personal-agent`;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      expect((await fetch(`${base}/unread`)).status).toBe(401);
      const snapshot = await (await fetch(`${base}/unread`, { headers })).json();
      expect(snapshot.payload.unreadCount).toBe(1);
      const read = await fetch(`${base}/read`, { headers, method: 'POST', body: JSON.stringify({
        transcriptId: snapshot.payload.transcriptId, lastSeq: snapshot.payload.lastSeq,
      }) });
      expect(read.status).toBe(200);
      expect((await read.json()).payload.unreadCount).toBe(0);
      expect(emit).toHaveBeenCalledWith('personal.unread.updated', { conversationId });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
