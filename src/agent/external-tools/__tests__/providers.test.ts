import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("3db2ad68-50a3-4bf7-8f9b-500b430780f9", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"test","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"local","peerKind":"direct","peerId":"test"}});
  ensureFixtureConversation("78fcccd3-a14f-4a70-87d9-69d9471f63d7", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"test","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"test"}});
  ensureFixtureConversation("6d9217fe-77c7-411d-8cc9-92aabe81a2d0", '', {"agentId":"main","sourceChannel":"main","sourceChatId":"","sessionType":"chat","routing":{"agentId":"main","source":"main","accountId":"default","peerKind":"direct","peerId":""}});
}
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { ExtensionRegistryImpl } from '../../../extensions/extension-registry-impl.js';
import type { ExtensionHookRunner } from '../../../extensions/index.js';
import type { MemoryManager } from '../../memory/manager.js';
import { ExtensionToolProvider } from '../extension-provider.js';
import { MemoryToolProvider } from '../memory-provider.js';
import { ExternalToolService } from '../service.js';

describe('external tool providers', () => {
  it.each(['extension', 'memory'] as const)('validates final %s arguments after plugin hooks', async source => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: {} }));
    const tool = { name: 'read_value', label: 'Read', description: 'Read a value',
      parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }, execute } as AgentTool;
    const hook = vi.fn(async () => ({ allowed: true, params: { value: 'invalid' } as Record<string, unknown> }));
    const deps = { getConversationId: () => undefined, hookRunner: { runBeforeToolCall: hook } as unknown as ExtensionHookRunner,
      toolExecutorConfig: { enableRetry: false, enableTimeout: false } };
    const registry = new ExtensionRegistryImpl(); registry.addTool(tool, 'fixture');
    const provider = source === 'extension' ? new ExtensionToolProvider({ ...deps, registry })
      : new MemoryToolProvider({ ...deps, canAccess: () => true,
        getMemoryManager: () => ({ getExternalToolEntries: () => [{ providerId: 'fixture', tool }] }) as unknown as MemoryManager });
    const service = new ExternalToolService([provider]);
    const descriptor = (await service.describe([`${source}:fixture:read_value`])).tools[0]!;
    const call = () => service.execute({ toolRef: descriptor.toolRef, revision: descriptor.revision,
      arguments: { value: 1 }, context: { toolCallId: 'final-args' } });
    await expect(call()).rejects.toThrow('Arguments do not match'); expect(execute).not.toHaveBeenCalled();
    hook.mockResolvedValue({ allowed: true, params: { value: 2 } });
    await expect(call()).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(execute).toHaveBeenCalledWith('final-args', { value: 2 }, expect.any(AbortSignal), undefined);
  });

  it('preserves extension ownership and executes through the delegated boundary', async () => {
    seedConversationFixtures();
    const registry = new ExtensionRegistryImpl();
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'extension-ok' }],
      details: {},
    }));
    registry.addTool({
      name: 'demo_add',
      label: 'Demo Add',
      description: 'Add a demo value.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      },
      execute,
    } as AgentTool, 'demo-extension');
    const provider = new ExtensionToolProvider({
      registry,
      getConversationId: () => "3db2ad68-50a3-4bf7-8f9b-500b430780f9",
      toolExecutorConfig: { enableTimeout: false, enableRetry: false },
    });

    const hits = await provider.search('add');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.toolRef).toBe('extension:demo-extension:demo_add');
    await expect(provider.describe(hits[0]!.toolRef)).resolves.toMatchObject({
      namespace: 'demo-extension',
      inputSchema: { type: 'object' },
    });
    await expect(provider.execute(
      hits[0]!.toolRef,
      { value: 2 },
      undefined,
      { toolCallId: 'call-extension' },
    )).resolves.toMatchObject({ content: [{ text: 'extension-ok' }] });
    expect(execute).toHaveBeenCalledWith(
      'call-extension',
      { value: 2 },
      expect.any(AbortSignal),
      undefined,
    );
  });

  it('catalogs dynamic memory provider tools instead of injecting them', async () => {
    seedConversationFixtures();
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'memory-ok' }],
      details: {},
    }));
    const tool = {
      name: 'remote_memory_query',
      description: 'Query remote memory.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      execute,
    } as AgentTool;
    const provider = new MemoryToolProvider({
      getMemoryManager: () => ({
        getExternalToolEntries: () => [{ providerId: 'remote-memory', tool }],
      }) as unknown as MemoryManager,
      getConversationId: () => undefined,
      canAccess: () => true,
      toolExecutorConfig: { enableTimeout: false, enableRetry: false },
    });

    const hits = await provider.search('memory');
    expect(hits[0]?.toolRef).toBe('memory:remote-memory:remote_memory_query');
    await expect(provider.execute(
      hits[0]!.toolRef,
      { query: 'project' },
      undefined,
      { toolCallId: 'call-memory' },
    )).resolves.toMatchObject({ content: [{ text: 'memory-ok' }] });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('hides external memory tools when memory access is disabled', async () => {
    seedConversationFixtures();
    const provider = new MemoryToolProvider({
      getMemoryManager: () => ({
        getExternalToolEntries: () => [{
          providerId: 'remote-memory',
          tool: { name: 'remote_memory_query' } as AgentTool,
        }],
      }) as unknown as MemoryManager,
      getConversationId: () => "6d9217fe-77c7-411d-8cc9-92aabe81a2d0",
      canAccess: () => false,
    });

    expect(await provider.search('memory')).toEqual([]);
    await expect(provider.execute(
      'memory:remote-memory:remote_memory_query',
      {},
      undefined,
      { toolCallId: 'call-memory' },
    )).rejects.toThrow('unavailable');
  });
});
