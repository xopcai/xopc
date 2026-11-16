import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { ConfigSchema } from '../../../config/schema.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { SessionIndex } from '../../../session/manager.js';
import { type RunGatewayAgentDeps, runGatewayAgent } from '../../service/run-gateway-agent.js';
import { createHonoApp } from '../../hono/app.js';
import type { GatewayService } from '../../service.js';
import { activeReactionEntry, commitAgentReaction, readAgentReactions, reactionCoolingDown } from '../../../storage/sqlite/agent-reaction-repository.js';
import { appendTranscriptEntry, closeXopcDatabase, ensureSessionRecord, getCurrentTranscriptId, openXopcDatabase } from '../../../storage/sqlite/index.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { setSessionConfig } from '../../../storage/sqlite/config-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { AGENT_REACTION_DEADLINE_MS, AgentReactionService, parseReactionDecision, reactionText } from '../reaction.js';

describe('Personal Agent message reaction', () => {
  let dir: string;
  let conversationId: string;
  let transcriptId: string;
  const actorAgentId = personalAgentId('local-owner');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-reactions-'));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('XOPC_WORKSPACE', dir);
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: actorAgentId, profile: { name: 'Ada', style: 'warm' } }, { ready: true });
    conversationId = randomUUID();
    ensureSessionRecord(conversationId, dir, { agentId: actorAgentId, customData: { personalAgent: true } });
    transcriptId = getCurrentTranscriptId(conversationId)!;
  });

  afterEach(() => {
    closeXopcDatabase();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function input(text: string, endpointId = 'web-test') {
    const target = { inputId: randomUUID(), clientMessageId: randomUUID(), runId: randomUUID(), conversationId, transcriptId, actorAgentId };
    insertSessionInput({ id: target.inputId, conversationId, clientMessageId: target.clientMessageId, expectedTranscriptId: transcriptId,
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: text,
      origin: { type: 'endpoint', endpointId } });
    getSqliteDatabase().prepare(`INSERT INTO session_input_receipts
      (conversation_id, client_message_id, principal_id, request_hash, input_id, transcript_id, accepted_at)
      VALUES (?, ?, 'test-principal', 'hash', ?, ?, ?)`).run(conversationId, target.clientMessageId, target.inputId, transcriptId, Date.now());
    return { target, start: () => claimNextSessionInput(conversationId, target.runId), append: () => appendTranscriptEntry(conversationId,
      { role: 'user', content: text, timestamp: Date.now(), turnId: target.runId }) };
  }

  it('accepts one RGI emoji, including skin tone and ZWJ, and rejects malformed output', () => {
    for (const emoji of ['🎉', '👩🏽‍💻', '🌧️', '🇨🇳']) expect(parseReactionDecision(JSON.stringify({ emoji }))).toBe(emoji);
    for (const invalid of ['{"emoji":null}', '{"emoji":"👍👍"}', '{"emoji":"ok"}', '{"emoji":"👩‍"}',
      '{"emoji":"👍","message":"ok"}', '{"emoji":"👍","emoji":"👍"}', '```json\n{"emoji":"👍"}\n```', '{"emoji":12}', '[]']) {
      expect(parseReactionDecision(invalid)).toBeNull();
    }
    expect(reactionText('Hi\n> quoted text\n```ts\nprivate code\n```\nhttps://example.com @xopc-ref:source `inline`')).toBe('Hi');
  });

  it('attaches once to a committed user input and applies the cooldown only to personalized reactions', async () => {
    const first = input('终于上线了！');
    expect(activeReactionEntry(first.target)).toBeUndefined();
    first.start();
    expect(activeReactionEntry(first.target)).toBeUndefined();
    const publish = vi.fn();
    const generator = vi.fn().mockResolvedValue('🎉');
    const waiting = new AgentReactionService(generator).consider({ target: first.target, text: '终于上线了！', started: performance.now(),
      signal: new AbortController().signal, eligible: () => true, publish });
    await vi.waitFor(() => expect(generator).toHaveBeenCalledExactlyOnceWith([{ role: 'user', text: '终于上线了！' }],
      'Ada', 'warm', expect.any(String), expect.any(AbortSignal)));
    expect(publish).not.toHaveBeenCalled();
    first.append();
    const entry = activeReactionEntry(first.target)!;
    await waiting;
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientMessageId: first.target.clientMessageId, entryId: entry.entryId, emoji: '🎉' }));
    expect(readAgentReactions(conversationId, transcriptId, [entry.entryId], 'Ada')).toEqual([publish.mock.calls[0]![0]]);
    expect(commitAgentReaction(first.target, entry.entryId, '🎈', 'Ada')).toBeNull();
    expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS n FROM transcript_entries WHERE transcript_id = ? AND role = 'user'")
      .get(transcriptId)?.n).toBe(1);
    finishSessionInputRun(conversationId, first.target.runId, 'completed');
    const second = input('庆祝一下');
    second.start(); second.append();
    const secondEntry = activeReactionEntry(second.target)!;
    expect(commitAgentReaction(second.target, secondEntry.entryId, '🎉', 'Ada')).toBeNull();
    const fallback = commitAgentReaction(second.target, secondEntry.entryId, '💬', 'Ada');
    expect(fallback?.emoji).toBe('💬');
    expect(commitAgentReaction(second.target, secondEntry.entryId, '💬', 'Ada')).toBeNull();
    getSqliteDatabase().prepare('UPDATE session_agent_reactions SET created_at_ms = ? WHERE entry_id = ?')
      .run(fallback!.createdAtMs - 21_000, entry.entryId);
    expect(reactionCoolingDown(conversationId, fallback!.createdAtMs)).toBe(false);
    resetSessionRecord(conversationId, dir);
    expect(readAgentReactions(conversationId, transcriptId, [entry.entryId], 'Ada')).toEqual([]);
  });

  it('cancels as soon as the main reply arrives and handles providers that ignore abort', async () => {
    const turn = input('We shipped!');
    turn.start(); turn.append();
    const publish = vi.fn();
    const controller = new AbortController();
    const generator = vi.fn().mockImplementation(() => new Promise(() => {}));
    const service = new AgentReactionService(generator);
    const waiting = service.consider({ target: turn.target, text: 'We shipped!', started: performance.now() - 500,
      signal: controller.signal, eligible: () => true, publish });
    await vi.waitFor(() => expect(generator).toHaveBeenCalledOnce());
    controller.abort();
    await waiting;
    expect(generator.mock.calls[0]![4].aborted).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    await service.consider({ target: turn.target, text: 'We shipped!', started: performance.now() - (AGENT_REACTION_DEADLINE_MS - 120),
      signal: new AbortController().signal, eligible: () => true, publish });
    expect(generator).toHaveBeenCalledTimes(2);
    expect(generator.mock.calls[1]![4].aborted).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it('skips generation when the last clause would be truncated', async () => {
    const text = `${'We shipped! '.repeat(100)} But the homepage is broken.`;
    const turn = input(text);
    turn.start(); turn.append();
    const generate = vi.fn();
    const publish = vi.fn();
    await new AgentReactionService(generate).consider({ target: turn.target, text, started: performance.now(),
      signal: new AbortController().signal, eligible: () => true, publish });
    expect(generate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ['personalized', 'web-test'],
    ['personalized', 'desktop-test'],
    ['personalized', 'ios-test'],
    ['personalized', 'android-test'],
    ['personalized', 'harmonyos-test'],
    ['abstain', 'web-test'],
    ['fast', 'web-test'],
    ['timeout', 'web-test'],
  ] as const)('synchronizes a %s reaction through realtime and history (%s)', async (scenario, endpointId) => {
    const past = input('An older message');
    past.start(); past.append();
    finishSessionInputRun(conversationId, past.target.runId, 'completed');
    const turn = input('We shipped!', endpointId);
    turn.start();
    const slow = scenario !== 'fast';
    const expectedEmoji = scenario === 'personalized' ? '🎉' : '💬';
    const auth = { mode: 'token' as const, token: 'reaction-test-token' };
    const useSettings = scenario === 'personalized' && endpointId === 'web-test';
    const config = ConfigSchema.parse({ gateway: { auth }, experimental: { personalAgentMessageReactions: useSettings ? undefined : true } });
    if (useSettings) setSessionConfig(conversationId, { fixedModel: true, modelOverride: 'test/fast' }, dir);
    const sessions = new SessionIndex({ config });
    const publishRealtime = vi.fn();
    const gateway = createHonoApp({ service: { currentConfig: config, getResolvedAuth: () => auth, isGatewayReady: () => true,
      getActiveWebchatRunId: () => turn.target.runId,
      realtime: { broker: { publish: publishRealtime } },
      sessions: { getMessagePage: sessions.getSessionMessagePage.bind(sessions) } } as unknown as GatewayService });
    const server = serve({ fetch: gateway.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      const base = `http://127.0.0.1:${address.port}`;
      const path = `${base}/api/sessions/${conversationId}/history`;
      const headers = { Authorization: `Bearer ${auth.token}` };
      expect((await fetch(path)).status).toBe(401);
      const savePreference = async (enabled: boolean) => {
        const { payload: { revision, displayName, appearance } } = await (await fetch(base + '/api/personal-agent', { headers })).json();
        const response = await fetch(base + '/api/personal-agent/profile', {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision, displayName, appearance, messageReactionsEnabled: enabled }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ payload: { messageReactionsAvailable: true, messageReactionsEnabled: enabled } });
        expect(publishRealtime).toHaveBeenCalledWith('sessions', 'session.agent-reaction.preference', { conversationId, enabled });
      };
      if (useSettings) {
        const initial = await fetch(base + '/api/personal-agent', { headers });
        expect(await initial.json()).toMatchObject({ payload: { messageReactionsAvailable: true, messageReactionsEnabled: false } });
        await savePreference(true);
      }
      let release!: () => void;
      const finish = new Promise<void>(done => { release = done; });
      let decide!: (emoji: string | null) => void;
      const generate = vi.fn(() => new Promise<string | null>(done => { decide = done; }));
      const deps = {
        getConfig: () => config, reactions: new AgentReactionService(generate),
        agentService: { resolveUserTimezoneForSession: () => 'UTC', beginInboundTurn: () => {}, endInboundTurn: () => {},
          turnDispatcher: { processDirectStreaming: async function* () {
            turn.append();
            if (slow) await finish;
            yield { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Congratulations' }] } };
          } }, getLastAssistantPlainText: () => '', takeTaskReviewStreamHint: () => undefined,
          outboundCoordinator: { emitSessionTurnComplete: async () => {} } },
        runAbortControllers: new Map(), activeWebchatRunBySession: new Map(), activeExecutionBySession: new Map(),
        sessionIndex: sessions, emit: () => {}, publishRealtime, completeRealtimeTopic: () => {},
      } as unknown as RunGatewayAgentDeps;
      const run = (async () => {
        const events = [];
        for await (const event of runGatewayAgent(deps, 'We shipped!', 'webchat', conversationId,
          { type: 'endpoint', endpointId }, undefined, undefined,
          { runId: turn.target.runId, inputIdentity: { inputId: turn.target.inputId, clientMessageId: turn.target.clientMessageId } })) events.push(event.type);
        return events;
      })();
      try {
        let beforeEtag: string | null = null;
        if (slow) {
          await vi.waitFor(() => expect(activeReactionEntry(turn.target)).toBeDefined());
          const before = await fetch(path, { headers });
          beforeEtag = before.headers.get('etag');
          const messages = (await before.json()).session.messages;
          expect(messages.find((row: { turnId: string }) => row.turnId === past.target.runId)?.agentReaction?.emoji).toBe('💬');
          expect(messages.find((row: { turnId: string }) => row.turnId === turn.target.runId)).not.toHaveProperty('agentReaction');
          await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
          if (scenario !== 'timeout') decide(scenario === 'abstain' ? null : '🎉');
        } else {
          expect(await run).toContain('assistant_delta');
          expect(generate).not.toHaveBeenCalled();
          const events = publishRealtime.mock.calls.map(([, event]) => event);
          expect(events).toContain('session.agent-reaction');
          expect(events.indexOf('session.agent-reaction')).toBeGreaterThan(events.indexOf('assistant_delta'));
        }
        await vi.waitFor(() => expect(publishRealtime).toHaveBeenCalledWith('sessions', 'session.agent-reaction',
          expect.objectContaining({ conversationId, transcriptId, clientMessageId: turn.target.clientMessageId, emoji: expectedEmoji })),
        { timeout: AGENT_REACTION_DEADLINE_MS + 800 });
        const full = await fetch(path, { headers: { ...headers, ...(beforeEtag ? { 'If-None-Match': beforeEtag } : {}) } });
        const compact = await fetch(path + '?view=compact', { headers });
        expect(full.status).toBe(200);
        const isCurrentUser = (row: { role: string; turnId: string }) => row.role === 'user' && row.turnId === turn.target.runId;
        const fullMessage = (await full.json()).session.messages.find(isCurrentUser);
        const compactMessage = (await compact.json()).session.messages.find(isCurrentUser);
        expect(fullMessage.agentReaction).toMatchObject({ emoji: expectedEmoji, entryId: fullMessage.transcriptEntryId });
        expect(compactMessage.agentReaction).toEqual(fullMessage.agentReaction);
      } finally { decide?.(null); release(); await run; }
      if (useSettings) {
        await savePreference(false);
        const disabled = (await (await fetch(path, { headers })).json()).session;
        expect(disabled.agentReactions).toEqual({ available: true, enabled: false });
        expect(disabled.messages.every((row: { agentReaction?: unknown }) => !row.agentReaction)).toBe(true);
        await savePreference(true);
        const enabled = (await (await fetch(path, { headers })).json()).session;
        expect(enabled.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({ agentReaction: expect.objectContaining({ emoji: '🎉' }) }),
        ]));
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
});
