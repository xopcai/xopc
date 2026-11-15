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
import { activeReactionEntry, commitAgentReaction, readAgentReactions } from '../../../storage/sqlite/agent-reaction-repository.js';
import { appendTranscriptEntry, closeXopcDatabase, ensureSessionRecord, getCurrentTranscriptId, openXopcDatabase } from '../../../storage/sqlite/index.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { AGENT_REACTION_DEADLINE_MS, AgentReactionService, parseReactionDecision, reactionText } from '../reaction.js';

describe('Personal Agent message reaction', () => {
  let dir: string;
  let conversationId: string;
  let transcriptId: string;
  const actorAgentId = personalAgentId('local-owner');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-reactions-'));
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
    rmSync(dir, { recursive: true, force: true });
  });

  function input(text: string) {
    const target = { inputId: randomUUID(), clientMessageId: randomUUID(), runId: randomUUID(), conversationId, transcriptId, actorAgentId };
    insertSessionInput({ id: target.inputId, conversationId, clientMessageId: target.clientMessageId, expectedTranscriptId: transcriptId,
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: text,
      origin: { type: 'endpoint', endpointId: 'mobile-test' } });
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

  it('only attaches to a started and committed user input, persists once, and honours the conversation cooldown', async () => {
    const first = input('终于上线了！');
    expect(activeReactionEntry(first.target)).toBeUndefined();
    first.start();
    expect(activeReactionEntry(first.target)).toBeUndefined();
    first.append();
    const entry = activeReactionEntry(first.target)!;
    const publish = vi.fn();
    const generator = vi.fn().mockResolvedValue('🎉');
    await new AgentReactionService(generator).consider({ target: first.target, text: '终于上线了！', started: performance.now() - 460,
      signal: new AbortController().signal, eligible: () => true, publish });
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientMessageId: first.target.clientMessageId, entryId: entry.entryId, emoji: '🎉' }));
    expect(readAgentReactions(conversationId, transcriptId, [entry.entryId], 'Ada')).toEqual([publish.mock.calls[0]![0]]);
    expect(commitAgentReaction(first.target, entry.entryId, '🎈', 'Ada')).toBeNull();
    expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS n FROM transcript_entries WHERE transcript_id = ? AND role = 'user'")
      .get(transcriptId)?.n).toBe(1);
    finishSessionInputRun(conversationId, first.target.runId, 'completed');
    const second = input('庆祝一下');
    second.start(); second.append();
    expect(commitAgentReaction(second.target, activeReactionEntry(second.target)!.entryId, '🎉', 'Ada')).toBeNull();
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

  it.each([true, false])('synchronizes the matching message only when main text is slow (%s)', async slow => {
    const turn = input('We shipped!');
    turn.start();
    const auth = { mode: 'token' as const, token: 'reaction-test-token' };
    const config = ConfigSchema.parse({ gateway: { auth }, experimental: { personalAgentMessageReactions: true } });
    const sessions = new SessionIndex({ config });
    const gateway = createHonoApp({ service: { currentConfig: config, getResolvedAuth: () => auth, isGatewayReady: () => true,
      sessions: { getMessagePage: sessions.getSessionMessagePage.bind(sessions) } } as unknown as GatewayService });
    const server = serve({ fetch: gateway.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      const path = `http://127.0.0.1:${address.port}/api/sessions/${conversationId}/history`;
      const headers = { Authorization: `Bearer ${auth.token}` };
      expect((await fetch(path)).status).toBe(401);
      let release!: () => void;
      const finish = new Promise<void>(done => { release = done; });
      const generate = vi.fn().mockResolvedValue('🎉');
      const deps = {
        config, reactions: new AgentReactionService(generate), canReact: () => true,
        agentService: { resolveUserTimezoneForSession: () => 'UTC', beginInboundTurn: () => {}, endInboundTurn: () => {},
          turnDispatcher: { processDirectStreaming: async function* () {
            turn.append();
            if (slow) await finish;
            yield { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Congratulations' }] } };
          } }, getLastAssistantPlainText: () => '', takeTaskReviewStreamHint: () => undefined,
          outboundCoordinator: { emitSessionTurnComplete: async () => {} } },
        runAbortControllers: new Map(), activeWebchatRunBySession: new Map(), activeExecutionBySession: new Map(),
        sessionIndex: sessions, emit: () => {}, publishRealtime: vi.fn(), completeRealtimeTopic: () => {},
      } as unknown as RunGatewayAgentDeps;
      const run = (async () => {
        const events = [];
        for await (const event of runGatewayAgent(deps, 'We shipped!', 'webchat', conversationId,
          { type: 'endpoint', endpointId: 'mobile-test' }, undefined, undefined,
          { runId: turn.target.runId, inputIdentity: { inputId: turn.target.inputId, clientMessageId: turn.target.clientMessageId } })) events.push(event.type);
        return events;
      })();
      try {
        if (!slow) {
          expect(await run).toContain('assistant_delta');
          expect(generate).not.toHaveBeenCalled();
          const reply = await fetch(path, { headers });
          expect((await reply.json()).session.messages[0]).not.toHaveProperty('agentReaction');
          return;
        }
        await vi.waitFor(() => expect(activeReactionEntry(turn.target)).toBeDefined());
        const before = await fetch(path, { headers });
        expect((await before.json()).session.messages[0]).not.toHaveProperty('agentReaction');
        await vi.waitFor(() => expect(deps.publishRealtime).toHaveBeenCalledWith('sessions', 'session.agent-reaction',
          expect.objectContaining({ conversationId, transcriptId, clientMessageId: turn.target.clientMessageId, emoji: '🎉' })), { timeout: 1500 });
        const full = await fetch(path, { headers: { ...headers, 'If-None-Match': before.headers.get('etag')! } });
        const compact = await fetch(path + '?view=compact', { headers });
        expect(full.status).toBe(200);
        const fullMessage = (await full.json()).session.messages[0];
        const compactMessage = (await compact.json()).session.messages[0];
        expect(fullMessage.agentReaction).toMatchObject({ emoji: '🎉', entryId: fullMessage.transcriptEntryId });
        expect(compactMessage.agentReaction).toEqual(fullMessage.agentReaction);
      } finally { release(); await run; }
    } finally {
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
});
