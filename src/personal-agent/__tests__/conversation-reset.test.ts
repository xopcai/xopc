import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { performSessionReset } from '../../gateway/session-reset-service.js';
import { SessionIndex } from '../../session/manager.js';
import { getSessionConfig, setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry, loadLlmMessagesForSession } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { applyUserProfilePatch, getUserProfileSnapshot } from '../../user-model/profile.js';
import { getPersonalAgent, isPersonalConversation, personalAgentId, personalConversationId } from '../repository.js';
import { isPersonalSchedule, personalScheduleInput } from '../schedules.js';
import { markPersonalRead, personalUnreadSnapshot } from '../unread.js';

vi.mock('../../agent/embedded/runs.js', () => ({
  abortEmbeddedRun: vi.fn().mockResolvedValue(false),
}));

describe('POST /api/personal-agent/conversation/reset', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
    vi.unstubAllEnvs();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  async function setup(options?: { voiceCallActive?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-reset-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });

    const token = 'personal-reset-test-token';
    const config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
    const sessionIndex = new SessionIndex({ config });
    await sessionIndex.initialize();
    const automationService = new AutomationService();
    const evictSessionAgent = vi.fn();
    const cancelConfigurationSetups = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();

    const agentId = personalAgentId('local-owner');
    const conversationId = personalConversationId('local-owner');
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: agentId, profile: { name: 'Ada', emoji: '◉' }, runtime: { thinkingLevel: 'off' } }, { ready: true });
    createConversation({
      agentId,
      sourceChannel: 'webchat',
      name: 'Ada',
      hiddenFromSessionList: true,
      customData: { personalAgent: true, keepHiddenFromSessionList: true },
    }, dir, conversationId);
    setSessionConfig(conversationId, { modelOverride: 'test/fast', fixedModel: true, thinkingLevel: 'off' }, dir);

    const app = createHonoApp({
      service: {
        currentConfig: config,
        getResolvedAuth: () => ({ mode: 'token', token }),
        getAuthToken: () => token,
        isGatewayReady: () => true,
        getExtensionLoader: () => null,
        refreshAgentCatalog: vi.fn(),
        agentService: { evictSessionAgent, cancelConfigurationSetups },
        automationServiceInstance: automationService,
        sessionIndexInstance: sessionIndex,
        voiceRealtime: { hasConversation: (id: string) => Boolean(options?.voiceCallActive && id === conversationId) },
        emit,
      } as unknown as GatewayService,
    });

    return {
      dir,
      app,
      sessionIndex,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      agentId,
      conversationId,
      automationService,
      evictSessionAgent,
      cancelConfigurationSetups,
      emit,
    };
  }

  it('archives the active transcript, starts a fresh one on the same conversationId, and preserves settings/schedules/memory', async () => {
    const ctx = await setup();
    const initial = getPersonalAgent('local-owner')!;
    expect(initial.state).toBe('ready');
    const previousTranscriptId = initial.transcriptId!;
    expect(previousTranscriptId).toBeTruthy();

    applyUserProfilePatch({ callName: 'Joyce' });
    const schedule = await ctx.automationService.create(personalScheduleInput(initial, {
      name: 'Morning brief',
      instruction: 'Summarize my calendar',
      locale: 'en',
      schedule: { kind: 'interval', everyMs: 3_600_000 },
    }));

    appendTranscriptEntry(ctx.conversationId, { role: 'user', content: 'Hello Ada' });
    appendTranscriptEntry(ctx.conversationId, { role: 'assistant', content: [{ type: 'text', text: 'Hi Joyce!' }] });
    const beforeUnread = personalUnreadSnapshot(ctx.conversationId)!;
    expect(beforeUnread.unreadCount).toBe(1);
    markPersonalRead(ctx.conversationId, beforeUnread.transcriptId, beforeUnread.lastSeq);

    const db = getSqliteDatabase();
    const now = Date.now();
    db.prepare(`INSERT INTO personal_attention_threads
      (id, owner_id, agent_id, conversation_id, subject, summary, kind, status, authority, expires_at, last_meaningful_at, created_at, updated_at)
      VALUES ('thread-1', 'local-owner', ?, ?, 'Topic', 'Summary', 'discussion', 'active', 'user_explicit', ?, ?, ?, ?)`)
      .run(ctx.agentId, ctx.conversationId, now + 86_400_000, now, now, now);
    db.prepare(`INSERT INTO personal_wakeups
      (id, thread_id, dedupe_key, trigger_kind, thread_revision, not_before, expires_at, status, created_at)
      VALUES ('wakeup-1', 'thread-1', 'dedupe-1', 'due', 1, ?, ?, 'pending', ?)`)
      .run(now, now + 86_400_000, now);
    db.prepare(`INSERT INTO personal_outreach
      (id, wakeup_id, thread_id, conversation_id, origin_transcript_id, thread_revision, context_revision, policy_revision, decision, reason, state, text, provenance_json, valid_until, created_at)
      VALUES ('outreach-1', 'wakeup-1', 'thread-1', ?, ?, 1, 0, 1, 'contact', 'reason', 'ready', 'draft', '{}', ?, ?)`)
      .run(ctx.conversationId, previousTranscriptId, now + 86_400_000, now);

    // Generic session reset continues to block Personal conversations.
    const genericBlocked = await performSessionReset(ctx.conversationId, {
      sessionIndex: ctx.sessionIndex,
      getAgentService: () => ({ evictSessionAgent: ctx.evictSessionAgent }) as never,
      cancelConfigurationSetups: ctx.cancelConfigurationSetups,
    });
    expect(genericBlocked).toEqual({ ok: false, error: 'Personal AI conversation cannot be reset' });

    // Unauthenticated call is rejected.
    const unauth = await ctx.app.request('/api/personal-agent/conversation/reset', { method: 'POST' });
    expect(unauth.status).toBe(401);

    // Stale expectedTranscriptId is rejected with 409.
    const conflict = await ctx.app.request('/api/personal-agent/conversation/reset', {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ expectedTranscriptId: 'stale-transcript-id' }),
    });
    expect(conflict.status).toBe(409);

    // Valid reset archives old transcript and allocates a fresh one.
    const response = await ctx.app.request('/api/personal-agent/conversation/reset', {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ expectedTranscriptId: previousTranscriptId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      ok: boolean;
      payload: {
        conversationId: string;
        transcriptId: string;
        previousTranscriptId: string;
        profile: { conversationId: string; transcriptId: string; state: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.conversationId).toBe(ctx.conversationId);
    expect(body.payload.previousTranscriptId).toBe(previousTranscriptId);
    expect(body.payload.transcriptId).not.toBe(previousTranscriptId);
    expect(body.payload.profile).toMatchObject({
      conversationId: ctx.conversationId,
      transcriptId: body.payload.transcriptId,
      state: 'ready',
    });

    // Old transcript is archived, new transcript is active and empty.
    const oldTranscript = db.prepare('SELECT status, archive_reason FROM transcripts WHERE transcript_id = ?')
      .get(previousTranscriptId) as { status: string; archive_reason: string };
    expect(oldTranscript).toEqual({ status: 'archived', archive_reason: 'reset' });
    expect(loadLlmMessagesForSession(ctx.conversationId)).toEqual([]);

    // Same personal conversation identity, visibility, config, memory, and schedule remain intact.
    const updated = getPersonalAgent('local-owner')!;
    expect(updated.state).toBe('ready');
    expect(updated.conversationId).toBe(ctx.conversationId);
    expect(updated.transcriptId).toBe(body.payload.transcriptId);
    expect(isPersonalConversation(ctx.conversationId)).toBe(true);
    expect(getSessionMetadata(ctx.conversationId)).toMatchObject({
      hiddenFromSessionList: true,
      customData: expect.objectContaining({ personalAgent: true, keepHiddenFromSessionList: true }),
    });
    expect(getSessionMetadata(ctx.conversationId)?.customData?.personalRead).toBeUndefined();
    expect(getSessionConfig(ctx.conversationId)).toMatchObject({
      modelOverride: 'test/fast',
      fixedModel: true,
      thinkingLevel: 'off',
    });
    expect(getUserProfileSnapshot().callName).toBe('Joyce');
    expect(isPersonalSchedule(await ctx.automationService.get(schedule.id), updated.conversationId, updated.agentId)).toBe(true);

    // Unread snapshot and proactivity queues are cleanly settled.
    expect(personalUnreadSnapshot(ctx.conversationId)).toEqual({
      conversationId: ctx.conversationId,
      transcriptId: body.payload.transcriptId,
      lastSeq: 0,
      unreadCount: 0,
    });
    expect(db.prepare('SELECT status FROM personal_attention_threads WHERE id = ?').get('thread-1')).toEqual({ status: 'expired' });
    expect(db.prepare('SELECT status FROM personal_wakeups WHERE id = ?').get('wakeup-1')).toEqual({ status: 'cancelled' });
    expect(db.prepare('SELECT state, text FROM personal_outreach WHERE id = ?').get('outreach-1')).toEqual({ state: 'stale', text: null });

    expect(ctx.cancelConfigurationSetups).toHaveBeenCalledWith(ctx.conversationId);
    expect(ctx.evictSessionAgent).toHaveBeenCalledWith(ctx.conversationId);
    expect(ctx.emit).toHaveBeenCalledWith('session.transcript_updated', { key: ctx.conversationId });
    expect(ctx.emit).toHaveBeenCalledWith('personal.unread.updated', { conversationId: ctx.conversationId });
  });

  it('rejects reset while a voice call is active on the Personal conversation', async () => {
    const ctx = await setup({ voiceCallActive: true });
    const initial = getPersonalAgent('local-owner')!;

    const response = await ctx.app.request('/api/personal-agent/conversation/reset', {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(getPersonalAgent('local-owner')?.transcriptId).toBe(initial.transcriptId);
  });
});
