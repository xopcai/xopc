import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../agent-manifest/index.js';
import type { Config } from '../schema.js';
import { expandWorkspacePathString } from '../workspace-path.js';
import {
  extractProfileAgentId,
  resolveEffectiveAgentProfile,
  resolveEffectiveAgentProfileForSession,
} from '../agent-profile.js';

function manifest(id: string, patch: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help the user complete tasks'] },
    workspace: { root: `~/.xopc/workspace/${id}` },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
    ...patch,
  };
}

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    agents: {
      default: 'main',
      capabilityPresets: {
        code: {
          id: 'code',
          name: 'Code',
          tools: { builtin: { grep: { mode: 'deny' } } },
        },
      },
      list: [
        manifest('main'),
        manifest('coder', {
          extends: ['code'],
          workspace: { root: '~/coder-ws' },
          models: { defaultRole: 'deep', roles: { deep: { model: 'anthropic/claude-3-5-sonnet-20241022' } } },
          tools: { builtin: { exec_command: { mode: 'deny' } } },
        }),
      ],
    },
    bindings: [],
    session: { dmScope: 'main' },
    channels: {},
    gateway: {
      bind: 'loopback',
      port: 18790,
      auth: { mode: 'token' },
      heartbeat: { enabled: true, intervalMs: 60_000 },
      maxSseConnections: 100,
      corsOrigins: [],
    },
    tools: { web: { search: { maxResults: 5, providers: [] } } },
    cron: {
      enabled: true,
      maxConcurrentJobs: 5,
      historyRetentionDays: 7,
      enableMetrics: true,
    },
    extensions: {
      allow: [],
      security: {
        checkPermissions: true,
        allowUntrusted: false,
        allow: [],
        trackProvenance: true,
        allowPromptInjection: false,
      },
      slots: {},
    },
    modelsDev: { enabled: true },
    ...overrides,
  } as Config;
}

describe('agent-profile', () => {
  it('resolves workspace and default role model from manifest', () => {
    const p = resolveEffectiveAgentProfile(minimalConfig(), 'coder');
    expect(p.primaryModelRef).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(p.resolvedWorkspacePath).toContain('coder-ws');
  });

  it('resolves fallback chain from the default model role', () => {
    const base = minimalConfig();
    const cfg: Config = {
      ...base,
      agents: {
        ...base.agents,
        list: [
          manifest('main', {
            models: {
              defaultRole: 'deep',
              roles: {
                deep: {
                  model: 'anthropic/claude-3-5-sonnet-20241022',
                  fallbacks: ['openai/gpt-4o', ' google/gemini-2.5-pro '],
                },
              },
            },
          }),
        ],
      },
    };
    const p = resolveEffectiveAgentProfile(cfg, 'main');
    expect(p.primaryModelRef).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(p.fallbacks).toEqual(['openai/gpt-4o', 'google/gemini-2.5-pro']);
  });

  it('applies capability presets before agent policies', () => {
    const p = resolveEffectiveAgentProfile(minimalConfig(), 'coder');
    expect(p.tools.denied.has('grep')).toBe(true);
    expect(p.tools.denied.has('exec_command')).toBe(true);
  });

  it('uses all skills when manifest skill mode is all', () => {
    const p = resolveEffectiveAgentProfile(minimalConfig(), 'main');
    expect(p.skillsAllowlist).toBeUndefined();
  });

  it('keeps an explicit empty skill allowlist as no skills', () => {
    const base = minimalConfig();
    const cfg: Config = {
      ...base,
      agents: {
        ...base.agents!,
        list: [manifest('main', { skills: { mode: 'allowlist', allow: [] } })],
      },
    };
    const p = resolveEffectiveAgentProfile(cfg, 'main');
    expect(p.skillsAllowlist).toEqual([]);
  });

  it('extractProfileAgentId falls back to default agent for unknown ids', () => {
    expect(extractProfileAgentId('nope:webchat:default:direct:x', minimalConfig())).toBe('main');
  });

  it('resolveEffectiveAgentProfileForSession parses agent id from key', () => {
    const p = resolveEffectiveAgentProfileForSession(minimalConfig(), 'agent:coder:telegram:acc_default:direct:123');
    expect(p.agentId).toBe('coder');
    expect(p.resolvedWorkspacePath).toContain('coder-ws');
  });

  it('expandWorkspacePathString expands tilde', () => {
    const p = expandWorkspacePathString('~/foo');
    expect(p).not.toContain('~');
    expect(p.length).toBeGreaterThan(4);
  });
});
