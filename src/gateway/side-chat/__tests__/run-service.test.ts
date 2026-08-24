import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentService } from '../../../agent/service.js';
import type { GatewayAgentRunner } from '../../service/agent-runner.js';
import type { SessionMetadata } from '../../../session/types.js';
import { EphemeralSideChatManager } from '../manager.js';
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

async function setup(runEphemeralTurn: AgentService['runEphemeralTurn']) {
  const manager = new EphemeralSideChatManager({
    getParentMetadata: async () => parentMetadata(),
    loadParentMessages: async () => [{ role: 'user', content: 'parent', timestamp: 1 }] as AgentMessage[],
    getDefaultModelRef: () => 'openai/test',
    getWorkspacePath: () => '/tmp',
    startSweepTimer: false,
  });
  const published: Array<{ topic: string; event: string; data: unknown }> = [];
  const completed: string[] = [];
  const agentRunner = {
    registerExternalWebchatRun: vi.fn(),
    unregisterExternalWebchatRun: vi.fn(),
    cancelClarificationForRun: vi.fn(),
    submitClarifyResponse: vi.fn(() => true),
  } as unknown as GatewayAgentRunner;
  const service = new SideChatRunService({
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
    const { runId } = ctx.service.submit(ctx.sideChat.id, 'tab-1', 'question');

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
    ctx.service.submit(ctx.sideChat.id, 'tab-1', 'first');
    expect(() => ctx.service.submit(ctx.sideChat.id, 'tab-1', 'second')).toThrow('already active');
    finish();
    await vi.waitFor(() => expect(ctx.manager.get(ctx.sideChat.id, 'tab-1').status).toBe('idle'));
    await ctx.manager.disposeAll();
  });
});
