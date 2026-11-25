import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { createPersonalAttentionTool } from '../../agent/tools/personal-attention-tool.js';
import { createPersonalInboxTool } from '../../agent/tools/personal-inbox-tool.js';
import type { AutomationEvent } from '../../automations/domain/types.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { getProactivitySettings, patchProactivitySettings } from '../../personal-agent/proactivity/repository.js';
import { personalAgentId, personalConversationId } from '../../personal-agent/repository.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { MatterInvestigatorService } from '../matter-investigator.js';
import { createOrReuseMatter, getMatter, listMatters } from '../matters.js';
import {
  listProactiveInboxItems,
  listProactiveSubscriptions,
  saveProactiveItem,
} from '../repository.js';
import { ProactiveHubService } from '../triage-service.js';
import {
  createOrReuseWebWatch,
  getWebWatch,
  listWebWatches,
  normalizeWebWatchText,
  WebWatchSignalProducer,
} from '../web-watch.js';

describe('Unified FollowUpMatter Loop, Web Sensor Engine, and personal_inbox Tool', () => {
  let dir: string;
  let now: number;
  const ownerId = 'local-owner';
  const conversationId = personalConversationId(ownerId);
  const config = ConfigSchema.parse({});

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-matter-inbox-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    now = Date.parse('2026-11-25T15:00:00+08:00');

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

  it('runs a complete multi-source FollowUpMatter loop: silent timeline check -> actionable draft to Inbox & Chat -> resolved with cascading binding cleanup', async () => {
    let html = '<html><head><title>陶艺工作坊报名</title></head><body><p>周日 15:00 场次：已满</p></body></html>';
    const emitted: AutomationEvent[] = [];
    const fetchPage = vi.fn(async (url: string) => ({ text: html, contentType: 'text/html; charset=utf-8', url }));
    const webWatchProducer = new WebWatchSignalProducer({
      ownerId,
      getConfig: () => config,
      ingestEvent: event => emitted.push(event),
      fetchPage,
      now: () => now,
    });

    const { matter } = createOrReuseMatter({
      ownerId,
      conversationId,
      title: '周末陶艺工作坊补位',
      goal: '盯官网补位并顺便找同城类似场次，报上名就结束',
      notifyWhen: '周日 15:00 有补位或找到合适替代场次',
      doneCriteria: '用户成功报名或明确取消',
      deliveryPreference: 'auto',
      urls: ['https://workshop.example.com/pottery'],
      searchQueries: ['本周末 同城 陶艺工作坊 报名'],
      eventSources: [{ source: 'gmail', keyword: '陶艺' }],
    }, now);

    expect(matter.bindings).toHaveLength(3);
    const webBinding = matter.bindings.find(b => b.kind === 'web_url')!;
    const subBinding = matter.bindings.find(b => b.kind === 'event_source')!;
    expect(getWebWatch(ownerId, webBinding.watchId)?.enabled).toBe(true);
    expect(listProactiveSubscriptions(ownerId).find(s => s.id === subBinding.subscriptionId)?.enabled).toBe(true);

    const runWebSearch = vi.fn().mockResolvedValue('1. 城西手作陶艺社 周六 14:00 尚余 3 席');
    const callModel = vi.fn();
    const onChatMessageDelivered = vi.fn();
    const investigator = new MatterInvestigatorService({
      ownerId,
      getConfig: () => config,
      isConversationAvailable: () => true,
      webWatchProducer,
      runWebSearch,
      callModel,
      onChatMessageDelivered,
      now: () => now,
    });

    // Pass 1: Silent check -> records quiet timeline entry, zero interruption
    callModel.mockResolvedValueOnce(JSON.stringify({
      decision: 'silent_update',
      statusSummary: '官网周日 15:00 仍显示已满，暂未见补位。',
      nextCheckMinutes: 45,
      evidenceRefs: [`web:${webBinding.watchId}`, 'search:1'],
    }));
    const afterCheck1 = await investigator.checkNow(matter.id, ownerId);
    expect(afterCheck1.status).toBe('active');
    expect(afterCheck1.progressLog[0]?.kind).toBe('check_silent');
    expect(afterCheck1.nextCheckAt).toBe(now + 45 * 60_000);
    expect(onChatMessageDelivered).not.toHaveBeenCalled();

    // Pass 2: Page updates -> contact_with_action produces Inbox draft + Chat message + waiting_user
    now += 45 * 60_000;
    html = '<html><head><title>陶艺工作坊报名</title></head><body><p>周日 15:00 场次：补位开放（余 2 席）</p></body></html>';
    callModel.mockResolvedValueOnce(JSON.stringify({
      decision: 'contact_with_action',
      statusSummary: '周日 15:00 陶艺场次放出 2 个补位名额！',
      message: '你盯的陶艺工作坊周日 15:00 刚放出 2 个补位名额，可以立刻报名。',
      preparedDraft: '帮我打开 https://workshop.example.com/pottery 完成周日 15:00 场次预约确认。',
      proposedActionLabel: '发起报名准备任务',
      proposedActionKind: 'create_task',
      nextCheckMinutes: 30,
      evidenceRefs: [`web:${webBinding.watchId}`],
    }));
    const afterCheck2 = await investigator.scanDue();
    expect(afterCheck2).toBe(1);
    const updatedMatter = getMatter(ownerId, matter.id)!;
    expect(updatedMatter.status).toBe('waiting_user');
    expect(updatedMatter.progressLog[0]?.kind).toBe('action_proposed');
    expect(onChatMessageDelivered).toHaveBeenCalledTimes(1);
    expect(listProactiveInboxItems(ownerId).some(i => i.title === '周末陶艺工作坊补位')).toBe(true);

    // Pass 3: Goal met -> resolved cascades and disables ALL paired web watches & subscriptions
    now += 30 * 60_000;
    callModel.mockResolvedValueOnce(JSON.stringify({
      decision: 'resolved',
      statusSummary: '已确认收到报名成功邮件，跟进结束。',
      message: '确认你已报上周日陶艺工作坊，本次跟进已自动结束。',
      evidenceRefs: [`matter:${matter.id}`],
    }));
    const resolvedMatter = await investigator.checkNow(matter.id, ownerId);
    expect(resolvedMatter.status).toBe('resolved');
    expect(resolvedMatter.nextCheckAt).toBeNull();
    expect(getWebWatch(ownerId, webBinding.watchId)?.enabled).toBe(false);
    expect(listProactiveSubscriptions(ownerId).find(s => s.id === subBinding.subscriptionId)?.enabled).toBe(false);
  });

  it('serves authenticated Matter REST endpoints (/following, /matters/:id, /check, PATCH, DELETE) and blocks SSRF URLs', async () => {
    expect(() => createOrReuseWebWatch({
      ownerId,
      url: 'http://169.254.169.254/latest/meta-data/',
      condition: 'any change',
    }, now)).toThrow(/Unsafe URL blocked/i);

    const emitted: AutomationEvent[] = [];
    const fetchPage = vi.fn(async (url: string) => ({
      text: '<html><head><title>Release Notes</title></head><body><script>var t=1;</script><p>v2.0 released</p></body></html>',
      contentType: 'text/html',
      url,
    }));
    expect(normalizeWebWatchText('<script>x</script><p>Hello</p>', 'text/html').text).toBe('Hello');

    const webWatchProducer = new WebWatchSignalProducer({
      ownerId,
      getConfig: () => config,
      ingestEvent: event => emitted.push(event),
      fetchPage,
      now: () => now,
    });
    const investigator = new MatterInvestigatorService({
      ownerId,
      getConfig: () => config,
      isConversationAvailable: () => true,
      webWatchProducer,
      callModel: vi.fn().mockResolvedValue(JSON.stringify({
        decision: 'silent_update',
        statusSummary: '已检查 Release Notes，目前版本为 v2.0。',
        nextCheckMinutes: 60,
        evidenceRefs: ['matter:placeholder'],
      })),
      now: () => now,
    });

    const tool = createPersonalAttentionTool({
      getConversationId: () => conversationId,
      getConfig: () => config,
      getMatterInvestigator: () => investigator,
    });

    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '帮我跟进 https://release.example.com/changelog 看看什么时候发布 v2.1',
      timestamp: now,
    });
    const createdRes = await tool.execute('m-1', {
      command: 'matter_create',
      title: 'v2.1 发布动态',
      goal: '持续关注 v2.1 是否发布',
      notifyWhen: '出现 v2.1 发布说明',
      urls: ['https://release.example.com/changelog'],
    });
    const created = JSON.parse((createdRes.content[0] as { text: string }).text);
    expect(created.saved).toBe(true);

    // Override callModel to cite the actual created matter ref
    const realInvestigator = new MatterInvestigatorService({
      ownerId,
      getConfig: () => config,
      isConversationAvailable: () => true,
      webWatchProducer,
      callModel: vi.fn().mockResolvedValue(JSON.stringify({
        decision: 'silent_update',
        statusSummary: '已检查 Release Notes，尚未看到 v2.1。',
        nextCheckMinutes: 60,
        evidenceRefs: [`matter:${created.matterId}`],
      })),
      now: () => now,
    });

    const token = 'matter-http-token';
    const app = createHonoApp({
      service: {
        currentConfig: config,
        matterInvestigatorInstance: realInvestigator,
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

      const checkRes = await fetch(`${base}/api/personal-agent/matters/${encodeURIComponent(created.matterId)}/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(checkRes.status).toBe(200);
      expect((await checkRes.json()).payload.lastSummary).toContain('尚未看到 v2.1');

      const patchRes = await fetch(`${base}/api/personal-agent/matters/${encodeURIComponent(created.matterId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paused', userNote: '下周再看' }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).payload.status).toBe('paused');

      const delRes = await fetch(`${base}/api/personal-agent/matters/${encodeURIComponent(created.matterId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status).toBe(200);
      expect(listMatters(ownerId, { includeClosed: true })).toHaveLength(0);
      expect(listWebWatches(ownerId)).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it('enables conversational list, disambiguation, explicit approval guardrails, edit_and_approve execution, and mute via personal_inbox', async () => {
    const executeApprovedAction = vi.fn().mockResolvedValue({
      kind: 'approve_draft',
      taskId: 'task-chat-approved-1',
      summary: '发送调整后的合同回复',
      executedAt: now + 500,
    });
    const hub = new ProactiveHubService({
      ownerId,
      getConfig: () => config,
      isConversationAvailable: () => true,
      executeApprovedAction,
      now: () => now,
    });

    const item1 = saveProactiveItem({
      ownerId,
      agentId: personalAgentId(ownerId),
      coalesceKey: 'gmail:contract-q4',
      sourceEventIds: ['evt-c1'],
      tier: 'tier_a_inbox',
      category: 'prepared_draft',
      title: 'Q4 合同账期确认草稿',
      summary: '法务询问是否同意 45 天账期。',
      provenance: {
        source: 'composio:gmail',
        eventType: 'connector.mail.received',
        trust: 'connector',
        coalescedCount: 1,
        reason: '等待账期确认',
        evidenceRefs: ['event:evt-c1'],
        score: { actionability: 3, urgency: 2, novelty: 2, preparedness: 2, disruptionPenalty: 0, netScore: 14 },
      },
      preparedPayload: {
        verifiedFacts: ['对方提议 45 天账期'],
        evidenceRefs: ['event:evt-c1'],
        preparedDraft: '同意 45 天账期。',
      },
      proposedAction: {
        kind: 'approve_draft',
        safetyMode: 'ask_before_apply',
        label: '发送草稿',
      },
      state: 'ready',
      idempotencyKey: 'inbox-c1',
      validUntil: now + 86_400_000,
      now,
    });

    const item2 = saveProactiveItem({
      ownerId,
      agentId: personalAgentId(ownerId),
      coalesceKey: 'github:ci-flaky',
      sourceEventIds: ['evt-ci-2'],
      tier: 'tier_a_inbox',
      category: 'info',
      title: 'CI 夜间测试波动告警',
      summary: 'Nightly build 偶发超时。',
      provenance: {
        source: 'composio:github',
        eventType: 'connector.github.workflow_failed',
        trust: 'connector',
        coalescedCount: 1,
        reason: 'CI workflow failed',
        evidenceRefs: ['event:evt-ci-2'],
        score: { actionability: 2, urgency: 1, novelty: 1, preparedness: 1, disruptionPenalty: 0, netScore: 8 },
      },
      state: 'ready',
      idempotencyKey: 'inbox-c2',
      validUntil: now + 86_400_000,
      now,
    });

    const inboxTool = createPersonalInboxTool({
      getConversationId: () => conversationId,
      getConfig: () => config,
      getProactiveHubService: () => hub,
    });

    const listRes = await inboxTool.execute('in-1', { command: 'list' });
    expect(JSON.parse((listRes.content[0] as { text: string }).text).total).toBe(2);

    // Negated utterance must NEVER approve
    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '先别批准那个合同草稿，我再想想',
      timestamp: now + 1000,
    });
    const negatedRes = await inboxTool.execute('in-2', { command: 'approve', itemId: item1.id });
    expect(JSON.parse((negatedRes.content[0] as { text: string }).text)).toMatchObject({
      applied: false,
      status: 'confirmation_required',
    });
    expect(executeApprovedAction).not.toHaveBeenCalled();

    // Ambiguous approval returns clarification_needed
    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '批准吧',
      timestamp: now + 2000,
    });
    const ambigRes = await inboxTool.execute('in-3', { command: 'approve' });
    expect(JSON.parse((ambigRes.content[0] as { text: string }).text)).toMatchObject({
      applied: false,
      status: 'clarification_needed',
      reason: 'ambiguous_inbox_item',
    });

    // Explicit edit_and_approve matches via CJK bigrams and executes
    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '把合同账期草稿改成“同意 45 天账期并保留滞纳金条款”然后发了吧',
      timestamp: now + 3000,
    });
    const approvedRes = await inboxTool.execute('in-4', {
      command: 'edit_and_approve',
      editedDraft: '同意 45 天账期并保留滞纳金条款。',
    });
    expect(JSON.parse((approvedRes.content[0] as { text: string }).text)).toMatchObject({
      applied: true,
      itemId: item1.id,
      state: 'acted',
      executedAction: { kind: 'approve_draft', taskId: 'task-chat-approved-1' },
    });

    // Explicit mute silences remaining CI alert
    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: '以后别再推这类 CI 告警了，直接静音掉',
      timestamp: now + 4000,
    });
    const muteRes = await inboxTool.execute('in-5', {
      command: 'mute',
      itemId: item2.id,
      muteMode: 'drop',
      senderOrSubjectFilter: 'CI 夜间测试',
    });
    expect(JSON.parse((muteRes.content[0] as { text: string }).text)).toMatchObject({
      applied: true,
      itemId: item2.id,
      state: 'muted',
    });
  });
});
