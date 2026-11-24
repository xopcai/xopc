import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { parseProductDeliveryText } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { createPersonalAttentionTool } from '../../agent/tools/personal-attention-tool.js';
import { ingestAutomationEvent, listAutomationEvents } from '../../automations/events/event-repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { DomainOutboxDispatcher } from '../../infra/domain-outbox-dispatcher.js';
import { notificationPlanFromGatewayEvent } from '../../notifications/planner.js';
import { createProactiveSubscription, listProactiveInboxItems } from '../../proactive-hub/repository.js';
import { ProactiveHubService } from '../../proactive-hub/triage-service.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { HomeQueryService } from '../../tasks/home-query-service.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { resetPersonalConversation } from '../conversation-reset.js';
import {
  getOneShotFollowUpDto,
  listTaskOneShotFollowUps,
  listUnreadWorkbenchFollowUps,
  publishOneShotOutreach,
  stopOneShotFollowUp,
} from '../proactivity/one-shot-follow-up.js';
import { enqueueDue, getProactivitySettings, patchProactivitySettings } from '../proactivity/repository.js';
import { PersonalProactivityService } from '../proactivity/service.js';
import { personalAgentId, personalConversationId } from '../repository.js';
import { personalUnreadSnapshot } from '../unread.js';

// Friday 2026-11-27 in Asia/Shanghai: 15:40 delegate -> 16:00 check -> 17:00 expire
const DELEGATED_AT = Date.parse('2026-11-27T15:40:00+08:00');
const CHECK_AT = Date.parse('2026-11-27T16:00:00+08:00');
const REPLAY_AT = Date.parse('2026-11-27T16:05:00+08:00');
const VALID_UNTIL = Date.parse('2026-11-27T17:00:00+08:00');

describe('Personal one-shot conditional follow-up acceptance & concurrency', () => {
  let dir: string;
  let now: number;
  let available: boolean;
  let canReadTask: boolean;
  const ownerId = 'local-owner';
  const conversationId = personalConversationId(ownerId);
  const config = ConfigSchema.parse({});
  const notify = vi.fn();
  const followUpUpdated = vi.fn();
  const modelCall = vi.fn();
  const hubModelCall = vi.fn();
  let service: PersonalProactivityService;
  let hub: ProactiveHubService;

  function createPendingTaskFixture(input: {
    title: string;
    waitReason: string;
    question?: string;
    dueAt?: number;
    linkToPersonal?: boolean;
  }) {
    const appService = new TaskApplicationService();
    const created = appService.create({
      idempotencyKey: `task:${input.title}:${Math.random()}`,
      title: input.title,
      priority: 'high',
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      contract: {
        objective: input.title,
        acceptanceCriteria: ['Confirm decision'],
        acceptancePolicy: 'manual',
        constraints: [],
      },
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    if (!created.ok || !created.runId) throw new Error('Failed to create task fixture');
    const runs = new TaskRunRepository();
    const wait = runs.createWait({
      taskId: created.model.task.id,
      taskRunId: created.runId,
      kind: 'user_input',
      reason: input.waitReason,
      condition: {
        question: input.question ?? input.waitReason,
        choices: ['iOS 先发', '双端同发'],
      },
      now,
    });
    if (input.linkToPersonal) {
      getSqliteDatabase()
        .prepare('INSERT OR IGNORE INTO task_origin_links(task_id, conversation_id, created_at) VALUES (?, ?, ?)')
        .run(created.model.task.id, conversationId, now);
    }
    return { task: created.model.task, runId: created.runId, wait };
  }

  function submitUserUtterance(content: string, opts?: { taskRefId?: string; clientMessageId?: string }) {
    const inputId = randomUUID();
    const clientMessageId = opts?.clientMessageId ?? `msg-${inputId}`;
    const contextRefs = opts?.taskRefId
      ? [{ kind: 'task' as const, sourceId: opts.taskRefId, version: '1', title: 'Ref Task' }]
      : undefined;
    insertSessionInput({
      id: inputId,
      conversationId,
      clientMessageId,
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content,
      contextRefs,
      origin: { type: 'endpoint', endpointId: 'web-test' },
    });
    const runId = `run-${inputId}`;
    claimNextSessionInput(conversationId, runId, inputId);
    const entry = appendTranscriptEntry(conversationId, {
      role: 'user',
      turnId: runId,
      content,
      timestamp: now,
      metadata: {
        clientMessageId,
        ...(contextRefs ? { sourceContexts: contextRefs } : {}),
      },
    });
    return { inputId, runId, entryId: entry.entry_id };
  }

  function completeForegroundTurn(_inputId: string, runId: string) {
    finishSessionInputRun(conversationId, runId, 'completed');
  }

  function drainOutboxAndProjectEvents() {
    new DomainOutboxDispatcher().drain();
    for (const evt of listAutomationEvents()) {
      service.ingestEvent(evt);
      hub.ingestEvent(evt);
    }
  }

  function parseToolPayload(result: { content: Array<{ type: string; text?: string }> }) {
    const raw = result.content[0]?.text ?? '';
    const jsonText = raw.split('\nOpen in xopc:')[0]!.split('\nxopc-product-delivery:')[0]!;
    return {
      payload: JSON.parse(jsonText) as Record<string, unknown>,
      delivery: parseProductDeliveryText(raw),
    };
  }

  const transcriptRows = () =>
    getSqliteDatabase()
      .prepare('SELECT payload_json FROM transcript_entries WHERE transcript_id = (SELECT active_transcript_id FROM sessions WHERE conversation_id = ?) ORDER BY seq')
      .all(conversationId)
      .map(r => JSON.parse(String(r.payload_json)));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-one-shot-followup-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    now = DELEGATED_AT;
    available = true;
    canReadTask = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);

    patchProactivitySettings(ownerId, {
      ...getProactivitySettings(ownerId),
      mode: 'follow_up',
      timezone: 'Asia/Shanghai',
      quietStart: 0,
      quietEnd: 0,
    });
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: personalAgentId(ownerId), profile: { name: 'Ada' } }, { ready: true });
    createConversation(
      { agentId: personalAgentId(ownerId), sourceChannel: 'webchat', customData: { personalAgent: true } },
      '',
      conversationId,
    );
    setSessionConfig(conversationId, { fixedModel: true }, dir);

    notify.mockReset();
    followUpUpdated.mockReset();
    modelCall.mockReset();
    hubModelCall.mockReset();

    hub = new ProactiveHubService({
      getConfig: () => config,
      isConversationAvailable: () => available,
      callModel: hubModelCall,
      now: () => now,
    });
    service = new PersonalProactivityService({
      getConfig: () => config,
      isAvailable: () => available,
      notify,
      onFollowUpUpdated: followUpUpdated,
      onBeforePublishOneShot: info => {
        hub.retireCoveredTaskWait(info.taskId, info.waitId, info.now);
      },
      call: modelCall,
      now: () => now,
    });
  });

  afterEach(async () => {
    hub.stop();
    await service.stop();
    vi.useRealTimers();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each(['personal', 'workbench'] as const)('Three core acceptance branches (destination=%s)', destination => {
    it('Branch 1 (到点命中): delivers exactly once to the chosen surface, survives notify failure + restart + replay', async () => {
      const fixture = createPendingTaskFixture({
        title: '移动端试点发布看板',
        waitReason: '确认本周试点发布范围（iOS 先发或双端同发）',
        dueAt: VALID_UNTIL,
      });
      createProactiveSubscription(ownerId, {
        scopeType: 'global',
        sourcePattern: 'tasks',
        eventTypePattern: 'task.*',
        matchPredicates: {},
        defaultRoute: 'triage',
        coalesceWindowMs: 0,
        enabled: true,
      }, 'user_explicit', now);

      const utterance = destination === 'personal'
        ? '周五 16:00 如果还需要我定试点范围，就告诉我一声。'
        : '周五 16:00 如果还需要我定试点范围，就放工作台提醒我。';
      const turn = submitUserUtterance(utterance, { taskRefId: fixture.task.id });
      const tool = createPersonalAttentionTool({
        getConversationId: () => conversationId,
        getConfig: () => config,
        canReadTask: () => canReadTask,
      });

      const createdRes = await tool.execute('call-1', { command: 'follow', oneShot: true });
      const { payload, delivery } = parseToolPayload(createdRes);
      completeForegroundTurn(turn.inputId, turn.runId);

      expect(payload).toMatchObject({
        saved: true,
        outcome: 'created',
        taskId: fixture.task.id,
        waitId: fixture.wait.id,
        destination,
        checkAt: CHECK_AT,
        validUntil: VALID_UNTIL,
        validUntilSource: 'task_due',
      });
      expect(delivery?.primary).toMatchObject({
        kind: 'personal_follow_up',
        id: payload.followUpId,
        status: 'scheduled',
      });
      const followUpId = String(payload.followUpId);

      // Workbench Task projection sees the exact same followUpId
      expect(listTaskOneShotFollowUps(fixture.task.id, ownerId)[0]).toMatchObject({
        followUpId,
        displayState: 'scheduled',
        destination,
      });

      // Drain outbox events before 16:00: Hub must yield covered (taskId, waitId) at Gate 1 without spending LLM calls
      drainOutboxAndProjectEvents();
      await hub.drain();
      expect(hubModelCall).not.toHaveBeenCalled();
      expect(listProactiveInboxItems(ownerId, { now })).toHaveLength(0);
      expect(notificationPlanFromGatewayEvent('task.attention_required.v2', {
        sourceEventId: 'evt-attn-1',
        task: { id: fixture.task.id, title: fixture.task.title },
        waitId: fixture.wait.id,
        reason: 'user_input',
      })).toBeNull();

      // Advance to 16:00; simulate transient broadcast failure on first publish, then restart & replay at 16:05
      now = CHECK_AT;
      vi.setSystemTime(now);
      if (destination === 'personal') {
        notify.mockImplementationOnce(() => {
          throw new Error('Realtime socket transiently disconnected');
        });
      }
      enqueueDue(now);
      await service.drain();

      // Simulate Gateway restart + event replay + 16:05 tick
      await service.stop();
      const restarted = new PersonalProactivityService({
        getConfig: () => config,
        isAvailable: () => true,
        notify,
        onFollowUpUpdated: followUpUpdated,
        call: modelCall,
        now: () => now,
      });
      now = REPLAY_AT;
      vi.setSystemTime(now);
      const { event: replayEvent } = ingestAutomationEvent({
        type: 'task.changed.v2',
        source: 'tasks',
        subject: { kind: 'task', id: fixture.task.id },
        occurredAtMs: now,
        trust: 'system',
        payload: { taskId: fixture.task.id, waitId: fixture.wait.id, version: 2, changedFields: ['attention'] },
      });
      restarted.ingestEvent(replayEvent);
      expect(hub.ingestEvent(replayEvent).outcome).toBe('dropped_rule');
      enqueueDue(now);
      await restarted.drain();
      await hub.drain();
      await restarted.stop();

      // DB invariants: 1 thread, 1 wakeup, 1 published outreach
      const db = getSqliteDatabase();
      expect(db.prepare('SELECT COUNT(*) AS n FROM personal_attention_threads').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM personal_wakeups').get()).toEqual({ n: 1 });
      const outreachRows = db.prepare('SELECT * FROM personal_outreach').all() as Array<Record<string, unknown>>;
      expect(outreachRows).toHaveLength(1);
      expect(outreachRows[0]).toMatchObject({
        state: 'published',
        destination,
        published_at: CHECK_AT,
        notified_at: destination === 'personal' ? REPLAY_AT : CHECK_AT,
      });

      const history = transcriptRowsToClientHistory(transcriptRows());
      const proactiveMessages = history.filter(msg => msg.metadata?.personalProvenance !== undefined);
      const unreadWorkbench = listUnreadWorkbenchFollowUps(ownerId);

      if (destination === 'personal') {
        expect(proactiveMessages).toHaveLength(1);
        expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(1);
        expect(unreadWorkbench).toHaveLength(0);
      } else {
        expect(proactiveMessages).toHaveLength(0);
        expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(0);
        expect(unreadWorkbench).toHaveLength(1);
        expect(unreadWorkbench[0]).toMatchObject({
          followUpId,
          outreachId: outreachRows[0]!.id,
          taskId: fixture.task.id,
        });
      }
      expect(getOneShotFollowUpDto(followUpId, ownerId)).toMatchObject({
        status: 'completed',
        displayState: 'delivered',
        terminalReason: 'delivered',
      });
      expect(modelCall).not.toHaveBeenCalled();
    });

    it('Branch 2 (提前处理): resolving the TaskWait before checkAt quietly ends the follow-up with zero alerts even if events are missed', async () => {
      const fixture = createPendingTaskFixture({
        title: '移动端试点发布看板',
        waitReason: '确认试点范围',
        dueAt: VALID_UNTIL,
        linkToPersonal: true,
      });
      const utterance = destination === 'personal'
        ? '周五 16:00 如果还需要我定范围就告诉我'
        : '周五 16:00 如果还需要我定范围就放工作台提醒';
      const turn = submitUserUtterance(utterance);
      const tool = createPersonalAttentionTool({
        getConversationId: () => conversationId,
        getConfig: () => config,
      });
      const { payload } = parseToolPayload(await tool.execute('call-early', { command: 'follow', oneShot: true }));
      completeForegroundTurn(turn.inputId, turn.runId);
      const followUpId = String(payload.followUpId);

      // 15:45 user resolves wait in Workbench (intentionally do NOT deliver outbox event first to verify SQLite re-read at 16:00 too)
      now = Date.parse('2026-11-27T15:45:00+08:00');
      vi.setSystemTime(now);
      const resolved = new TaskApplicationService().execute({
        taskId: fixture.task.id,
        expectedVersion: fixture.task.version,
        idempotencyKey: 'resolve-early-1',
        actor: { kind: 'user', id: ownerId },
        command: {
          type: 'resolve_wait',
          waitId: fixture.wait.id,
          resolution: { kind: 'user_answer', answer: 'iOS 先发' },
        },
      });
      expect(resolved.ok).toBe(true);

      // Advance to 16:00 tick + replay events afterwards
      now = CHECK_AT;
      vi.setSystemTime(now);
      enqueueDue(now);
      await service.drain();
      drainOutboxAndProjectEvents();
      await service.drain();

      expect(getOneShotFollowUpDto(followUpId, ownerId)).toMatchObject({
        status: 'completed',
        displayState: 'resolved_before_check',
        terminalReason: 'resolved_before_check',
      });
      expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS n FROM personal_outreach WHERE state = 'published'").get()).toEqual({ n: 0 });
      expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(0);
      expect(listUnreadWorkbenchFollowUps(ownerId)).toHaveLength(0);
    });

    it('Branch 3 (排队后停止): stops cleanly from Personal or Workbench via real authenticated Gateway while preserving independent TaskWait', async () => {
      const fixture = createPendingTaskFixture({
        title: '移动端试点发布看板',
        waitReason: '确认试点范围',
        dueAt: VALID_UNTIL,
        linkToPersonal: true,
      });
      // Enable quiet hours covering 16:00 so both personal & workbench destinations enter ready queue at 16:00
      patchProactivitySettings(ownerId, {
        ...getProactivitySettings(ownerId),
        quietStart: 15,
        quietEnd: 17,
      });

      const utterance = destination === 'personal'
        ? '周五 16:00 如果还需要我定范围就告诉我'
        : '周五 16:00 如果还需要我定范围就放工作台提醒';
      const turn = submitUserUtterance(utterance);
      const tool = createPersonalAttentionTool({
        getConversationId: () => conversationId,
        getConfig: () => config,
      });
      const { payload } = parseToolPayload(await tool.execute('call-stop', { command: 'follow', oneShot: true }));
      completeForegroundTurn(turn.inputId, turn.runId);
      const followUpId = String(payload.followUpId);

      // 16:00 check hits condition, enters ready queue ("等待送达"), zero unread yet
      now = CHECK_AT;
      vi.setSystemTime(now);
      enqueueDue(now);
      await service.drain();
      expect(getOneShotFollowUpDto(followUpId, ownerId)).toMatchObject({
        status: 'active',
        displayState: 'queued_delivery',
        outreach: { state: 'ready', destination },
      });
      expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(0);
      expect(listUnreadWorkbenchFollowUps(ownerId)).toHaveLength(0);

      // Stop through real running authenticated Gateway HTTP server (for workbench) or Personal natural language (for personal)
      const token = 'gateway-followup-test-token';
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

        // Unauthenticated requests are rejected
        expect((await fetch(`${base}/api/personal-agent/attention/${followUpId}`)).status).toBe(401);
        expect((await fetch(`${base}/api/personal-agent/attention/${followUpId}/stop`, { method: 'POST' })).status).toBe(401);

        if (destination === 'personal') {
          const stopTurn = submitUserUtterance('这件不用盯了');
          const stopRes = parseToolPayload(await tool.execute('nl-stop', { command: 'stop' }));
          completeForegroundTurn(stopTurn.inputId, stopTurn.runId);
          expect(stopRes.payload).toMatchObject({ outcome: 'stopped', followUpId });
        } else {
          const currentDetail = await (await fetch(`${base}/api/personal-agent/attention/${followUpId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })).json();
          expect(currentDetail.payload.displayState).toBe('queued_delivery');

          const stopHttp = await fetch(`${base}/api/personal-agent/attention/${followUpId}/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedRevision: currentDetail.payload.revision, idempotencyKey: 'workbench-stop-1' }),
          });
          expect(stopHttp.status).toBe(200);
          expect((await stopHttp.json()).payload).toMatchObject({
            outcome: 'stopped',
            followUp: { followUpId, displayState: 'stopped', terminalReason: 'stopped' },
          });
        }

        // Repeat stop from the other surface returns idempotent stopped state
        const repeatStop = await fetch(`${base}/api/personal-agent/attention/${followUpId}/stop`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: 'repeat-stop-2' }),
        });
        expect(repeatStop.status).toBe(200);
        expect((await repeatStop.json()).payload.outcome).toBe('stopped');
      } finally {
        server.close();
        await once(server, 'close');
      }

      // 16:05 exit quiet hours, replay events, restart service -> zero reminders delivered
      now = REPLAY_AT;
      vi.setSystemTime(now);
      patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 0, quietEnd: 0 });
      drainOutboxAndProjectEvents();
      await service.drain();

      expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS n FROM personal_outreach WHERE state = 'published'").get()).toEqual({ n: 0 });
      expect(personalUnreadSnapshot(conversationId)?.unreadCount).toBe(0);
      expect(listUnreadWorkbenchFollowUps(ownerId)).toHaveLength(0);

      // Original TaskWait remains active and can still be independently resolved
      expect(new TaskRunRepository().getWait(fixture.wait.id)?.status).toBe('active');
      const resolved = new TaskApplicationService().execute({
        taskId: fixture.task.id,
        expectedVersion: fixture.task.version,
        idempotencyKey: 'resolve-after-stop',
        actor: { kind: 'user', id: ownerId },
        command: {
          type: 'resolve_wait',
          waitId: fixture.wait.id,
          resolution: { kind: 'user_answer', answer: '双端同发' },
        },
      });
      expect(resolved.ok).toBe(true);
      expect(new TaskRunRepository().getWait(fixture.wait.id)?.status).toBe('resolved');
    });
  });

  it('recovers and delivers a queued reminder after busy foreground + DND changes without mismarking it stale, and acknowledges workbench unread via real HTTP', async () => {
    const fixture = createPendingTaskFixture({
      title: '季度预算审批',
      waitReason: '确认研发预算调整项',
      dueAt: VALID_UNTIL,
      linkToPersonal: true,
    });
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 15, quietEnd: 17 });
    const turn = submitUserUtterance('周五 16:00 如果还需要我定预算就放工作台提醒我');
    const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });
    const { payload } = parseToolPayload(await tool.execute('q-follow', { command: 'follow', oneShot: true }));
    completeForegroundTurn(turn.inputId, turn.runId);

    // 16:00 hits during DND + busy foreground
    now = CHECK_AT;
    vi.setSystemTime(now);
    available = false;
    await service.drain();
    expect(getOneShotFollowUpDto(String(payload.followUpId), ownerId)?.displayState).toBe('queued_delivery');

    // 16:05 another foreground turn finishes (bumping context_revision) AND user disables DND (bumping policy_revision)
    now = REPLAY_AT;
    vi.setSystemTime(now);
    const otherTurn = submitUserUtterance('顺便问个别的问题');
    completeForegroundTurn(otherTurn.inputId, otherTurn.runId);
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 0, quietEnd: 0 });
    available = true;
    await service.drain();

    const dto = getOneShotFollowUpDto(String(payload.followUpId), ownerId)!;
    expect(dto.displayState).toBe('delivered');
    expect(dto.outreach?.state).toBe('published');
    expect(dto.outreach?.acknowledgedAt).toBeNull();

    // Verify HomeQueryService projects unreadFollowUp onto needsUser and /api/home/attention/acknowledge clears it
    const homeService = new HomeQueryService({
      currentConfig: config,
      automationServiceInstance: { list: async () => [], listRuns: async () => [] } as never,
      projects: { list: async () => ({ items: [], total: 0 }) } as never,
      sessions: { listActiveRuns: () => [], getSession: async () => null },
    });
    const beforeAck = await homeService.getSnapshot('zh');
    expect(beforeAck.unreadFollowUps).toHaveLength(1);
    expect(beforeAck.needsUser.find(item => item.id === `task:${fixture.task.id}`)?.unreadFollowUp?.outreachId)
      .toBe(dto.outreach!.outreachId);

    const token = 'ack-token';
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
      const ackRes = await fetch(`${base}/api/home/attention/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'one_shot_follow_up', outreachId: dto.outreach!.outreachId }),
      });
      expect(ackRes.status).toBe(200);
      // Idempotent second ack
      const ackRes2 = await fetch(`${base}/api/home/attention/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'one_shot_follow_up', outreachId: dto.outreach!.outreachId }),
      });
      expect(ackRes2.status).toBe(200);
    } finally {
      server.close();
      await once(server, 'close');
    }

    const afterAck = await homeService.getSnapshot('zh');
    expect(afterAck.unreadFollowUps).toHaveLength(0);
    expect(new TaskRunRepository().getWait(fixture.wait.id)?.status).toBe('active');
  });

  it('proves deterministic stop-vs-publish race ordering in both directions', async () => {
    const tool = createPersonalAttentionTool({ getConversationId: () => conversationId, getConfig: () => config });

    // Case A: stop commits right before publishOneShotOutreach runs
    const fixtureA = createPendingTaskFixture({
      title: '竞态用例 A',
      waitReason: '待确认回滚窗口',
      dueAt: VALID_UNTIL,
      linkToPersonal: true,
    });
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 15, quietEnd: 17 });
    const turnA = submitUserUtterance('周五 16:00 如果还需要我确认回滚窗口就告诉我', { taskRefId: fixtureA.task.id });
    const followUpIdA = String(parseToolPayload(await tool.execute('race-a', { command: 'follow', oneShot: true })).payload.followUpId);
    completeForegroundTurn(turnA.inputId, turnA.runId);

    now = CHECK_AT;
    vi.setSystemTime(now);
    await service.drain(); // Queues ready outreach
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 0, quietEnd: 0 });
    const preStopRevisionA = getOneShotFollowUpDto(followUpIdA, ownerId)!.revision;

    const stopResultA = stopOneShotFollowUp({
      ownerId,
      followUpId: followUpIdA,
      expectedRevision: preStopRevisionA,
      idempotencyKey: 'race-stop-first',
    }, now);
    const latePublishA = publishOneShotOutreach(now, {
      getConfig: () => config,
      isConversationAvailable: () => true,
      notifyPersonalTranscript: notify,
    });
    expect(stopResultA.outcome).toBe('stopped');
    expect(latePublishA).toHaveLength(0);
    expect(getSqliteDatabase().prepare("SELECT state FROM personal_outreach WHERE thread_id = ?").get(followUpIdA)).toEqual({ state: 'cancelled' });

    // Case B: publish commits right before stop with stale expectedRevision arrives
    now = DELEGATED_AT;
    vi.setSystemTime(now);
    const fixtureB = createPendingTaskFixture({
      title: '竞态用例 B',
      waitReason: '待确认灰度比例',
      dueAt: VALID_UNTIL,
      linkToPersonal: true,
    });
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 15, quietEnd: 17 });
    const turnB = submitUserUtterance('周五 16:00 如果还需要我确认灰度比例就告诉我', { taskRefId: fixtureB.task.id });
    const followUpIdB = String(parseToolPayload(await tool.execute('race-b', { command: 'follow', oneShot: true })).payload.followUpId);
    completeForegroundTurn(turnB.inputId, turnB.runId);

    now = CHECK_AT;
    vi.setSystemTime(now);
    await service.drain(); // Queues ready outreach
    const staleClientRevisionB = getOneShotFollowUpDto(followUpIdB, ownerId)!.revision;
    patchProactivitySettings(ownerId, { ...getProactivitySettings(ownerId), quietStart: 0, quietEnd: 0 });

    const publishFirstB = publishOneShotOutreach(now, {
      getConfig: () => config,
      isConversationAvailable: () => true,
      notifyPersonalTranscript: notify,
    });
    const lateStopB = stopOneShotFollowUp({
      ownerId,
      followUpId: followUpIdB,
      expectedRevision: staleClientRevisionB,
      idempotencyKey: 'race-publish-first',
    }, now);
    expect(publishFirstB).toHaveLength(1);
    expect(lateStopB.outcome).toBe('already_delivered');
    expect(lateStopB.followUp.displayState).toBe('delivered');
    expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS n FROM personal_outreach WHERE thread_id = ? AND state = 'published'").get(followUpIdB)).toEqual({ n: 1 });
  });

  it('enforces two-layer idempotency, anti-false-positive filters, disambiguation, access revocation, offline expiry, reset, and a second scenario', async () => {
    const fixture = createPendingTaskFixture({
      title: '评审材料准备',
      waitReason: '补充安全合规评审材料',
      dueAt: VALID_UNTIL,
      linkToPersonal: true,
    });
    const tool = createPersonalAttentionTool({
      getConversationId: () => conversationId,
      getConfig: () => config,
      canReadTask: () => canReadTask,
    });

    // Reject negations, quoted examples, hypotheticals, and past times
    for (const counterexample of [
      '周五 16:00 不用提醒我补评审材料',
      '比如用户说「周五 16:00 如果还缺评审材料就告诉我」',
      '假设我说周五 16:00 提醒我，你会怎么处理？',
    ]) {
      const badTurn = submitUserUtterance(counterexample, { taskRefId: fixture.task.id });
      await expect(tool.execute('reject', { command: 'follow', oneShot: true })).rejects.toThrow('explicit');
      completeForegroundTurn(badTurn.inputId, badTurn.runId);
    }

    const pastTurn = submitUserUtterance('今天 15:00 如果还缺评审材料就告诉我', { taskRefId: fixture.task.id });
    const pastRes = parseToolPayload(await tool.execute('past', { command: 'follow', oneShot: true }));
    completeForegroundTurn(pastTurn.inputId, pastTurn.runId);
    expect(pastRes.payload).toMatchObject({ saved: false, status: 'past_check_time' });

    // Ambiguous multiple active waits asks one question without saving
    const secondWait = new TaskRunRepository().createWait({
      taskId: fixture.task.id,
      taskRunId: fixture.runId,
      kind: 'approval',
      reason: '批准法务对外条款',
      condition: { capability: 'legal.signoff' },
      now,
    });
    const ambigTurn = submitUserUtterance('周五 16:00 如果还没处理就告诉我', { taskRefId: fixture.task.id });
    const ambigRes = parseToolPayload(await tool.execute('ambig', { command: 'follow', oneShot: true }));
    completeForegroundTurn(ambigTurn.inputId, ambigTurn.runId);
    expect(ambigRes.payload).toMatchObject({ saved: false, status: 'clarification_needed', reason: 'ambiguous_wait' });
    new TaskRunRepository().resolveWait({ waitId: secondWait.id, actor: { kind: 'user', id: ownerId }, resolution: { approved: true }, now });

    // Layer-1 exact sessionInputId replay & Layer-2 equivalent delegation reuse on second scenario ("评审材料还缺补充")
    const turn1 = submitUserUtterance('周五 16:00 如果评审材料还缺补充就告诉我', { taskRefId: fixture.task.id });
    const created1 = parseToolPayload(await tool.execute('create-1', { command: 'follow', oneShot: true }));
    const replay1 = parseToolPayload(await tool.execute('replay-1', { command: 'follow', oneShot: true }));
    completeForegroundTurn(turn1.inputId, turn1.runId);
    expect(created1.payload.outcome).toBe('created');
    expect(replay1.payload).toMatchObject({ outcome: 'replayed_input', followUpId: created1.payload.followUpId });

    const turn2 = submitUserUtterance('周五下午 4 点要是安全合规评审材料还没补齐，在这里告诉我一声', { taskRefId: fixture.task.id });
    const reused2 = parseToolPayload(await tool.execute('reuse-2', { command: 'follow', oneShot: true }));
    completeForegroundTurn(turn2.inputId, turn2.runId);
    expect(reused2.payload).toMatchObject({ outcome: 'reused_active', followUpId: created1.payload.followUpId });
    expect(getOneShotFollowUpDto(String(created1.payload.followUpId), ownerId)?.sources).toHaveLength(2);

    // Different destination without confirmReplace asks confirmation instead of silently altering
    const turnDiff = submitUserUtterance('周五 16:00 如果评审材料还缺补充就放工作台提醒我', { taskRefId: fixture.task.id });
    const diffRes = parseToolPayload(await tool.execute('diff', { command: 'follow', oneShot: true }));
    completeForegroundTurn(turnDiff.inputId, turnDiff.runId);
    expect(diffRes.payload).toMatchObject({ saved: false, status: 'clarification_needed', reason: 'existing_active_follow_up_differs' });

    // Cross-owner isolation & access revocation redaction while still allowing owner to stop
    expect(getOneShotFollowUpDto(String(created1.payload.followUpId), 'other-owner')).toBeUndefined();
    canReadTask = false;
    const redacted = getOneShotFollowUpDto(String(created1.payload.followUpId), ownerId, { canReadTask: () => canReadTask })!;
    expect(redacted.taskTitle).toBeUndefined();
    expect(redacted.subject).toBe('');
    const stoppedAfterRevoke = stopOneShotFollowUp({
      ownerId,
      followUpId: redacted.followUpId,
      idempotencyKey: 'stop-after-revoke',
      canReadTask: () => canReadTask,
    }, now);
    expect(stoppedAfterRevoke.outcome).toBe('stopped');

    // Offline gateway past validUntil expires without late notification; conversation reset records conversation_reset
    canReadTask = true;
    const turn3 = submitUserUtterance('周五 16:00 如果评审材料还缺补充就告诉我', { taskRefId: fixture.task.id });
    const followUp3 = String(parseToolPayload(await tool.execute('create-3', { command: 'follow', oneShot: true })).payload.followUpId);
    completeForegroundTurn(turn3.inputId, turn3.runId);

    now = VALID_UNTIL + 60_000;
    vi.setSystemTime(now);
    enqueueDue(now);
    await service.drain();
    expect(getOneShotFollowUpDto(followUp3, ownerId)).toMatchObject({
      status: 'expired',
      displayState: 'expired',
      terminalReason: 'expired',
    });

    // Resetting Personal conversation marks active one-shot follow-ups with terminal_reason='conversation_reset'
    const futureCheck = now + 1_800_000;
    const futureCheckLocal = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(futureCheck).replace(' ', 'T');
    const turn4 = submitUserUtterance('如果评审材料还缺补充就放工作台提醒我', { taskRefId: fixture.task.id });
    const followUp4 = String(parseToolPayload(await tool.execute('create-4', {
      command: 'follow',
      oneShot: true,
      nextCheckLocal: futureCheckLocal,
    })).payload.followUpId);
    completeForegroundTurn(turn4.inputId, turn4.runId);

    await resetPersonalConversation(
      {
        sessionIndexInstance: {
          resetSession: async (cid: string) => {
            getSqliteDatabase().prepare("INSERT INTO transcripts(transcript_id, conversation_id, created_at, cwd) VALUES ('t-reset', ?, ?, '/tmp')").run(cid, now);
            getSqliteDatabase().prepare("UPDATE sessions SET active_transcript_id = 't-reset' WHERE conversation_id = ?").run(cid);
            return { transcriptId: 't-reset', previousTranscriptId: 't-prev' };
          },
        },
      } as never,
      ownerId,
    );
    expect(getOneShotFollowUpDto(followUp4, ownerId)?.terminalReason).toBe('conversation_reset');
  });
});
