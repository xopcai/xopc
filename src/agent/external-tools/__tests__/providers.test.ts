import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { ExtensionRegistryImpl } from '../../../extensions/extension-registry-impl.js';
import type { MemoryManager } from '../../memory/manager.js';
import { ExtensionToolProvider } from '../extension-provider.js';
import { MemoryToolProvider } from '../memory-provider.js';
import { McpToolProvider } from '../mcp-provider.js';
import type { SessionMcpRuntime } from '../../mcp/bundle-mcp-types.js';

describe('external tool providers', () => {
  it('preserves extension ownership and executes through the delegated boundary', async () => {
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
      getSessionKey: () => 'agent:main:webchat:local:dm:test',
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

  it('discovers and executes MCP tools without materializing model-visible tools', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'mcp-ok' }],
    }));
    const runtime = {
      markUsed: vi.fn(),
      acquireLease: vi.fn(() => vi.fn()),
      getCatalog: vi.fn(async () => ({
        version: 1,
        generatedAt: 1,
        servers: {},
        resources: [],
        prompts: [],
        tools: [{
          serverName: 'demo server',
          safeServerName: 'demo-server',
          toolName: 'lookup',
          description: 'Look up a demo record.',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
          fallbackDescription: 'lookup',
        }],
      })),
      callTool,
    } as unknown as SessionMcpRuntime;
    const provider = new McpToolProvider({
      workspace: '/tmp/workspace',
      getConfig: () => ({ mcp: { servers: { 'demo server': { command: 'demo' } } } }) as Config,
      getSessionKey: () => undefined,
      getRuntime: vi.fn(async () => runtime),
    });

    const hits = await provider.search('lookup');
    expect(hits).toEqual([expect.objectContaining({
      toolRef: 'mcp:demo-server:lookup',
      source: 'mcp',
    })]);
    await expect(provider.describe('mcp:demo-server:lookup')).resolves.toMatchObject({
      inputSchema: { type: 'object' },
    });
    await expect(provider.execute(
      'mcp:demo-server:lookup',
      { id: '42' },
      undefined,
      { toolCallId: 'call-mcp' },
    )).resolves.toMatchObject({ content: [{ text: 'mcp-ok' }] });
    expect(callTool).toHaveBeenCalledWith('demo server', 'lookup', { id: '42' }, undefined);
  });

  it('enforces flat MCP tool and timeout policies', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const runtime = {
      markUsed: vi.fn(),
      getCatalog: vi.fn(async () => ({
        version: 1,
        generatedAt: 1,
        servers: {},
        resources: [],
        prompts: [],
        tools: [
          { serverName: 'demo', safeServerName: 'demo', toolName: 'read', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' }, fallbackDescription: 'read' },
          { serverName: 'demo', safeServerName: 'demo', toolName: 'write', annotations: { readOnlyHint: false }, inputSchema: { type: 'object' }, fallbackDescription: 'write' },
        ],
      })),
      callTool,
    } as unknown as SessionMcpRuntime;
    const config = {
      agents: {
        default: 'main',
        defaults: {
          models: { chat: { primary: 'openai/gpt-4.1', fallbacks: [] }, intents: {} },
          skills: { mode: 'all-enabled', exclude: [] },
          tools: {
            'mcp:demo:write': { mode: 'deny' },
            'mcp:demo:read': { mode: 'allow', timeoutMs: 1_000 },
          },
          workflows: {},
          runtime: {},
        },
        list: [{
          id: 'main', enabled: true,
          profile: { name: 'Main' },
          workspace: '/tmp/main',
        }],
      },
    } as Config;
    const provider = new McpToolProvider({
      workspace: '/tmp/workspace',
      getConfig: () => config,
      getSessionKey: () => 'agent:main:webchat:default:direct:test',
      getRuntime: vi.fn(async () => runtime),
    });

    expect((await provider.search('')).map((tool) => tool.title)).toEqual(['read']);
    await provider.execute('mcp:demo:read', {}, undefined, { toolCallId: 'call' });
    expect(callTool.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
  });

  it('catalogs dynamic memory provider tools instead of injecting them', async () => {
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
      getSessionKey: () => undefined,
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
});
