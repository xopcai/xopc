import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { createPersonalAttentionTool } from '../../agent/tools/personal-attention-tool.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import {
  enqueueDue,
  getAttention,
  getProactivitySettings,
  patchProactivitySettings,
  saveAttention,
} from '../../personal-agent/proactivity/repository.js';
import { PersonalProactivityService } from '../../personal-agent/proactivity/service.js';
import { personalAgentId, personalConversationId } from '../../personal-agent/repository.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { collectAttentionLiveContext, collectSignalReadOnlyContext } from '../context-probe.js';
import {
  saveProactiveItem,
} from '../repository.js';
import { ProactiveHubService } from '../triage-service.js';
import type { CoalescedSignal } from '../types.js';

describe('Proactive upgrades: live context probes, watch delegation, action closure, and following API', () => {
  let dir: string;
  let now: number;
  const ownerId = 'local-owner';
  const conversationId = personalConversationId(ownerId);
  const config = ConfigSchema.parse({});

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-proactive-upgrades-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    now = Date.parse('2026-11-25T10:00:00+08:00');

    patchProactivitySettings(ownerId, {
      ...getProactivitySettings(ownerId),
      mode: 'balanced',
      timezone: 'Asia/Shanghai',
      quietStart: 22,
      quietEnd: 8,
      dailyMessages: 5,
      dailyModelCalls: 50,
    });

    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: personalAgentId(ownerId), profile: { name: 'Ada' } }, { ready: true });
    createConversation({ agentId: personalAgentId(ownerId), sourceChannel: 'webchat', customData: { personalAgent: true } }, '', conversationId);
    setSessionConfig(conversationId, { fixedModel: true }, dir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('collects bounded read-only live context for ProactiveHub Scout and respects local_only policy', () => {
    const db = getSqliteDatabase();
    db.prepare(`
      INSERT INTO projects(project_id, name, slug, status, health, outcome, created_at, updated_at)
      VALUES ('proj-release', 'Pilot Release', 'pilot-release', 'active', 'at_risk', 'Ship Android & iOS pilot cleanly', ?, ?)
    `).run(now, now);

    const task = new TaskRepository().create({
      title: 'Fix Android offline recovery blocker',
      objective: 'Resolve Android offline recovery before pilot launch',
      projectId: 'proj-release',
      phase: 'active',
      priority: 'high',
      source: 'user',
    });

    const sourceId = appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '帮我继续关注 Pilot Release 的 Android 离线恢复阻塞',
      timestamp: now,
    }).entry_id;

    saveAttention({
      conversationId,
      subject: 'Pilot Release Android 离线恢复',
      summary: '跟踪 Android 离线恢复阻塞进展',
      kind: 'outcome',
      entryIds: [sourceId],
      explicit: true,
      nextCheckAt: now + 3_600_000,
    }, now);

    const signal: CoalescedSignal = {
      ownerId,
      coalesceKey: 'github:pilot-release:184',
      source: 'composio:github',
      eventType: 'connector.github.issue_labeled',
      subjectKind: 'project',
      subjectId: 'proj-release',
      trust: 'connector',
      latestEventId: 'evt-184',
      eventIds: ['evt-184'],
      eventCount: 1,
      payload: {
        projectId: 'proj-release',
        taskId: task.id,
        title: 'Pilot Release Android 离线恢复 release-blocker',
        summary: 'QA tagged issue #184 as release-blocker',
      },
      contentFingerprint: 'fp-184',
      routeHint: 'triage',
      windowStartedAt: now,
      flushAfter: now,
      status: 'processing',
      leaseUntil: now + 30_000,
      updatedAt: now,
    };

    const excerpts = collectSignalReadOnlyContext({ ownerId, signal, config, now });
    expect(excerpts.some(item => item.ref === `task:${task.id}`)).toBe(true);
    expect(excerpts.some(item => item.ref === 'project:proj-release')).toBe(true);
    expect(excerpts.some(item => item.kind === 'attention_thread' && item.excerpt.includes('Pilot Release'))).toBe(true);

    const localOnlyConfig = ConfigSchema.parse({
      userContext: { userModel: { processingPolicy: 'local_only' } },
    });
    expect(collectSignalReadOnlyContext({ ownerId, signal, config: localOnlyConfig, now })).toEqual([]);
  });

  it('feeds live proactive signals into PersonalProactivityService evaluation and allows dynamic 15m wakeups', async () => {
    const sourceId = appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '帮我继续关注试点发布阻塞，有进展告诉我',
      timestamp: now,
    }).entry_id;
    const transcriptId = getSqliteDatabase()
      .prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?')
      .get(conversationId)!.active_transcript_id as string;
    new DurableState<number>('personal-attention-inputs', ownerId).set(transcriptId, 1);

    const thread = saveAttention({
      conversationId,
      subject: '试点发布阻塞',
      summary: '跟踪试点发布前的阻塞项变化',
      kind: 'outcome',
      entryIds: [sourceId],
      explicit: true,
      nextCheckAt: now + 60_000,
    }, now);

    // A matching external proactive signal arrives before wakeup
    const signalItem = saveProactiveItem({
      ownerId,
      agentId: personalAgentId(ownerId),
      coalesceKey: 'github:pilot:184',
      sourceEventIds: ['evt-gh-184'],
      tier: 'tier_a_inbox',
      category: 'blocker',
      title: '试点发布阻塞更新：iOS 审核已通过',
      summary: 'iOS 审核通过，仅剩 Android 离线恢复待确认。',
      provenance: {
        source: 'composio:github',
        eventType: 'connector.github.pr_updated',
        trust: 'connector',
        coalescedCount: 1,
        reason: 'Status changed on pilot release',
        evidenceRefs: ['event:evt-gh-184'],
        score: { actionability: 3, urgency: 2, novelty: 2, preparedness: 2, disruptionPenalty: 0, netScore: 14 },
      },
      state: 'ready',
      idempotencyKey: 'sig-pilot-184',
      validUntil: now + 86_400_000,
      now,
    });

    const liveItems = collectAttentionLiveContext({ ownerId, thread, config, now });
    expect(liveItems.some(item => item.ref === `signal:${signalItem.id}`)).toBe(true);

    now += 60_000;
    enqueueDue(now);

    const requestedNextCheck = now + 20 * 60_000;
    const call = vi.fn().mockImplementation(async (_convId: string, _op: string, prompt: string) => {
      expect(prompt).toContain(`signal:${signalItem.id}`);
      return JSON.stringify({
        decision: 'contact',
        reason: '检测到试点发布阻塞有新进展',
        sourceIds: [sourceId, `signal:${signalItem.id}`],
        text: 'iOS 审核已通过，现在只剩 Android 离线恢复。你可以选择先发 iOS，或等 Android 修复后一起发。',
        nextCheckAt: requestedNextCheck,
      });
    });
    const notify = vi.fn();
    const service = new PersonalProactivityService({
      ownerId,
      getConfig: () => config,
      isAvailable: () => true,
      notify,
      call,
      now: () => now,
    });

    await service.drain();
    expect(call).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);

    const updatedThread = getAttention(thread.id, ownerId)!;
    expect(updatedThread.last_checked_at).toBe(now);
    // Explicit follow-up respects dynamic 20-minute next check instead of clamping to 60 minutes.
    expect(updatedThread.next_check_at).toBe(requestedNextCheck);
  });

  it('creates, updates, checks, and resolves a unified FollowUpMatter via personal_attention tool', async () => {
    const onMatterMutated = vi.fn();
    const tool = createPersonalAttentionTool({
      getConversationId: () => conversationId,
      getConfig: () => config,
      onMatterMutated,
    });

    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '帮我跟进 GitHub 上的 release-blocker 阻塞情况，有变动及时告诉我',
      timestamp: now,
    });

    const createRes = await tool.execute('tc-1', {
      command: 'matter_create',
      title: '试点发布阻塞',
      goal: '跟踪试点发布前 GitHub 上的 release-blocker 状态',
      notifyWhen: '出现新增或解除的 release-blocker',
      doneCriteria: '试点发布完成或所有阻塞清零',
      eventSources: [{ source: 'github', keyword: 'release-blocker' }],
      deliveryPreference: 'chat',
    });
    const created = JSON.parse((createRes.content[0] as { text: string }).text);
    expect(created.saved).toBe(true);
    expect(created.outcome).toBe('created');
    expect(created.bindings).toHaveLength(1);
    expect(onMatterMutated).toHaveBeenCalledWith({ matterId: created.matterId, kind: 'created' });

    // Duplicate create reuses the existing active matter
    const dupRes = await tool.execute('tc-2', {
      command: 'matter_create',
      title: '试点发布阻塞',
      goal: '跟踪试点发布前 GitHub 上的 release-blocker 状态',
      notifyWhen: '出现新增或解除的 release-blocker',
    });
    expect(JSON.parse((dupRes.content[0] as { text: string }).text).outcome).toBe('reused_active');

    // Unified list exposes active matters
    const listRes = await tool.execute('tc-3', { command: 'list' });
    const listPayload = JSON.parse((listRes.content[0] as { text: string }).text);
    expect(listPayload.matters).toHaveLength(1);
    expect(listPayload.matters[0].matterId).toBe(created.matterId);

    // Explicit resolve stops the matter and its paired bindings
    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '试点发布已经搞定了，不用跟了',
      timestamp: now + 1000,
    });
    const resolveRes = await tool.execute('tc-4', {
      command: 'matter_resolve',
      id: created.matterId,
    });
    const resolvePayload = JSON.parse((resolveRes.content[0] as { text: string }).text);
    expect(resolvePayload.resolved).toBe(true);
    expect(resolvePayload.status).toBe('resolved');
  });

  it('executes approved ProactiveHub draft/task actions and records executedAction receipt idempotently', async () => {
    const executeApprovedAction = vi.fn().mockResolvedValue({
      kind: 'approve_draft',
      taskId: 'task-exec-1',
      summary: 'Send approved reply to Sarah',
      executedAt: now + 500,
    });
    const onPublishEvent = vi.fn();
    const hub = new ProactiveHubService({
      ownerId,
      getConfig: () => config,
      isConversationAvailable: () => true,
      executeApprovedAction,
      onPublishEvent,
      now: () => now,
    });

    const item = saveProactiveItem({
      ownerId,
      agentId: personalAgentId(ownerId),
      coalesceKey: 'gmail:thread-sarah',
      sourceEventIds: ['evt-mail-1'],
      tier: 'tier_a_inbox',
      category: 'prepared_draft',
      title: 'Sarah 询问 Q4 预算确认',
      summary: 'Sarah 等待今天下午前确认预算范围。',
      provenance: {
        source: 'composio:gmail',
        eventType: 'connector.mail.received',
        trust: 'connector',
        coalescedCount: 1,
        reason: 'Direct question with deadline',
        evidenceRefs: ['event:evt-mail-1'],
        score: { actionability: 3, urgency: 2, novelty: 2, preparedness: 2, disruptionPenalty: 0, netScore: 14 },
      },
      preparedPayload: {
        verifiedFacts: ['Sarah requested Q4 budget confirmation'],
        evidenceRefs: ['event:evt-mail-1'],
        preparedDraft: 'Hi Sarah, confirmed Q4 budget is approved.',
      },
      proposedAction: {
        kind: 'approve_draft',
        safetyMode: 'ask_before_apply',
        label: '批准并发送草稿',
      },
      state: 'ready',
      idempotencyKey: 'mail-sarah-1',
      validUntil: now + 86_400_000,
      now,
    });

    const resolved = await hub.resolveItem(item.id, {
      action: 'edit_and_approve',
      idempotencyKey: 'act-1',
      editedDraft: 'Hi Sarah, confirmed Q4 budget is approved with 10% buffer.',
    }, ownerId);

    expect(executeApprovedAction).toHaveBeenCalledTimes(1);
    expect(resolved.humanResolution?.executedAction).toMatchObject({
      kind: 'approve_draft',
      taskId: 'task-exec-1',
      summary: 'Send approved reply to Sarah',
    });

    // Replaying with the same idempotencyKey does NOT re-execute the side effect
    const replayed = await hub.resolveItem(item.id, {
      action: 'edit_and_approve',
      idempotencyKey: 'act-1',
      editedDraft: 'Hi Sarah, confirmed Q4 budget is approved with 10% buffer.',
    }, ownerId);
    expect(executeApprovedAction).toHaveBeenCalledTimes(1);
    expect(replayed.humanResolution?.executedAction?.taskId).toBe('task-exec-1');
  });

  it('serves unified GET /api/personal-agent/following overview for Personal UI', async () => {
    const sourceId = appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '帮我继续关注发布会物料准备，下周再看',
      timestamp: now,
    }).entry_id;
    saveAttention({
      conversationId,
      subject: '发布会物料准备',
      summary: '跟进发布会演示稿和视频素材',
      kind: 'outcome',
      entryIds: [sourceId],
      explicit: true,
      nextCheckAt: now + 3_600_000,
    }, now);

    const tool = createPersonalAttentionTool({
      getConversationId: () => conversationId,
      getConfig: () => config,
    });
    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '帮我跟进 Sarah 确认 Q4 预算的事情，周四前没回提醒我',
      timestamp: now + 1000,
    });
    await tool.execute('tc-m1', {
      command: 'matter_create',
      title: 'Sarah Q4 预算确认',
      goal: '确保拿到 Sarah 对 Q4 预算的确认回复',
      notifyWhen: 'Sarah 回复或周四前未回复',
      eventSources: [{ source: 'gmail', keyword: '预算', sender: 'sarah' }],
    });

    const token = 'following-test-token';
    const app = createHonoApp({
      service: {
        currentConfig: config,
        getResolvedAuth: () => ({ mode: 'token', token }),
        getAuthToken: () => token,
        isGatewayReady: () => true,
        getExtensionLoader: () => null,
        emit: vi.fn(),
      } as unknown as GatewayService,
    });

    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const unauth = await fetch(`${base}/api/personal-agent/following`);
      expect(unauth.status).toBe(401);

      const response = await fetch(`${base}/api/personal-agent/following`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as {
        ok: boolean;
        payload: {
          matters: Array<{ title: string; bindings: Array<{ kind: string }> }>;
          recurring: Array<{ subject: string }>;
          activeCount: number;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.payload.matters).toHaveLength(1);
      expect(body.payload.matters[0]?.title).toBe('Sarah Q4 预算确认');
      expect(body.payload.matters[0]?.bindings[0]?.kind).toBe('event_source');
      expect(body.payload.recurring).toHaveLength(1);
      expect(body.payload.recurring[0]?.subject).toBe('发布会物料准备');
      expect(body.payload.activeCount).toBe(2);
    } finally {
      server.close();
    }
  });
});
