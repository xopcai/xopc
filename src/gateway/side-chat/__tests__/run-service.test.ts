import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentService } from '../../../agent/service.js';
import type { GatewayAgentRunner } from '../../service/agent-runner.js';
import type { SessionMetadata } from '../../../session/types.js';
import { EphemeralSideChatManager, type EphemeralSideChatManagerOptions } from '../manager.js';
import { SideChatRunService } from '../run-service.js';

const parentSessionKey = 'main:webchat:default:direct:parent';

function parentMetadata(): SessionMetadata {
  return {
    key: parentSessionKey,
    status: 'active' as SessionMetadata['status'],
    tags: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastAccessedAt: new Date(0).toISOString(),
    messageCount: 1,
    estimatedTokens: 1,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: 'parent',
    sessionType: 'chat',
    sessionId: 'parent-id',
    cwd: '/tmp',
  };
}

async function setup(runEphemeralTurn: AgentService['runEphemeralTurn'], options: Partial<EphemeralSideChatManagerOptions> = {}) {
  let service: SideChatRunService;
  const manager = new EphemeralSideChatManager({
    getParentMetadata: async () => parentMetadata(),
    loadParentMessages: async () => [{ role: 'user', content: 'parent', timestamp: 1 }] as AgentMessage[],
    getDefaultModelRef: () => 'openai/test',
    getWorkspacePath: () => '/tmp',
    startSweepTimer: false,
    onBeforeDispose: (id, client) => service.cancelRun(id, client).then(() => undefined),
    ...options,
  });
  const published: Array<{ topic: string; event: string; data: unknown }> = [];
  const completed: string[] = [];
  const agentRunner = {
    registerExternalWebchatRun: vi.fn(),
    unregisterExternalWebchatRun: vi.fn(),
    cancelClarificationForRun: vi.fn(),
    answerEphemeralClarification: vi.fn(() => true),
  } as unknown as GatewayAgentRunner;
  service = new SideChatRunService({
    manager,
    getAgentService: () => ({ runEphemeralTurn } as unknown as AgentService),
    agentRunner,
    publishRealtime: (topic, event, data) => published.push({ topic, event, data }),
    completeRealtimeTopic: (topic) => completed.push(topic),
  });
  const sideChat = await manager.create({ parentSessionKey, clientInstanceId: 'tab-1' });
  return { manager, service, sideChat, published, completed, agentRunner };
}

describe('SideChatRunService', () => {
  it('streams a full ephemeral turn through the standard chat event protocol', async () => {
    const runEphemeralTurn = vi.fn<AgentService['runEphemeralTurn']>(async (params) => {
      params.onEvent?.({ type: 'message_start', message: { role: 'assistant', content: [], timestamp: 2 } });
      params.onEvent?.({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }], timestamp: 2 },
        assistantMessageEvent: { type: 'text_delta', delta: 'answer' } as never,
      });
      params.onEvent?.({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }], timestamp: 2 } });
      return { ok: true, lastAssistantText: 'answer' };
    });
    const ctx = await setup(runEphemeralTurn);
    const { runId } = ctx.service.submit(ctx.sideChat.id, 'tab-1', { content: 'question' });

    await vi.waitFor(() => expect(ctx.completed).toContain(`run:${runId}`));
    expect(ctx.published.map((item) => item.event)).toEqual(expect.arrayContaining([
      'run_start', 'user_message', 'assistant_message_start', 'assistant_delta', 'assistant_message_end', 'run_end',
    ]));
    expect(runEphemeralTurn).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey,
      executionSessionKey: expect.stringContaining(`side-chat:${ctx.sideChat.id}`),
      transcriptRuntime: expect.objectContaining({ persistent: false }),
    }));
    expect(ctx.manager.get(ctx.sideChat.id, 'tab-1').status).toBe('idle');
    await ctx.manager.disposeAll();
  });

  it('rejects concurrent turns in the same side chat', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const ctx = await setup(async () => {
      await gate;
      return { ok: true };
    });
    ctx.service.submit(ctx.sideChat.id, 'tab-1', { content: 'first' });
    expect(() => ctx.service.submit(ctx.sideChat.id, 'tab-1', { content: 'second' })).toThrow('already active');
    finish();
    await vi.waitFor(() => expect(ctx.manager.get(ctx.sideChat.id, 'tab-1').status).toBe('idle'));
    await ctx.manager.disposeAll();
  });

  it('accepts an attachment-only turn and omits inline data from realtime', async () => {
    const runEphemeralTurn = vi.fn<AgentService['runEphemeralTurn']>(async () => ({ ok: true }));
    const ctx = await setup(runEphemeralTurn);
    const attachment = {
      type: 'file',
      mimeType: 'text/plain',
      name: 'notes.txt',
      size: 5,
      data: 'aGVsbG8=',
    };

    const { runId } = ctx.service.submit(ctx.sideChat.id, 'tab-1', {
      content: '',
      attachments: [attachment],
    });

    await vi.waitFor(() => expect(ctx.completed).toContain(`run:${runId}`));
    expect(runEphemeralTurn).toHaveBeenCalledWith(expect.objectContaining({ attachments: [attachment] }));
    const userEvent = ctx.published.find((item) => item.event === 'user_message');
    expect(userEvent?.data).toMatchObject({ payload: { message: { attachments: [{ name: 'notes.txt' }] } } });
    expect(JSON.stringify(userEvent?.data)).not.toContain('aGVsbG8=');
    await ctx.manager.disposeAll();
  });
  it.each([undefined, 'approval'] as const)('restores %s waiting details and cancels the active run when waiting expires', async (kind) => {
    let now = 0;
    const ctx = await setup(async (params) => {
      params.onEvent?.({ type: 'clarify_request', kind, requestId: 'q1', question: 'Which one?', choices: ['A', 'B'] });
      await new Promise<void>((resolve) => params.abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
      return { ok: false, errorMessage: 'cancelled' };
    }, { now: () => now, idleTtlMs: 1000 });
    const { runId } = ctx.service.submit(ctx.sideChat.id, 'tab-1', { content: 'question' });
    expect(ctx.manager.get(ctx.sideChat.id, 'tab-1')).toMatchObject({ status: kind === 'approval' ? 'waiting-approval' : 'waiting-input', runId, clarification: { requestId: 'q1', question: 'Which one?' } });
    expect(ctx.agentRunner.registerExternalWebchatRun).toHaveBeenCalledWith(expect.any(String), runId, expect.any(Function), expect.objectContaining({ beforeClarificationResponse: expect.any(Function) }));
    expect(ctx.service.submitClarification(ctx.sideChat.id, 'tab-1', 'foreign-question', 'A')).toBe(false);
    expect(ctx.agentRunner.answerEphemeralClarification).not.toHaveBeenCalled();
    now = 1000;
    await ctx.manager.sweepExpired();
    expect(ctx.agentRunner.cancelClarificationForRun).toHaveBeenCalledWith(runId);
    await vi.waitFor(() => expect(ctx.completed).toContain(`run:${runId}`));
    expect(() => ctx.service.submitClarification(ctx.sideChat.id, 'tab-1', 'q1', 'A')).toThrow(expect.objectContaining({ code: 'EXPIRED' }));
    await ctx.manager.disposeAll();
  });

  it('suspends the idle timer when a valid clarification response resumes the run', async () => {
    let now = 0;
    let finish!: () => void;
    const ctx = await setup(async (params) => {
      params.onEvent?.({ type: 'clarify_request', requestId: 'q1', question: 'Continue?' });
      await new Promise<void>((resolve) => { finish = resolve; });
      return { ok: true };
    }, { now: () => now, idleTtlMs: 1000 });
    ctx.service.submit(ctx.sideChat.id, 'tab-1', { content: 'question' });
    now = 500;
    expect(ctx.service.submitClarification(ctx.sideChat.id, 'tab-1', 'q1', 'yes')).toBe(true);
    expect(ctx.manager.get(ctx.sideChat.id, 'tab-1')).toMatchObject({ status: 'running', expiresAt: null });
    now = 50_000;
    await expect(ctx.manager.sweepExpired()).resolves.toBe(0);
    finish();
    await vi.waitFor(() => expect(ctx.manager.get(ctx.sideChat.id, 'tab-1').status).toBe('idle'));
    expect(ctx.manager.get(ctx.sideChat.id, 'tab-1').expiresAt).toBe(new Date(51_000).toISOString());
    await ctx.manager.disposeAll();
  });

});
