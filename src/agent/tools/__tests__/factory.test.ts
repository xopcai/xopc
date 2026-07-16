import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { MessageBus } from '../../../infra/bus/index.js';
import {
  createAgentCapabilitySessionState,
  getAgentCapabilityToolNames,
  listAgentCapabilities,
  resolveAgentCapabilityCatalog,
} from '../../capabilities/index.js';
import { AgentToolsFactory } from '../factory.js';

describe('AgentToolsFactory', () => {
  it('does not register browser_use when browser runtime is disabled', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getConfig: () =>
        ({
          browser: { enabled: false, backend: 'extension' },
          agents: {
            default: 'main',
            defaultPreset: 'default',
            capabilityPresets: {
              default: {
                id: 'default',
                name: 'Global defaults',
                models: { defaultRole: 'deep', roles: { deep: { model: 'anthropic/claude-sonnet-4-5' } } },
              },
            },
            list: [
              {
                id: 'main',
                enabled: true,
                identity: { name: 'Main', role: 'General assistant' },
                responsibilities: { primary: ['Help the user complete tasks'] },
                workspace: { root: '/tmp/xopc-tools-factory-test' },
                tools: { builtin: {} },
                skills: { mode: 'all' },
                memory: { mode: 'confirmWrite', sources: ['session'] },
                workflows: {},
                boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
              },
            ],
          },
        }) as Config,
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).not.toContain('browser_use');
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

  it('registers code intelligence only for configured agent ids', () => {
    const config = ConfigSchema.parse(undefined);
    const codeRuntime = {
      prime: async () => {},
      markDirty: () => {},
      supportsTool: () => true,
      callTool: async () => { throw new Error('not called'); },
      getStatus: () => ({
        state: 'idle' as const,
        workspace: '/tmp/xopc-tools-factory-test',
        project: 'tmp-xopc-tools-factory-test',
        dirtyPaths: [],
        coverage: 'unknown' as const,
      }),
      dispose: async () => {},
    };
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getConfig: () => config,
      getCodeIntelligenceRuntime: () => codeRuntime,
    });

    expect(factory.createCoreTools({ agentId: 'coder' }).map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['code_search', 'code_read_symbol', 'code_trace', 'code_impact', 'code_architecture']),
    );
    expect(factory.createCoreTools({ agentId: 'main' }).map((tool) => tool.name)).not.toContain('code_search');
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
});
