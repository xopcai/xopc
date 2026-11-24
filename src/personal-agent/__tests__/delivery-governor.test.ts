import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { createPersonalAttentionTool } from '../../agent/tools/personal-attention-tool.js';
import type { AutomationEventEnvelope } from '../../automations/domain/types.js';
import { ConfigSchema } from '../../config/schema.js';
import { listProactiveInboxItems } from '../../proactive-hub/repository.js';
import { ProactiveHubService } from '../../proactive-hub/triage-service.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { getRemainingInferredDailyMessages, getUsedInferredDailyMessages } from '../proactivity/delivery-governor.js';
import { enqueueDue, getProactivitySettings, patchProactivitySettings, saveAttention } from '../proactivity/repository.js';
import { PersonalProactivityService } from '../proactivity/service.js';
import { personalAgentId, personalConversationId, resolvePersonalOwnerId } from '../repository.js';

function makeUrgentMeetingEnvelope(id: string, occurredAtMs: number): AutomationEventEnvelope {
  return {
    id,
    schemaVersion: 1,
    source: 'temporal:calendar',
    type: 'temporal.meeting.upcoming',
    subject: { kind: 'meeting', id: `mtg-${id}` },
    occurredAtMs,
    ingestedAtMs: occurredAtMs,
    correlationId: id,
    rootEventId: id,
    chainDepth: 0,
    trust: 'system',
    payload: {
      meetingId: `mtg-${id}`,
      title: '10:20 客户终审会日程冲突',
      startsInMinutes: 20,
    },
  };
}

describe('Phase 1: Unified ProactiveDeliveryGovernor & shared inferred quota', () => {
  let dir: string;
  let now: number;
  const ownerId = 'tenant-alpha-owner';
  const conversationId = personalConversationId(ownerId);
  const config = ConfigSchema.parse({});
  const personalCall = vi.fn();
  const hubCall = vi.fn();
  const notify = vi.fn();
  const escalated = vi.fn();
  let personalService: PersonalProactivityService;
  let hubService: ProactiveHubService;

  const proactiveTranscriptCount = () =>
    (getSqliteDatabase().prepare(`
      SELECT COUNT(*) AS n
      FROM transcript_entries e
      JOIN sessions s ON s.active_transcript_id = e.transcript_id
      WHERE s.conversation_id = ?
        AND json_extract(e.payload_json, '$.customType') = 'personal_proactive_message'
    `).get(conversationId) as { n: number }).n;

  function setupInferredThread(): string {
    const first = appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '我们继续讨论架构收敛方案',
      timestamp: now - 3_600_000,
    }).entry_id;
    const second = appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '今天还想看看架构收敛的落地细节',
      timestamp: now - 1_800_000,
    }).entry_id;
    const thread = saveAttention({
      conversationId,
      subject: '架构收敛',
      summary: '主动架构收敛讨论',
      kind: 'discussion',
      entryIds: [first, second],
      explicit: false,
      nextCheckAt: now + 60_000,
    }, now);
    expect(thread.authority).toBe('inferred');
    expect(thread.status).toBe('active');
    personalCall.mockImplementation(async () =>
      JSON.stringify({
        decision: 'contact',
        reason: '整理了新的架构收敛要点',
        sourceIds: [first, second],
        text: '这是针对架构收敛讨论的推断补充建议。',
      }));
    return thread.id;
  }

  function mockTierSScout(): void {
    hubCall.mockImplementation(async (_op: string, prompt: string) => {
      const match = /"allowedEvidenceRefs":\["([^"]+)"/.exec(prompt);
      const evidenceRef = match?.[1] ?? 'event:mtg';
      return JSON.stringify({
        title: '20 分钟后客户终审会冲突预警',
        summary: '10:20 客户终审会与周会冲突，建议提前协调参会顺序。',
        category: 'meeting_prep',
        actionability: 3,
        urgency: 3,
        novelty: 2,
        preparedness: 2,
        reason: '日程即将开始且存在冲突',
        verifiedFacts: ['20 分钟后开始'],
        evidenceRefs: [evidenceRef],
        preparedDraft: '抱歉，10:20 客户终审会冲突，我晚 20 分钟接入。',
        proposedActionKind: 'approve_draft',
        proposedActionLabel: '确认处理冲突',
      });
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-delivery-governor-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    now = Date.parse('2026-11-27T10:00:00+08:00');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);

    // Provision non-default ownerId ('tenant-alpha-owner') WITHOUT passing ownerId to services!
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: personalAgentId(ownerId), profile: { name: 'Ada' } }, { ready: true });
    createConversation(
      { agentId: personalAgentId(ownerId), sourceChannel: 'webchat', customData: { personalAgent: true, ownerId } },
      '',
      conversationId,
    );
    setSessionConfig(conversationId, { fixedModel: true }, dir);

    patchProactivitySettings(ownerId, {
      ...getProactivitySettings(ownerId),
      mode: 'balanced',
      timezone: 'Asia/Shanghai',
      quietStart: 0,
      quietEnd: 0,
      dailyMessages: 1,
      dailyModelCalls: 50,
    });

    personalCall.mockReset();
    hubCall.mockReset();
    notify.mockReset();
    escalated.mockReset();

    personalService = new PersonalProactivityService({
      getConfig: () => config,
      isAvailable: () => true,
      notify,
      call: personalCall,
      now: () => now,
    });
    hubService = new ProactiveHubService({
      getConfig: () => config,
      isConversationAvailable: () => true,
      callModel: hubCall,
      onConversationEscalated: escalated,
      now: () => now,
    });
    personalService.start();
    hubService.start();
  });

  afterEach(async () => {
    hubService.stop();
    await personalService.stop();
    vi.useRealTimers();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves non-default ownerId dynamically and enforces zero inferred messages when dailyMessages = 0', async () => {
    expect(resolvePersonalOwnerId()).toBe(ownerId);
    patchProactivitySettings(ownerId, {
      ...getProactivitySettings(ownerId),
      mode: 'balanced',
      dailyMessages: 0,
    });

    setupInferredThread();
    mockTierSScout();
    expect(hubService.ingestEvent(makeUrgentMeetingEnvelope('zero-1', now)).outcome).toBe('buffered');

    now += 65_000;
    vi.setSystemTime(now);
    enqueueDue(now);
    await personalService.drain();
    await hubService.drain();

    // Neither Personal inferred outreach nor Hub tier_s_chat may emit a Personal message when dailyMessages = 0
    expect(proactiveTranscriptCount()).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(escalated).not.toHaveBeenCalled();
    expect(getUsedInferredDailyMessages(ownerId, now)).toBe(0);
    expect(getRemainingInferredDailyMessages(ownerId, now)).toBe(0);
    // Tier S item remains accessible in Inbox ('ready'), not silently lost
    expect(listProactiveInboxItems(ownerId, { now })[0]).toMatchObject({
      tier: 'tier_s_chat',
      state: 'ready',
    });
  });

  it('shares dailyMessages = 1 across Personal inferred outreach and Hub tier_s_chat in both directions', async () => {
    setupInferredThread();
    mockTierSScout();

    // Direction A: Hub Tier-S escalates first -> consumes the single slot -> Personal inferred is blocked
    expect(hubService.ingestEvent(makeUrgentMeetingEnvelope('share-1', now)).outcome).toBe('buffered');
    now += 65_000;
    vi.setSystemTime(now);
    await hubService.drain();
    expect(escalated).toHaveBeenCalledTimes(1);
    expect(proactiveTranscriptCount()).toBe(1);
    expect(getUsedInferredDailyMessages(ownerId, now)).toBe(1);
    expect(getRemainingInferredDailyMessages(ownerId, now)).toBe(0);

    enqueueDue(now);
    await personalService.drain();
    expect(notify).not.toHaveBeenCalled();
    expect(proactiveTranscriptCount()).toBe(1);

    // Advance to next local day -> Personal inferred goes first -> consumes the single slot -> Hub Tier-S is blocked
    now += 86_400_000;
    vi.setSystemTime(now);
    expect(getRemainingInferredDailyMessages(ownerId, now)).toBe(1);

    enqueueDue(now);
    await personalService.drain();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(proactiveTranscriptCount()).toBe(2);
    expect(getUsedInferredDailyMessages(ownerId, now)).toBe(1);

    expect(hubService.ingestEvent(makeUrgentMeetingEnvelope('share-2', now)).outcome).toBe('buffered');
    now += 5_000;
    vi.setSystemTime(now);
    await hubService.drain();
    expect(escalated).toHaveBeenCalledTimes(1);
    expect(proactiveTranscriptCount()).toBe(2);
  });

  it('blocks Hub tier_s_chat in mode = follow_up while delivering one_shot conditional follow-up normally', async () => {
    patchProactivitySettings(ownerId, {
      ...getProactivitySettings(ownerId),
      mode: 'follow_up',
      dailyMessages: 5,
    });
    mockTierSScout();

    // Create a Task + active user_input wait + explicit one_shot follow-up
    const task = new TaskRepository().create({
      title: '法务合同定稿',
      objective: '确认赔偿上限条款',
      dueAt: now + 7_200_000,
      now,
    });
    const run = new TaskRunRepository().create({
      taskId: task.id,
      executorKind: 'agent',
      executorRef: { agentId: 'main' },
      trigger: {},
      correlationId: 'corr-followup',
      idempotencyKey: 'idem-followup',
      contractVersion: 1,
      now,
    });
    new TaskRunRepository().createWait({
      taskId: task.id,
      taskRunId: run.id,
      kind: 'user_input',
      reason: '确认赔偿上限比例',
      condition: { prompt: '请确认赔偿上限比例' },
      now,
    });

    const inputId = randomUUID();
    const clientMessageId = `msg-${inputId}`;
    const runId = `run-${inputId}`;
    const contextRefs = [{ kind: 'task' as const, sourceId: task.id, version: String(task.version), title: task.title }];
    insertSessionInput({
      id: inputId,
      conversationId,
      clientMessageId,
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: '今天 10:30 如果还需要我确认赔偿上限就告诉我',
      contextRefs,
      origin: { type: 'endpoint', endpointId: 'web-test' },
    });
    claimNextSessionInput(conversationId, runId, inputId);
    const userEntry = appendTranscriptEntry(conversationId, {
      role: 'user',
      turnId: runId,
      content: '今天 10:30 如果还需要我确认赔偿上限就告诉我',
      timestamp: now,
      metadata: {
        clientMessageId,
        sourceContexts: contextRefs,
      },
    });
    const tool = createPersonalAttentionTool({
      getConversationId: () => conversationId,
      getConfig: () => config,
    });
    const saved = await tool.execute('save-oneshot', { command: 'follow', oneShot: true });
    expect((saved.content[0] as { text: string }).text).toContain('"saved":true');
    finishSessionInputRun(conversationId, runId, 'completed');

    // Also ingest an urgent Hub Tier-S meeting signal
    expect(hubService.ingestEvent(makeUrgentMeetingEnvelope('fup-mode-1', now)).outcome).toBe('buffered');

    // Advance to 10:30 check time
    now = Date.parse('2026-11-27T10:30:00+08:00');
    vi.setSystemTime(now);
    enqueueDue(now);
    await hubService.drain();
    await personalService.drain();

    // Hub Tier-S stays in Inbox without writing to Personal chat; one_shot follow-up delivers cleanly!
    expect(escalated).not.toHaveBeenCalled();
    expect(listProactiveInboxItems(ownerId, { now })[0]).toMatchObject({
      tier: 'tier_s_chat',
      state: 'ready',
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(proactiveTranscriptCount()).toBe(1);
    expect(getUsedInferredDailyMessages(ownerId, now)).toBe(0);
  });

  it('Phase 2: stops scheduling inferred LLM change wakeups on task.changed.v2 while keeping user_explicit and deletion cleanup', async () => {
    const task = new TaskRepository().create({
      title: '性能优化专项',
      objective: '降低冷启动耗时',
      now,
    });
    getSqliteDatabase()
      .prepare('INSERT INTO task_origin_links(task_id, conversation_id, created_at) VALUES (?, ?, ?)')
      .run(task.id, conversationId, now);

    const e1 = appendTranscriptEntry(conversationId, { role: 'user', content: '聊聊性能优化专项', timestamp: now - 2_000 }).entry_id;
    const e2 = appendTranscriptEntry(conversationId, { role: 'user', content: '性能优化专项今天进展如何', timestamp: now - 1_000 }).entry_id;
    const inferredThread = saveAttention({
      conversationId,
      subject: '性能优化讨论',
      summary: '推断讨论',
      kind: 'discussion',
      entryIds: [e1, e2],
      explicit: false,
      taskId: task.id,
      nextCheckAt: now + 86_400_000,
    }, now);
    expect(inferredThread.authority).toBe('inferred');

    const explicitEntry = appendTranscriptEntry(conversationId, { role: 'user', content: '帮我跟进性能优化专项结果，有变化告诉我', timestamp: now }).entry_id;
    const explicitThread = saveAttention({
      conversationId,
      subject: '性能优化跟进',
      summary: '明确跟进',
      kind: 'outcome',
      entryIds: [explicitEntry],
      explicit: true,
      taskId: task.id,
      nextCheckAt: now + 86_400_000,
    }, now);
    expect(explicitThread.authority).toBe('user_explicit');

    personalService.ingestEvent({
      id: 'evt-task-chg-1',
      schemaVersion: 1,
      source: 'tasks',
      type: 'task.changed.v2',
      subject: { kind: 'task', id: task.id },
      occurredAtMs: now + 10,
      ingestedAtMs: now + 10,
      correlationId: 'evt-task-chg-1',
      rootEventId: 'evt-task-chg-1',
      chainDepth: 0,
      trust: 'system',
      payload: { taskId: task.id, version: 2 },
    });

    const db = getSqliteDatabase();
    expect(db.prepare('SELECT COUNT(*) AS n FROM personal_wakeups WHERE thread_id = ?').get(inferredThread.id)).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM personal_wakeups WHERE thread_id = ?').get(explicitThread.id)).toEqual({ n: 1 });

    // Deleting the task still expires both linked threads cleanly
    personalService.ingestEvent({
      id: 'evt-task-del-1',
      schemaVersion: 1,
      source: 'tasks',
      type: 'task.deleted.v1',
      subject: { kind: 'task', id: task.id },
      occurredAtMs: now + 20,
      ingestedAtMs: now + 20,
      correlationId: 'evt-task-del-1',
      rootEventId: 'evt-task-del-1',
      chainDepth: 0,
      trust: 'system',
      payload: { taskId: task.id },
    });
    expect(db.prepare('SELECT status FROM personal_attention_threads WHERE id = ?').get(inferredThread.id)).toEqual({ status: 'expired' });
    expect(db.prepare('SELECT status FROM personal_attention_threads WHERE id = ?').get(explicitThread.id)).toEqual({ status: 'expired' });
  });
});
