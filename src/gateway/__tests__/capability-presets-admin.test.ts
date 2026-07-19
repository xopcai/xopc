import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../agent-manifest/index.js';
import type { Config } from '../../config/schema.js';
import {
  listCapabilityPresets,
  prepareCreateCapabilityPreset,
  prepareDeleteCapabilityPreset,
  prepareUpdateCapabilityPreset,
} from '../capability-presets-admin.js';

function manifest(id: string, patch: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: `/tmp/${id}` },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory: { mode: 'off', sources: ['session'] },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
    ...patch,
  };
}

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      default: 'main',
      defaultPreset: 'default',
      capabilityPresets: {},
      list: [manifest('main')],
    },
    channels: {},
    ...overrides,
  } as Config;
}

describe('capability-presets-admin', () => {
  it('creates and lists capability presets with usage', () => {
    const created = prepareCreateCapabilityPreset(minimalConfig(), {
      id: 'safe-coder',
      name: 'Safe Coder',
      description: 'Shared coding guardrails',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cfg = created.data.nextConfig;
    cfg.agents.list = [manifest('coder', { extends: ['safe-coder'] })];

    const payload = listCapabilityPresets(cfg);
    expect(payload.presets[0]?.id).toBe('safe-coder');
    expect(payload.presets[0]?.usage).toEqual([{ agentId: 'coder', agentName: 'coder', direct: true }]);
  });

  it('creates a complete preset atomically', () => {
    const created = prepareCreateCapabilityPreset(minimalConfig(), {
      id: 'safe-coder',
      name: 'Safe Coder',
      version: 3,
      models: { roles: { deep: { model: 'openai/gpt-4.1' } } },
      tools: {
        builtin: {
          exec_command: {
            mode: 'confirm',
            scope: 'workspace',
            limits: { timeoutMs: 30_000 },
          },
        },
      },
      skills: { mode: 'allowlist', allow: ['diagnose'] },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.nextConfig.agents.capabilityPresets['safe-coder']).toMatchObject({
      version: 3,
      models: { roles: { deep: { model: 'openai/gpt-4.1' } } },
      tools: {
        builtin: {
          exec_command: {
            mode: 'confirm',
            scope: 'workspace',
            limits: { timeoutMs: 30_000 },
          },
        },
      },
    });
  });

  it('creates every advanced policy section atomically', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          base: { id: 'base', name: 'Base', version: 1 },
        },
        list: [manifest('main')],
      },
    } as Partial<Config>);
    const created = prepareCreateCapabilityPreset(cfg, {
      id: 'advanced',
      name: 'Advanced',
      extends: ['base'],
      models: {
        imageModel: {
          primary: 'openai/gpt-4.1',
          fallbacks: ['anthropic/claude-sonnet-4'],
          timeoutMs: 20_000,
          autoProviderFallback: true,
        },
        policy: { allowFallbacks: true, maxCostTier: 'medium' },
      },
      tools: {
        builtin: {},
        mcp: {
          servers: { filesystem: { mode: 'confirm', scope: 'workspace' } },
          tools: { 'filesystem__write': { mode: 'deny', limits: { maxCallsPerTurn: 2 } } },
        },
      },
      memory: {
        mode: 'confirmWrite',
        sources: ['session', 'workspace'],
        privacy: { crossAgentSharing: 'deny', sensitiveWritePolicy: 'confirm' },
      },
      workflows: { default: 'research', allowed: ['research'] },
      boundaries: {
        requiresConfirmation: ['external-write'],
        forbidden: ['secrets'],
        escalation: ['high-risk'],
      },
      runtime: { maxTurns: 20, timeoutMs: 120_000, maxToolFailuresPerTurn: 3 },
      locks: ['tools.mcp', 'boundaries.forbidden'],
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.nextConfig.agents.capabilityPresets.advanced).toMatchObject({
      extends: ['base'],
      models: {
        imageModel: { timeoutMs: 20_000, autoProviderFallback: true },
        policy: { maxCostTier: 'medium' },
      },
      tools: { mcp: { servers: { filesystem: { mode: 'confirm', scope: 'workspace' } } } },
      memory: { mode: 'confirmWrite', sources: ['session', 'workspace'] },
      workflows: { default: 'research' },
      boundaries: { forbidden: ['secrets'] },
      runtime: { maxTurns: 20 },
      locks: ['tools.mcp', 'boundaries.forbidden'],
    });
  });

  it('lists every agent as usage for the global default preset', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          default: {
            id: 'default',
            name: 'Global defaults',
            version: 1,
          },
          'safe-coder': {
            id: 'safe-coder',
            name: 'Safe Coder',
            version: 1,
          },
        },
        list: [
          manifest('main'),
          manifest('coder', { extends: ['safe-coder'] }),
        ],
      },
    } as Partial<Config>);

    const payload = listCapabilityPresets(cfg);
    const globalDefault = payload.presets.find((preset) => preset.id === 'default');
    const sharedPreset = payload.presets.find((preset) => preset.id === 'safe-coder');

    expect(globalDefault?.usage).toEqual([
      { agentId: 'coder', agentName: 'coder', direct: true },
      { agentId: 'main', agentName: 'main', direct: true },
    ]);
    expect(sharedPreset?.usage).toEqual([{ agentId: 'coder', agentName: 'coder', direct: true }]);
  });

  it('updates patch fields and supports null field removal', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          'safe-coder': {
            id: 'safe-coder',
            name: 'Safe Coder',
            version: 1,
            description: 'old',
            tools: { builtin: { exec_command: { mode: 'confirm', scope: 'workspace' } } },
          },
        },
        list: [manifest('main')],
      },
    } as Partial<Config>);

    const updated = prepareUpdateCapabilityPreset(cfg, 'safe-coder', {
      description: null,
      skills: { mode: 'allowlist', allow: ['diagnose'] },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const preset = updated.data.nextConfig.agents.capabilityPresets['safe-coder'];
    expect(preset?.description).toBeUndefined();
    expect(preset?.version).toBe(2);
    expect(preset?.skills).toEqual({ mode: 'allowlist', allow: ['diagnose'] });
    expect(preset?.tools?.builtin.exec_command?.mode).toBe('confirm');
  });

  it('rejects preset cycles', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          a: { id: 'a', name: 'A', version: 1, extends: ['b'] },
          b: { id: 'b', name: 'B', version: 1 },
        },
        list: [manifest('main')],
      },
    } as Partial<Config>);
    const updated = prepareUpdateCapabilityPreset(cfg, 'b', { extends: ['a'] });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error).toContain('cycle');
  });

  it('protects presets that are used by agents from deletion', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          'safe-coder': { id: 'safe-coder', name: 'Safe Coder', version: 1 },
        },
        list: [manifest('coder', { extends: ['safe-coder'] })],
      },
    } as Partial<Config>);
    const deleted = prepareDeleteCapabilityPreset(cfg, 'safe-coder');
    expect(deleted.ok).toBe(false);
    if (deleted.ok) return;
    expect(deleted.status).toBe(409);
  });

  it('counts and protects agents that use a preset transitively', () => {
    const cfg = minimalConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          base: { id: 'base', name: 'Base', version: 1 },
          child: { id: 'child', name: 'Child', version: 1, extends: ['base'] },
        },
        list: [manifest('coder', { extends: ['child'] })],
      },
    } as Partial<Config>);

    const base = listCapabilityPresets(cfg).presets.find((preset) => preset.id === 'base');
    expect(base?.usage).toEqual([{ agentId: 'coder', agentName: 'coder', direct: false }]);
    const deleted = prepareDeleteCapabilityPreset(cfg, 'base');
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.error).toContain('coder');
  });
});
