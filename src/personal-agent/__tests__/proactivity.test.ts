import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { buildSessionContextForLlm, buildSessionDisplayMessages } from '../../session/session-context-for-llm.js';
import { transcriptRowsToClientHistory, messagesToClientHistory } from '../../session/client-history.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { ingestAutomationEvent } from '../../automations/events/event-repository.js';
import { createPersonalAttentionTool } from '../../agent/tools/personal-attention-tool.js';
import { personalAgentId, personalConversationId } from '../repository.js';
import { personalUnreadSnapshot } from '../unread.js';
import { PersonalProactivityService } from '../proactivity/service.js';
import { enqueueDue, getAttention, getOutreach, getProactivitySettings, isQuiet, patchAttention, patchProactivitySettings,
  applyThreadFeedback, listInterestCandidates, preparationStrategy, provenanceDetail, recordFeedback, reserveModelCall, rollbackStrategy, saveAttention, strategyState } from '../proactivity/repository.js';

describe('Personal proactive participation', () => {
  let dir: string;
  let now: number;
  const ownerId = 'local-owner';
  const conversationId = personalConversationId(ownerId);
  const config = ConfigSchema.parse({});
  let sourceId: string;
  let available: boolean;
  const notify = vi.fn();
  const call = vi.fn();
  let service: PersonalProactivityService;
  const rows = () => getSqliteDatabase().prepare('SELECT payload_json FROM transcript_entries ORDER BY seq').all()
    .map(row => JSON.parse(row.payload_json as string));
  const deliveries = () => getSqliteDatabase().prepare("SELECT * FROM personal_outreach WHERE state = 'published'").all();
  function follow(subject = '产品方案') {
    const thread = saveAttention({ conversationId, subject, summary: '讨论主动交流的设计', kind: 'outcome',
      entryIds: [sourceId], explicit: true, nextCheckAt: now + 60_000 }, now);
    now += 60_000; enqueueDue(now); return thread;
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-proactivity-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    now = Date.parse('2026-10-09T12:00:00+08:00'); available = true;
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), timezone: 'Asia/Shanghai' });
    const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
    catalog.create({ id: personalAgentId(ownerId), profile: { name: 'Ada' } }, { ready: true });
    createConversation({ agentId: personalAgentId(ownerId), sourceChannel: 'webchat', customData: { personalAgent: true } }, '', conversationId);
    setSessionConfig(conversationId, { fixedModel: true }, dir);
    sourceId = appendTranscriptEntry(conversationId, { role: 'user', content: '帮我继续关注产品方案，下周跟进一下', timestamp: now }).entry_id;
    const transcriptId = getSqliteDatabase().prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId)!.active_transcript_id as string;
    new DurableState<number>('personal-attention-inputs', ownerId).set(transcriptId, 1);
    call.mockReset(); notify.mockReset();
    call.mockImplementation(async () => JSON.stringify({ decision: 'contact', reason: '已有可讨论的新方案', sourceIds: [sourceId], text: '我整理了两个方案，主要差别在联系时机。' }));
    service = new PersonalProactivityService({ getConfig: () => config, isAvailable: () => available, notify, call, now: () => now });
  });
  afterEach(() => {
    service.stop(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
  });
  it('does not invoke the model with no attention or new user input', async () => {
    await service.drain(); expect(call).not.toHaveBeenCalled();
  });
  it('deduplicates due checks and publishes one persistent assistant message with provenance', async () => {
    const thread = follow(); enqueueDue(now);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM personal_wakeups').get()!.n).toBe(1);
    await Promise.all([service.drain(), service.drain()]); await service.drain();
    expect(deliveries()).toHaveLength(1); expect(notify).toHaveBeenCalledTimes(1);
    const history = transcriptRowsToClientHistory(rows());
    expect(history.at(-1)).toMatchObject({ role: 'assistant', startsNewBubble: true, metadata: { personalProvenance: { reasonKind: 'follow_up' } } });
    expect(buildSessionContextForLlm(rows()).at(-1)?.role).toBe('assistant');
    expect(messagesToClientHistory(buildSessionDisplayMessages(rows()) as never).at(-1)?.metadata?.personalProvenance).toBeDefined();
    expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(1);
    const id = deliveries()[0].id as string;
    expect(provenanceDetail(ownerId, id)?.thread.id).toBe(thread.id);
    expect(provenanceDetail('other-owner', id)).toBeUndefined();
  });
  it('persists silence without publishing it into the conversation', async () => {
    follow(); call.mockResolvedValue(JSON.stringify({ decision: 'silent', reason: '没有新内容', sourceIds: [sourceId] }));
    await service.drain(); expect(deliveries()).toHaveLength(0);
    expect(rows()).toHaveLength(1);
    expect(getSqliteDatabase().prepare('SELECT decision,state FROM personal_outreach').get()).toMatchObject({ decision: 'silent', state: 'decided' });
  });
  it('waits while the foreground conversation is busy', async () => {
    follow(); available = false; await service.drain(); expect(call).not.toHaveBeenCalled();
    available = true; await service.drain(); expect(deliveries()).toHaveLength(1);
  });
  it('does not publish a draft after attention is stopped during generation', async () => {
    const thread = follow(); call.mockImplementation(async () => {
      patchAttention(ownerId, thread.id, thread.revision, { status: 'completed' }, now);
      return JSON.stringify({ decision: 'contact', reason: '已有方案', sourceIds: [sourceId], text: '不应发送' });
    });
    await service.drain(); expect(deliveries()).toHaveLength(0);
  });
  it('invalidates a draft when its settings change during generation', async () => {
    follow(); call.mockImplementation(async () => {
      patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), mode: 'off' });
      return JSON.stringify({ decision: 'contact', reason: '已有方案', sourceIds: [sourceId], text: '不应发送' });
    });
    await service.drain(); expect(deliveries()).toHaveLength(0);
    expect(getSqliteDatabase().prepare('SELECT state FROM personal_outreach').get()!.state).toBe('stale');
  });
  it('does not publish when a source is removed during generation', async () => {
    follow(); call.mockImplementation(async () => {
      getSqliteDatabase().prepare('DELETE FROM transcript_entries WHERE entry_id = ?').run(sourceId);
      return JSON.stringify({ decision: 'contact', reason: '已有方案', sourceIds: [sourceId], text: '不应发送' });
    });
    await service.drain(); expect(deliveries()).toHaveLength(0);
  });
  it('retries synchronization using the existing message identity', async () => {
    follow(); notify.mockImplementationOnce(() => { throw new Error('Disconnected'); });
    await service.drain(); const id = deliveries()[0].id;
    await service.drain(); expect(deliveries()).toHaveLength(1); expect(rows()).toHaveLength(2);
    expect(notify.mock.calls.map(args => args[1])).toEqual([id, id]); expect(call).toHaveBeenCalledTimes(1);
  });
  it('makes stop feedback idempotent and prevents automatic recreation', async () => {
    const thread = follow(); await service.drain(); const id = deliveries()[0].id as string;
    const input = { idempotencyKey: 'stop-1', kind: 'stop' as const, scope: 'thread' as const };
    recordFeedback(ownerId, id, input, now); recordFeedback(ownerId, id, input, now);
    expect(getAttention(thread.id)?.status).toBe('completed');
    expect(follow().status).toBe('completed');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM personal_feedback').get()!.n).toBe(1);
  });
  it('defers locally and stores scoped preparation feedback', async () => {
    const thread = follow(); await service.drain(); const id = deliveries()[0].id as string;
    recordFeedback(ownerId, id, { idempotencyKey: 'prepare', kind: 'adjust', scope: 'thread', preparation: 'thorough' }, now);
    expect(getSqliteDatabase().prepare('SELECT dimension,value,authority FROM personal_adaptive_strategies').get())
      .toMatchObject({ dimension: 'preparation', value: 'thorough', authority: 'explicit' });
    recordFeedback(ownerId, id, { idempotencyKey: 'later', kind: 'defer', scope: 'thread', until: now + 86_400_000 }, now);
    expect(getAttention(thread.id)?.status).toBe('paused');
    now += 86_400_000; enqueueDue(now); expect(getAttention(thread.id)?.status).toBe('active');
  });
  it('requires independent user statements before inferred attention can activate', () => {
    const first = saveAttention({ conversationId, subject: '网站', summary: '网站方向', kind: 'discussion', entryIds: [sourceId], explicit: false, nextCheckAt: now + 60_000 }, now);
    expect(first.status).toBe('candidate');
    const second = appendTranscriptEntry(conversationId, { role: 'user', content: '我们继续讨论网站方向' }).entry_id;
    const active = saveAttention({ conversationId, subject: '网站', summary: '网站方向', kind: 'discussion', entryIds: [second], explicit: false, nextCheckAt: now + 60_000 }, now);
    expect(active.status).toBe('active'); expect(active.authority).toBe('inferred');
  });
  it('rejects fabricated and assistant source rows', () => {
    const assistant = appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'text', text: '我自己觉得你需要这个' }], timestamp: now }).entry_id;
    expect(() => saveAttention({ conversationId, subject: '猜测', summary: '', kind: 'discussion', entryIds: [assistant], explicit: false, nextCheckAt: now + 60_000 }, now)).toThrow('source');
  });
  it('applies quiet hours and daily model-call limits', async () => {
    const settings = getProactivitySettings(ownerId);
    expect(isQuiet(Date.parse('2026-10-09T23:00:00+08:00'), settings)).toBe(true);
    expect(isQuiet(Date.parse('2026-10-10T07:00:00+08:00'), settings)).toBe(true);
    patchProactivitySettings(ownerId, { ...settings, dailyModelCalls: 1 });
    expect(reserveModelCall(ownerId, now)).toBe(true); expect(reserveModelCall(ownerId, now)).toBe(false);
    expect(reserveModelCall(ownerId, now + 86_400_000)).toBe(true);
    follow(); now = Date.parse('2026-10-09T23:00:00+08:00'); await service.drain(); expect(call).not.toHaveBeenCalled();
  });
  it('serves provenance and feedback through a real authenticated Gateway HTTP path', async () => {
    follow(); await service.drain(); const id = deliveries()[0].id as string;
    const token = 'proactivity-test-token';
    const app = createHonoApp({ service: { currentConfig: config,
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
      isGatewayReady: () => true, getExtensionLoader: () => null } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const url = `${base}/api/personal-agent/outreach/${id}/provenance`;
      expect((await fetch(url)).status).toBe(401);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200); expect((await response.json()).payload.sources[0].entryId).toBe(sourceId);
      const feedback = await fetch(`${base}/api/personal-agent/outreach/${id}/feedback`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: 'http-stop', kind: 'stop', scope: 'thread' }),
      });
      expect(feedback.status).toBe(200);
      expect(getOutreach(id)?.state).toBe('published');
      const detail = (await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json()).payload;
      const rollbackUrl = `${base}/api/personal-agent/attention/${detail.thread.id}/strategy/rollback`;
      const input = { versionId: detail.strategy.versions[0].id, revision: detail.thread.revision, idempotencyKey: 'http-undo' };
      expect((await fetch(rollbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(401);
      const rollback = await fetch(rollbackUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      expect(rollback.status).toBe(200);
      expect(getAttention(detail.thread.id)?.status).toBe('active');
      const interests = await fetch(`${base}/api/personal-agent/interests`, { headers: { Authorization: `Bearer ${token}` } });
      expect(interests.status).toBe(200);
      expect((await interests.json()).payload).toEqual([]);
    } finally { server.close(); await once(server, 'close'); }
  });
  it('does not rephrase unchanged evidence into a second message on the next day', async () => {
    follow(); await service.drain(); now += 86_400_000; enqueueDue(now); await service.drain();
    expect(deliveries()).toHaveLength(1); expect(call).toHaveBeenCalledTimes(1);
  });
  it('recovers an expired worker lease after restart', async () => {
    follow();
    getSqliteDatabase().prepare("UPDATE personal_wakeups SET status = 'evaluating', lease_token = 'old-worker', lease_until = ?").run(now - 1);
    const restarted = new PersonalProactivityService({ getConfig: () => config, isAvailable: () => true, notify, call, now: () => now });
    await restarted.drain(); restarted.stop(); expect(deliveries()).toHaveLength(1);
  });
  it('discards drafts when a foreground input changes the context revision', async () => {
    follow(); call.mockImplementation(async () => {
      getSqliteDatabase().prepare(`INSERT INTO session_input_runtime(conversation_id,revision,updated_at_ms) VALUES (?,1,?)
        ON CONFLICT(conversation_id) DO UPDATE SET revision = revision + 1`).run(conversationId, now);
      return JSON.stringify({ decision: 'contact', reason: '有新方案', sourceIds: [sourceId], text: '旧上下文' });
    });
    await service.drain(); expect(deliveries()).toHaveLength(0);
    expect(getSqliteDatabase().prepare('SELECT state FROM personal_outreach').get()!.state).toBe('stale');
  });
  it('prepares a bounded synthesis before contacting the user', async () => {
    follow(); call.mockResolvedValueOnce(JSON.stringify({ decision: 'prepare', reason: '先整理完整', sourceIds: [sourceId] }))
      .mockResolvedValueOnce(JSON.stringify({ decision: 'contact', reason: '已整理出差异', sourceIds: [sourceId], text: '两个方案的主要差别是联系时机。' }));
    await service.drain(); expect(call).toHaveBeenCalledTimes(2); expect(deliveries()).toHaveLength(1);
  });
  it('keeps pending work recoverable when the daily model budget is exhausted', async () => {
    follow(); patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), dailyModelCalls: 0 });
    await service.drain(); expect(call).not.toHaveBeenCalled();
    expect(getSqliteDatabase().prepare('SELECT status,attempts FROM personal_wakeups').get()).toMatchObject({ status: 'pending', attempts: 0 });
  });
  it('incrementally extracts new user evidence without learning from assistant messages', async () => {
    const second = appendTranscriptEntry(conversationId, { role: 'user', content: '我们继续讨论 personal AI 的方向' }).entry_id;
    appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'text', text: '这是我的猜测' }], timestamp: now });
    call.mockResolvedValue(JSON.stringify({ attention: [{ subject: 'personal AI', summary: '产品方向', kind: 'discussion',
      sourceIds: [second], explicit: false, nextCheckAt: now + 86_400_000 }], feedback: [] }));
    await service.drain(); await service.drain();
    expect(call).toHaveBeenCalledTimes(1);
    expect(getSqliteDatabase().prepare('SELECT status,authority FROM personal_attention_threads').get()).toMatchObject({ status: 'candidate', authority: 'inferred' });
  });
  it('does not send source material to a model under local-only processing policy', async () => {
    follow(); const privateService = new PersonalProactivityService({ getConfig: () => ConfigSchema.parse({ userContext: {
      userModel: { processingPolicy: 'local_only' } } }), isAvailable: () => true, notify, call, now: () => now });
    await privateService.drain(); privateService.stop(); expect(call).not.toHaveBeenCalled(); expect(deliveries()).toHaveLength(0);
  });
  it('recovers an overdue check after proactivity was disabled for more than one day', async () => {
    follow(); patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), mode: 'off' });
    now += 2 * 86_400_000; enqueueDue(now);
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), mode: 'balanced' });
    await service.drain(); expect(deliveries()).toHaveLength(1);
  });
  it('does not activate inferred attention from repeated copies of one user statement', () => {
    const duplicate = appendTranscriptEntry(conversationId, { role: 'user', content: '帮我继续关注产品方案，下周跟进一下' }).entry_id;
    const thread = saveAttention({ conversationId, subject: '重复的话', summary: '', kind: 'discussion',
      entryIds: [sourceId, duplicate], explicit: false, nextCheckAt: now + 60_000 }, now);
    expect(thread.status).toBe('candidate');
  });
  it('keeps a message explanation tied to its original sources as attention evolves', async () => {
    follow(); await service.drain(); const id = deliveries()[0].id as string;
    const newer = appendTranscriptEntry(conversationId, { role: 'user', content: '产品方案还有新问题，继续关注' }).entry_id;
    saveAttention({ conversationId, subject: '产品方案', summary: '新问题', kind: 'outcome', entryIds: [newer], explicit: true, nextCheckAt: now + 60_000 }, now);
    expect(provenanceDetail(ownerId, id)?.sources.map(source => source.entryId)).toEqual([sourceId]);
  });
  it('does not redeliver a Task result through proactive attention', async () => {
    const task = new TaskRepository().create({ title: '整理方案', objective: '整理产品方案', now });
    const db = getSqliteDatabase();
    db.prepare('INSERT INTO task_origin_links(task_id,conversation_id,created_at) VALUES (?,?,?)').run(task.id, conversationId, now);
    const run = new TaskRunRepository().create({ taskId: task.id, executorKind: 'agent', executorRef: {},
      trigger: {}, correlationId: 'test', idempotencyKey: 'task-result', contractVersion: 1, now });
    db.prepare(`INSERT INTO task_result_deliveries(delivery_id,task_run_id,conversation_id,payload_json,status,next_attempt_at,created_at,reply_status)
      VALUES (?,?,?,'{}','delivered',?,?,'delivered')`).run('already-delivered', run.id, conversationId, now, now);
    const thread = saveAttention({ conversationId, subject: '委托成果', summary: '整理方案', kind: 'outcome', entryIds: [sourceId],
      explicit: true, taskId: task.id, nextCheckAt: now + 60_000 }, now);
    now += 60_000; enqueueDue(now); await service.drain();
    expect(call).not.toHaveBeenCalled(); expect(deliveries()).toHaveLength(0); expect(getAttention(thread.id)?.status).toBe('completed');
  });
  it('deduplicates durable business event replay and ignores untrusted event claims', async () => {
    const task = new TaskRepository().create({ title: '产品调研', objective: '产品调研', now });
    getSqliteDatabase().prepare('INSERT INTO task_origin_links(task_id,conversation_id,created_at) VALUES (?,?,?)').run(task.id, conversationId, now);
    const thread = saveAttention({ conversationId, subject: '调研进展', summary: '关注调研', kind: 'outcome', entryIds: [sourceId],
      explicit: true, taskId: task.id, nextCheckAt: now + 7 * 86_400_000 }, now);
    const event = ingestAutomationEvent({ type: 'task.changed.v2', source: 'tasks', subject: { kind: 'task', id: task.id },
      occurredAtMs: now + 1, trust: 'system', payload: { taskId: task.id, version: 2 } }).event;
    service.ingestEvent(event); service.ingestEvent(event);
    service.ingestEvent({ ...event, id: 'untrusted-copy', trust: 'untrusted_webhook' });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM personal_wakeups WHERE thread_id = ?').get(thread.id)!.n).toBe(1);
    await service.drain(); expect(deliveries()).toHaveLength(1);
    expect(provenanceDetail(ownerId, deliveries()[0].id as string)?.provenance.reasonKind).toBe('change');
  });
  it('does not revive old conversation history as new attention on first activation', async () => {
    const db = getSqliteDatabase();
    db.prepare('UPDATE transcript_entries SET created_at = ? WHERE entry_id = ?').run(now - 60 * 86_400_000, sourceId);
    const transcriptId = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId)!.active_transcript_id as string;
    new DurableState<number>('personal-attention-inputs', ownerId).delete(transcriptId);
    await service.drain(); expect(call).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS n FROM personal_attention_threads').get()!.n).toBe(0);
  });
  it('supports an explicit conversational request to disable proactive messages', async () => {
    appendTranscriptEntry(conversationId, { role: 'user', content: '请关闭主动联系' });
    const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });
    await tool.execute('settings-off', { command: 'settings', mode: 'off' });
    expect(getProactivitySettings(ownerId).mode).toBe('off');
    await expect(tool.execute('settings-on', { command: 'settings', mode: 'balanced' })).rejects.toThrow('explicit');
  });
  it('saves the reported user request and corrects a model timestamp outside tomorrow afternoon', async () => {
    const observedAt = Date.parse('2026-10-09T19:38:00+08:00');
    vi.spyOn(Date, 'now').mockReturnValue(observedAt);
    try {
      appendTranscriptEntry(conversationId, { role: 'user', content: '我们继续讨论 personal agent 的主动联系方案。明天下午再检查一下，如果有值得补充的建议，主动在这里告诉我。', timestamp: observedAt });
      const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });
      const result = await tool.execute('follow', { command: 'follow', subject: '主动联系方案', nextCheckAt: 1791588000000 });
      const saved = JSON.parse((result.content[0] as { text: string }).text);
      expect(saved).toMatchObject({ status: 'active', timezone: 'Asia/Shanghai', nextCheckLocal: '2026-10-10 15:00', nextCheckAt: Date.parse('2026-10-10T15:00:00+08:00') });
      expect(getAttention(saved.id, ownerId)?.authority).toBe('user_explicit');
    } finally { vi.restoreAllMocks(); }
  });
  it('saves a local check time and does not save negated requests', async () => {
    const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });
    const local = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) + 'T15:00';
    const result = await tool.execute('follow', { command: 'follow', subject: '用户要求的跟进', nextCheckLocal: local });
    expect(JSON.parse((result.content[0] as { text: string }).text).nextCheckLocal).toBe(local.replace('T', ' '));
    appendTranscriptEntry(conversationId, { role: 'user', content: '不要跟进这个新话题' });
    await expect(tool.execute('follow', { command: 'follow', subject: '拒绝的主题' })).rejects.toThrow('explicit user request');
    expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS n FROM personal_attention_threads WHERE subject = '拒绝的主题'").get()!.n).toBe(0);
  });
  it('queries current attention and settings on demand after changes', async () => {
    const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });
    const read = async (command: 'list' | 'settings') => {
      const result = await tool.execute('query', { command });
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    expect(await read('list')).toEqual([]);
    const thread = follow('产品关注状态');
    expect(await read('list')).toEqual([expect.objectContaining({ id: thread.id, status: 'active', nextCheckAt: thread.next_check_at })]);
    patchAttention(ownerId, thread.id, thread.revision, { status: 'completed' }, now);
    expect(await read('list')).toEqual([expect.objectContaining({ id: thread.id, status: 'completed' })]);
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), mode: 'off' });
    expect(await read('settings')).toMatchObject({ mode: 'off', timezone: 'Asia/Shanghai' });
  });
  function interestEvidence(text: string, observedAt: number) {
    const id = appendTranscriptEntry(conversationId, { role: 'user', content: text, timestamp: observedAt }).entry_id;
    getSqliteDatabase().prepare('UPDATE transcript_entries SET created_at = ? WHERE entry_id = ?').run(observedAt, id);
    return id;
  }
  it('keeps recurring interests silent with source-based confidence and expiry', async () => {
    const first = interestEvidence('我持续在研究怎样让个人AI理解长期目标', now - 2 * 86_400_000);
    const second = interestEvidence('个人AI的长期协作方式是我正在持续探索的方向', now - 86_400_000);
    const thread = saveAttention({ conversationId, subject: '长期协作', summary: '持续研究个人AI协作', kind: 'interest',
      entryIds: [first, second], explicit: false, nextCheckAt: now + 60_000 }, now);
    expect(thread).toMatchObject({ status: 'candidate', kind: 'interest', authority: 'inferred', next_check_at: null });
    expect(listInterestCandidates(conversationId, now)[0]).toMatchObject({ independentStatements: 2, independentDays: 2, confidence: 0.49 });
    expect(listInterestCandidates(conversationId, now)[0].sources.map(source => source.entryId)).toEqual(expect.arrayContaining([first, second]));
    enqueueDue(now + 86_400_000);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM personal_wakeups').get()!.n).toBe(0);
    await service.drain(); expect(deliveries()).toHaveLength(0);
    expect(() => patchAttention(ownerId, thread.id, thread.revision, { status: 'active' }, now)).toThrow('silent');
    expect(() => patchAttention(ownerId, thread.id, thread.revision, { status: 'paused', nextCheckAt: now + 1000 }, now)).toThrow('silent');
    enqueueDue(now + 31 * 86_400_000);
    expect(getAttention(thread.id)?.status).toBe('expired');
  });
  it('rejects one-off, same-day, duplicate, and assistant-only interest evidence', () => {
    const save = (entryIds: string[]) => saveAttention({ conversationId, subject: '候选兴趣', summary: '推断', kind: 'interest', entryIds, explicit: false, nextCheckAt: now + 60_000 }, now);
    const first = interestEvidence('帮我查一下这次旅行的天气', now - 86_400_000);
    expect(() => save([first])).toThrow('across days');
    const duplicate = interestEvidence('[2026-10-09 12:00 GMT+8] 帮我查一下这次旅行的天气', now);
    expect(() => save([first, duplicate])).toThrow('across days');
    const sameDay = interestEvidence('这次旅行还需要查一下餐厅', now - 86_400_000 + 60_000);
    expect(() => save([first, sameDay])).toThrow('across days');
    const assistant = appendTranscriptEntry(conversationId, { role: 'assistant', content: '用户长期喜欢旅行' }).entry_id;
    expect(() => save([first, assistant])).toThrow('source');
    expect(listInterestCandidates(conversationId, now)).toEqual([]);
  });
  it('does not let automatic interest extraction revive a stopped topic', () => {
    const first = interestEvidence('我长期研究个人AI', now - 86_400_000);
    const second = interestEvidence('个人AI持续学习很值得研究', now);
    const input = { conversationId, subject: '个人AI', summary: '长期研究', kind: 'interest' as const, entryIds: [first, second], explicit: false, nextCheckAt: now + 60_000 };
    const thread = saveAttention(input, now);
    applyThreadFeedback(ownerId, thread.id, thread.revision, { idempotencyKey: 'interest-stop', kind: 'stop', scope: 'thread' }, {}, now);
    expect(saveAttention(input, now).status).toBe('completed');
    const rollback = strategyState(thread.id, now).versions[0];
    rollbackStrategy(ownerId, thread.id, { versionId: rollback.id, revision: getAttention(thread.id)!.revision, idempotencyKey: 'undo-interest-stop' }, undefined, now);
    expect(getAttention(thread.id)).toMatchObject({ status: 'candidate', next_check_at: null });
  });
  it('versions explicit preparation changes and passes the current strategy to the next decision', async () => {
    const thread = follow();
    applyThreadFeedback(ownerId, thread.id, thread.revision, { idempotencyKey: 'deep', kind: 'adjust', scope: 'thread', preparation: 'thorough' }, {}, now);
    enqueueDue(now); await service.drain();
    expect(call.mock.calls.find(([, operation]) => operation === 'personal.proactive_decision')?.[2]).toContain('"preparation":"thorough"');
    expect(call.mock.calls.find(([, operation]) => operation === 'personal.proactive_preparation')?.[2]).toContain('"preparation":"thorough"');
    const current = getAttention(thread.id)!;
    const version = strategyState(thread.id, now).versions[0];
    const input = { versionId: version.id, revision: current.revision, idempotencyKey: 'undo-deep' };
    rollbackStrategy(ownerId, thread.id, input, undefined, now);
    rollbackStrategy(ownerId, thread.id, input, undefined, now);
    expect(preparationStrategy(thread.id, now)).toBeNull();
    expect(strategyState(thread.id, now).versions.map(item => item.kind)).toEqual(['rollback', 'adjust']);
    expect(() => rollbackStrategy(ownerId, thread.id, { ...input, idempotencyKey: 'stale' }, undefined, now)).toThrow('changed');
    expect(() => rollbackStrategy('other-owner', thread.id, { ...input, idempotencyKey: 'other' }, undefined, now)).toThrow('changed');
  });
  it('keeps message reactions local and isolates topic policies', async () => {
    const thread = follow(); await service.drain(); const id = deliveries()[0].id as string;
    recordFeedback(ownerId, id, { idempotencyKey: 'one-message', kind: 'defer', scope: 'message', until: now + 86_400_000 }, now);
    expect(getAttention(thread.id)?.status).toBe('active');
    expect(strategyState(thread.id, now).versions).toEqual([]);
    const second = saveAttention({ conversationId, subject: '另一主题', summary: '', kind: 'outcome', entryIds: [sourceId], explicit: true, nextCheckAt: now + 1000 }, now);
    recordFeedback(ownerId, id, { idempotencyKey: 'only-topic', kind: 'adjust', scope: 'thread', preparation: 'brief' }, now);
    expect(preparationStrategy(thread.id, now)).toBe('brief');
    expect(preparationStrategy(second.id, now)).toBeNull();
  });
  it('skips weak interest proposals without retrying the same input indefinitely', async () => {
    const first = interestEvidence('帮我查天气', now);
    call.mockResolvedValue(JSON.stringify({ attention: [{ subject: '天气', summary: '单次需求', kind: 'interest', sourceIds: [first], explicit: false, nextCheckAt: now + 1000 }], feedback: [] }));
    await service.drain(); await service.drain();
    expect(listInterestCandidates(conversationId, now)).toEqual([]);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('discovers recurring interests across separately processed input batches', async () => {
    const first = interestEvidence('个人AI如何持续理解用户是我长期探索的方向', now);
    call.mockResolvedValue(JSON.stringify({ attention: [{ subject: '长期协作', summary: '持续探索', kind: 'interest', sourceIds: [first], explicit: false, nextCheckAt: now + 1000 }], feedback: [] }));
    await service.drain(); expect(listInterestCandidates(conversationId, now)).toEqual([]);
    now += 86_400_000;
    const second = interestEvidence('今天又想研究个人AI的长期协作方式', now);
    call.mockResolvedValue(JSON.stringify({ attention: [{ subject: '长期协作', summary: '跨天持续探索', kind: 'interest', sourceIds: [first, second], explicit: false, nextCheckAt: now + 1000 }], feedback: [] }));
    await service.drain();
    expect(call.mock.calls.at(-1)?.[2]).toContain('priorUserStatements');
    expect(listInterestCandidates(conversationId, now)[0]).toMatchObject({ status: 'candidate', independentDays: 2 });
    enqueueDue(now + 86_400_000); await service.drain();
    expect(deliveries()).toHaveLength(0);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('supports explicit conversational topic feedback and undo without an outreach prerequisite', async () => {
    const thread = follow();
    const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });
    appendTranscriptEntry(conversationId, { role: 'user', content: '这个主题以后先准备完整再告诉我' });
    await tool.execute('adjust-topic', { command: 'feedback', id: thread.id, feedback: 'adjust', preparation: 'thorough' });
    expect(preparationStrategy(thread.id)).toBe('thorough');
    const version = strategyState(thread.id).versions[0];
    await expect(tool.execute('unrequested-undo', { command: 'rollback', id: thread.id, versionId: version.id })).rejects.toThrow('explicit undo');
    appendTranscriptEntry(conversationId, { role: 'user', content: '撤销刚才这个主题的准备方式调整' });
    await tool.execute('undo-topic', { command: 'rollback', id: thread.id, versionId: version.id });
    expect(preparationStrategy(thread.id)).toBeNull();
    expect(strategyState(thread.id).versions[0].kind).toBe('rollback');
  });
  it('cancels an in-flight decision after an explicit strategy rollback', async () => {
    const thread = follow();
    const changed = applyThreadFeedback(ownerId, thread.id, thread.revision, { idempotencyKey: 'deep-before-call', kind: 'adjust', scope: 'thread', preparation: 'thorough' }, {}, now);
    enqueueDue(now);
    call.mockImplementation(async () => {
      rollbackStrategy(ownerId, thread.id, { versionId: strategyState(thread.id, now).versions[0].id, revision: changed.revision, idempotencyKey: 'undo-during-call' }, undefined, now);
      return JSON.stringify({ decision: 'contact', reason: '旧策略', sourceIds: [sourceId], text: '旧草稿' });
    });
    await service.drain();
    expect(deliveries()).toHaveLength(0);
  });
  it('does not undo a strategy after its grounding sources are deleted', () => {
    const thread = follow();
    const changed = applyThreadFeedback(ownerId, thread.id, thread.revision, { idempotencyKey: 'end-before-delete', kind: 'stop', scope: 'thread' }, {}, now);
    const versionId = strategyState(thread.id, now).versions[0].id;
    getSqliteDatabase().prepare('DELETE FROM transcript_entries WHERE entry_id = ?').run(sourceId);
    expect(() => rollbackStrategy(ownerId, thread.id, { versionId, revision: changed.revision, idempotencyKey: 'undo-deleted' }, undefined, now)).toThrow('sources have expired');
    expect(getAttention(thread.id)?.status).toBe('completed');
  });
  it('undoes preparation without overwriting a newer follow-up schedule', () => {
    const thread = follow();
    const adjusted = applyThreadFeedback(ownerId, thread.id, thread.revision, { idempotencyKey: 'adjust-before-schedule', kind: 'adjust', scope: 'thread', preparation: 'thorough' }, {}, now);
    const versionId = strategyState(thread.id, now).versions[0].id;
    const scheduled = patchAttention(ownerId, thread.id, adjusted.revision, { nextCheckAt: now + 7 * 86_400_000 }, now);
    const result = rollbackStrategy(ownerId, thread.id, { versionId, revision: scheduled.revision, idempotencyKey: 'undo-keep-schedule' }, undefined, now);
    expect(result.next_check_at).toBe(scheduled.next_check_at);
    expect(preparationStrategy(thread.id, now)).toBeNull();
  });
});
