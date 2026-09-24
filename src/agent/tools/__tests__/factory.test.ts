import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../config/schema.js';
import type { MessageBus } from '../../../infra/bus/index.js';
import { ExtensionRegistryImpl } from '../../../extensions/extension-registry-impl.js';
import {
  createAgentCapabilitySessionState,
  getAgentCapabilityToolNames,
  listAgentCapabilities,
  resolveAgentCapabilityCatalog,
} from '../../capabilities/index.js';
import { runWithEmbeddedExecutionSession } from '../../embedded/execution-context.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { AgentToolsFactory } from '../factory.js';

describe('AgentToolsFactory', () => {
  beforeAll(() => initializeTestAgentCatalog());
  afterAll(() => closeXopcDatabase());

  it('offers batching to ordinary agents while preserving individual tool denials', async () => {
    const factory = new AgentToolsFactory({ workspace: '/tmp', bus: {} as MessageBus, getCurrentContext: () => null });
    expect(factory.createCoreTools().map(tool => tool.name)).toContain('data_batch');
    expect(factory.createCoreTools({ disabledTools: new Set(['data_batch']) }).map(tool => tool.name)).not.toContain('data_batch');
    expect(factory.createCoreTools({ disabledTools: new Set(['read_file', 'grep', 'exec_command', 'knowledge_search', 'knowledge_get', 'web_search', 'web_fetch', 'xopc_tool_execute']) }).map(tool => tool.name)).not.toContain('data_batch');
    const batch = factory.createCoreTools({ disabledTools: new Set(['read_file']) }).find(tool => tool.name === 'data_batch')!;
    const result = await batch.execute('denied', { operations: [{ id: 'r', kind: 'file_read', path: 'x' }] });
    expect(result.details).toMatchObject({ sourceRequests: 0, status: 'failed' });
  });
  it('routes heartbeat notifications through final-result delivery even with explicit destinations', async () => {
    const conversationId = createConversation({ agentId: 'main', sourceChannel: 'heartbeat', sessionType: 'heartbeat' }).key;
    const publishOutbound = vi.fn();
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test', bus: { publishOutbound } as unknown as MessageBus,
      getCurrentContext: () => ({ channel: 'heartbeat', chatId: 'main', conversationId, origin: { type: 'system', source: 'heartbeat' } }),
      getConfig: () => ConfigSchema.parse({ messages: { tts: { enabled: true } } }),
    });
    for (const [name, params] of [
      ['send_message', { content: 'Result', channel: 'weixin', chat_id: 'explicit' }],
      ['send_media', { path: '/tmp/missing.png' }],
      ['text_to_speech', { text: 'Result' }],
    ] as const) {
      const tool = factory.createCoreTools().find(tool => tool.name === name)!;
      expect(tool).toBeDefined();
      await expect(tool.execute('heartbeat-guard', params)).rejects.toThrow('policy-controlled delivery');
    }
    expect(publishOutbound).not.toHaveBeenCalled();
  });

  it('does not register browser_use when browser runtime is disabled', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getConfig: () =>
        ConfigSchema.parse({
          browser: { enabled: false, driver: { kind: 'extension' } },
        }),
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).not.toContain('browser_use');
  });

  it('exposes provider-compatible object schemas for every core tool', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getConfig: () => ConfigSchema.parse({ browser: { enabled: true, driver: { kind: 'extension' } } }),
    });

    for (const tool of factory.createCoreTools()) {
      expect(tool.parameters, tool.name).toMatchObject({ type: 'object' });
    }
  });

  it('does not register desktop pet creation as a core tool', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).not.toContain('create_desktop_pet');
    expect(factory.createCapabilityTools(['desktop-pet-authoring']).map((tool) => tool.name)).toEqual([
      'create_desktop_pet',
    ]);
  });

  it('registers conversational workflow management for primary agents', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getPrimaryModel: () => ({ input: ['text'] }) as never,
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).toContain('workflow_manage');
  });

  it('registers marketplace discovery without requiring a CLI or local skill manager', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getConfig: () => ConfigSchema.parse(undefined),
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).toContain('skills_marketplace_search');
    expect(factory.createCoreTools().map((tool) => tool.name)).toContain('publish_artifacts');
  });

  it('exposes exactly three stable gateway tools instead of external tool definitions', () => {
    const extensionRegistry = new ExtensionRegistryImpl();
    extensionRegistry.addTool({
      name: 'extension_demo',
      description: 'An extension tool that must stay out of the model tool list.',
      parameters: { type: 'object' },
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
    } as AgentTool, 'demo');
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      extensionRegistry,
    });

    const names = factory.createAllTools().map((tool) => tool.name);
    expect(names.filter((name) => name.startsWith('xopc_tool_'))).toEqual([
      'xopc_tool_search',
      'xopc_tool_describe',
      'xopc_tool_execute',
    ]);
    expect(names).not.toContain('extension_demo');
    expect(names.some((name) => name.startsWith('composio_'))).toBe(false);
  });

  it('registers skill_install as a core tool when the runtime provides installation', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      installSkillFromSource: async () => ({
        skillId: 'demo',
        path: '/tmp/demo',
        source: 'https://example.com/demo.git',
        kind: 'git',
        contentHash: 'abc',
      }),
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).toContain('skill_install');
    expect(factory.getLazyCapabilityToolNames()).not.toContain('skill_install');
  });

  it('resolves declared capability tool names from the registry', () => {
    expect(getAgentCapabilityToolNames(['desktop-pet-authoring'])).toEqual(['create_desktop_pet']);
    expect(getAgentCapabilityToolNames(['missing-capability'])).toEqual([]);
    expect(listAgentCapabilities().map((capability) => capability.id)).toEqual(
      expect.arrayContaining([
        'desktop-pet-authoring',
        'automation-authoring',
        'workflow-authoring',
        'extension-authoring',
        'skill-authoring',
        'visual-asset-authoring',
        'browser-research',
        'data-analysis',
      ]),
    );
  });

  it('creates capability session state with the declared ttl', () => {
    expect(createAgentCapabilitySessionState('desktop-pet-authoring', 'skill', 1234)).toMatchObject({
      id: 'desktop-pet-authoring',
      source: 'skill',
      activatedAt: 1234,
      ttl: 'until-complete',
      status: 'collecting',
    });
    expect(createAgentCapabilitySessionState('browser-research', 'ui', 1234)).toMatchObject({
      id: 'browser-research',
      source: 'ui',
      ttl: 'turn',
    });
    expect(createAgentCapabilitySessionState('missing-capability', 'skill', 1234)).toBeNull();
  });

  it('reports capability tool availability separately from declarations', () => {
    const catalog = resolveAgentCapabilityCatalog({
      registeredToolNames: ['read_file', 'write_file', 'web_search'],
      lazyToolNames: ['create_desktop_pet'],
      deniedToolNames: ['write_file'],
    });
    const pet = catalog.find((capability) => capability.id === 'desktop-pet-authoring');
    expect(pet?.availableTools).toEqual(['create_desktop_pet']);

    const extension = catalog.find((capability) => capability.id === 'extension-authoring');
    expect(extension?.availableTools).toEqual(['read_file']);
    expect(extension?.unavailableTools).toEqual(
      expect.arrayContaining(['write_file', 'apply_patch', 'list_dir', 'grep', 'find', 'exec_command']),
    );

    const data = catalog.find((capability) => capability.id === 'data-analysis');
    expect(data?.availableTools).toEqual(['read_file']);
    expect(data?.tools).not.toContain('execute_code');
  });
  it('routes side chat clarification through its isolated execution without a persistent session context', async () => {
    const requestClarification = vi.fn(async () => ({ status: 'answered' as const, answer: 'yes' }));
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      gatewayClarify: { requestClarification },
    });
    const tool = factory.createCoreTools().find((tool) => tool.name === 'clarify')!;
    const result = await runWithEmbeddedExecutionSession(
      'parent:side-chat:isolated',
      () => tool.execute('q1', { question: 'Continue?' }),
      'run-1',
    );
    expect(result.details).toMatchObject({ answer: 'yes' });
    expect(requestClarification).toHaveBeenCalledWith(
      { conversationId: 'parent:side-chat:isolated', runId: 'run-1', toolCallId: 'q1' },
      expect.objectContaining({ question: 'Continue?' }),
    );
  });

});
