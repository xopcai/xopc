import { describe, expect, it } from 'vitest';
import type { Config } from '../schema.js';
import { expandWorkspacePathString } from '../workspace-path.js';
import {
  extractProfileAgentId,
  resolveEffectiveAgentProfile,
  resolveEffectiveAgentProfileForSession,
} from '../agent-profile.js';

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    agents: {
      defaults: {
        workspace: '~/.xopc/workspace',
        model: '',
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
        maxRequestsPerTurn: 50,
        maxToolFailuresPerTurn: 3,
        tools: { disable: ['grep'] },
      },
      list: [
        { id: 'main', enabled: true },
        {
          id: 'coder',
          enabled: true,
          workspace: '~/coder-ws',
          model: 'anthropic/claude-3-5-sonnet-20241022',
          tools: { disable: ['shell'] },
        },
      ],
    },
    bindings: [],
    session: { dmScope: 'main' },
    channels: {},
    gateway: {
      host: '127.0.0.1',
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
      defaultTimezone: 'UTC',
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
  it('merges defaults with list entry for workspace and model', () => {
    const cfg = minimalConfig();
    const p = resolveEffectiveAgentProfile(cfg, 'coder');
    expect(p.primaryModelRef).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(p.resolvedWorkspacePath).toContain('coder-ws');
  });

  it('resolves main workspace under defaults.workspace parent', () => {
    const cfg = minimalConfig();
    const p = resolveEffectiveAgentProfile(cfg, 'main');
    expect(p.resolvedWorkspacePath).toMatch(/workspace[/\\]main$/);
  });

  it('merges tool disable lists from defaults and list', () => {
    const cfg = minimalConfig();
    const p = resolveEffectiveAgentProfile(cfg, 'coder');
    expect(p.tools.disable.has('grep')).toBe(true);
    expect(p.tools.disable.has('shell')).toBe(true);
  });

  it('extractProfileAgentId falls back to main for unknown agent id', () => {
    const cfg = minimalConfig();
    expect(extractProfileAgentId('nope:webchat:default:direct:x', cfg)).toBe('main');
  });

  it('resolveEffectiveAgentProfileForSession parses agent id from key', () => {
    const cfg = minimalConfig();
    const key = 'coder:telegram:acc_default:dm:123';
    const p = resolveEffectiveAgentProfileForSession(cfg, key);
    expect(p.agentId).toBe('coder');
    expect(p.resolvedWorkspacePath).toContain('coder-ws');
  });

  it('expandWorkspacePathString expands tilde', () => {
    const p = expandWorkspacePathString('~/foo');
    expect(p).not.toContain('~');
    expect(p.length).toBeGreaterThan(4);
  });

  it('uses join(defaults.workspace, id) when list entry has no workspace field', () => {
    const base = minimalConfig();
    const cfg: Config = {
      ...base,
      agents: {
        ...base.agents!,
        default: 'main',
        list: [{ id: 'coder', enabled: true, model: 'openai/gpt-4o' }],
      },
    };
    const p = resolveEffectiveAgentProfile(cfg, 'coder');
    expect(p.resolvedWorkspacePath).toMatch(/workspace[/\\]coder$/);
  });
});
