import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentService } from '../../../agent/service.js';
import type { SessionIndex } from '../../../session/manager.js';
import type { SessionMetadata } from '../../../session/types.js';
import { EphemeralSideChatManager } from '../manager.js';
import { SideChatPromotionService } from '../promotion-service.js';

const parentId = '1d2f9d43-35ef-4f84-b80e-64d0701c1aec';

function parentMetadata(): SessionMetadata {
  return {
    key: parentId,
    agentId: 'main',
    status: 'active' as SessionMetadata['status'],
    tags: ['project'],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastAccessedAt: new Date(0).toISOString(),
    messageCount: 1,
    estimatedTokens: 1,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: 'parent',
    sessionType: 'chat',
    transcriptId: 'parent-transcript',
    cwd: '/tmp/side-chat-test',
  };
}

async function setup(createSessionFromRows = vi.fn()) {
  const manager = new EphemeralSideChatManager({
    startSweepTimer: false,
    getParentMetadata: async () => parentMetadata(),
    getParentConfig: async () => ({ responseLanguage: 'zh', modelOverride: 'old/model' }),
    loadParentMessages: async () => [{ role: 'user', content: 'parent context' } as AgentMessage],
    getDefaultModelRef: () => 'test/model',
    getDefaultThinkingLevel: () => 'high',
    getWorkspacePath: () => '/tmp/side-chat-test',
  });
  const sideChat = await manager.create({ parentConversationId: parentId, clientInstanceId: 'owner' });
  manager.getRuntime(sideChat.id, 'owner').openSessionManager('/tmp').appendMessage({
    role: 'user', content: 'save this discussion', timestamp: 1,
  } as AgentMessage);
  manager.getRuntime(sideChat.id, 'owner').openSessionManager('/tmp').appendMessage({
    role: 'assistant', content: 'saved answer', timestamp: 2,
  } as AgentMessage);

  let persisted: SessionMetadata | null = null;
  createSessionFromRows.mockImplementation(async (options) => {
    persisted = { ...parentMetadata(), ...options.metadata, key: options.targetKey, transcriptId: 'saved-transcript' };
    return { conversationId: options.targetKey, rowCount: options.rows.length };
  });
  const getSessionMetadata = vi.fn(async (id: string) => id === persisted?.key ? persisted : null);
  const enqueueProvisionalSessionTitle = vi.fn();
  const service = new SideChatPromotionService({
    manager,
    sessionIndex: { getSessionMetadata, createSessionFromRows } as unknown as SessionIndex,
    getAgentService: () => ({ enqueueProvisionalSessionTitle } as unknown as AgentService),
  });
  return { manager, sideChat, service, createSessionFromRows, enqueueProvisionalSessionTitle };
}

describe('SideChatPromotionService', () => {
  it('persists hidden origin context and visible side-chat rows exactly once', async () => {
    const ctx = await setup();

    const first = await ctx.service.promote(ctx.sideChat.id, 'owner');
    const second = await ctx.service.promote(ctx.sideChat.id, 'owner');

    expect(first).toMatchObject({ conversationId: ctx.sideChat.id, created: true });
    expect(second).toMatchObject({ conversationId: ctx.sideChat.id, created: false });
    expect(ctx.createSessionFromRows).toHaveBeenCalledOnce();
    const options = ctx.createSessionFromRows.mock.calls[0]![0];
    expect(options).toMatchObject({
      targetKey: ctx.sideChat.id,
      config: { responseLanguage: 'zh', modelOverride: 'test/model', thinkingLevel: 'high' },
      metadata: {
        agentId: 'main',
        sourceChannel: 'webchat',
        sessionType: 'chat',
        parentConversationId: parentId,
      },
    });
    expect(options.rows[0]).toMatchObject({
      type: 'side_chat_origin',
      parentConversationId: parentId,
      parentTranscriptId: 'parent-transcript',
    });
    expect(JSON.stringify(options.rows[0])).toContain('parent context');
    expect(options.rows.slice(1).map((row: AgentMessage) => row.role)).toEqual(['user', 'assistant']);
    expect(ctx.enqueueProvisionalSessionTitle).toHaveBeenCalledWith(ctx.sideChat.id, 'save this discussion');
    expect(() => ctx.manager.get(ctx.sideChat.id, 'owner')).toThrow();
  });

  it('returns the side chat to idle when persistence fails', async () => {
    const create = vi.fn();
    const ctx = await setup(create);
    create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(ctx.service.promote(ctx.sideChat.id, 'owner')).rejects.toThrow('database unavailable');

    expect(ctx.manager.get(ctx.sideChat.id, 'owner').status).toBe('idle');
    await ctx.manager.disposeAll();
  });
});
