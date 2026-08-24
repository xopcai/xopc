import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { EphemeralSideChatManager, SideChatError } from '../manager.js';
import type { SessionMetadata } from '../../../session/types.js';

function metadata(): SessionMetadata {
  return {
    key: 'agent:main:webchat:default:direct:parent',
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
    sessionId: 'parent-session-id',
    cwd: '/tmp/side-chat-test',
  };
}

function createManager(params: { now?: () => number; maxPerClient?: number; messages?: AgentMessage[] } = {}) {
  const messages = params.messages ?? [{ role: 'user', content: 'parent message', timestamp: 1 }];
  return new EphemeralSideChatManager({
    getParentMetadata: async (key) => key === metadata().key ? metadata() : null,
    loadParentMessages: async () => messages,
    getDefaultModelRef: () => 'openai/test-model',
    getWorkspacePath: (session) => session.cwd || '/tmp',
    now: params.now,
    maxPerClient: params.maxPerClient,
    idleTtlMs: 1_000,
    startSweepTimer: false,
  });
}

describe('EphemeralSideChatManager', () => {
  it('forks an immutable parent snapshot into an in-memory transcript', async () => {
    const parentMessages: AgentMessage[] = [{ role: 'user', content: 'original', timestamp: 1 }];
    const manager = createManager({ messages: parentMessages });
    const sideChat = await manager.create({
      parentSessionKey: metadata().key,
      clientInstanceId: 'tab-1',
      selections: [{ id: 'selection-1', type: 'text', text: 'selected text' }],
    });

    parentMessages[0] = { role: 'user', content: 'mutated', timestamp: 2 };
    const runtimeMessages = await manager.getRuntime(sideChat.id, 'tab-1').loadMessages();

    expect(sideChat.context.parentSessionId).toBe('parent-session-id');
    expect(sideChat.context.parentMessageCount).toBe(1);
    expect(sideChat.context.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(runtimeMessages)).toContain('original');
    expect(JSON.stringify(runtimeMessages)).toContain('selected text');
    expect(JSON.stringify(runtimeMessages)).not.toContain('mutated');
    expect(manager.getMessages(sideChat.id, 'tab-1')).toEqual([]);
    await manager.disposeAll();
  });

  it('isolates side chats by client and enforces the per-client limit', async () => {
    const manager = createManager({ maxPerClient: 1 });
    const sideChat = await manager.create({ parentSessionKey: metadata().key, clientInstanceId: 'tab-1' });

    expect(() => manager.get(sideChat.id, 'tab-2')).toThrowError(SideChatError);
    await expect(manager.create({ parentSessionKey: metadata().key, clientInstanceId: 'tab-1' }))
      .rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    await expect(manager.create({ parentSessionKey: metadata().key, clientInstanceId: 'tab-2' }))
      .resolves.toMatchObject({ clientInstanceId: 'tab-2' });
    await manager.disposeAll();
  });

  it('refreshes the lease on heartbeat and removes expired side chats', async () => {
    let now = 1_000;
    const manager = createManager({ now: () => now });
    const sideChat = await manager.create({ parentSessionKey: metadata().key, clientInstanceId: 'tab-1' });

    now = 1_500;
    const refreshed = manager.heartbeat(sideChat.id, 'tab-1');
    expect(Date.parse(refreshed.expiresAt)).toBe(2_500);
    now = 2_499;
    await expect(manager.sweepExpired()).resolves.toBe(0);
    now = 2_500;
    await expect(manager.sweepExpired()).resolves.toBe(1);
    expect(() => manager.get(sideChat.id, 'tab-1')).toThrowError(SideChatError);
  });

  it('rejects missing parents and oversized or malformed selections', async () => {
    const manager = createManager();
    await expect(manager.create({ parentSessionKey: 'missing', clientInstanceId: 'tab-1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(manager.create({
      parentSessionKey: metadata().key,
      clientInstanceId: 'tab-1',
      selections: [{ id: 'bad', type: 'file-range', path: 'a.ts', startLine: 2, endLine: 1, text: 'x' }],
    })).rejects.toThrow('endLine must be >= startLine');
    await manager.disposeAll();
  });
});
