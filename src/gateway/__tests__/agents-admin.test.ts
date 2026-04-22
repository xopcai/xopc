import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  listGatewayAgents,
  prepareCreateAgent,
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentBootstrapFile,
} from '../agents-admin.js';

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      defaults: {
        workspace: '/tmp/ws-default',
        model: 'anthropic/claude-sonnet-4-5',
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
        maxRequestsPerTurn: 50,
        maxToolFailuresPerTurn: 3,
        thinkingDefault: 'medium',
        reasoningDefault: 'off',
        verboseDefault: 'off',
      },
      list: [],
    },
    channels: {},
    ...overrides,
  } as Config;
}

describe('agents-admin', () => {
  it('listGatewayAgents includes default agent when list is empty', () => {
    const cfg = minimalConfig();
    const { defaultId, agents, builtinToolIds } = listGatewayAgents(cfg);
    expect(defaultId).toBe('main');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe('main');
    expect(agents[0]?.isDefault).toBe(true);
    expect(Array.isArray(builtinToolIds)).toBe(true);
    expect(builtinToolIds.length).toBeGreaterThan(0);
    expect(agents[0]?.tools.effectiveDisable).toEqual([]);
  });

  it('prepareUpdateAgent sets description and can clear it', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'coder', enabled: true, workspace: '/tmp/c', description: 'old' }],
      },
    } as Partial<Config>);
    const set = prepareUpdateAgent(cfg, 'coder', { description: 'Builds features' });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const e = set.data.nextConfig.agents?.list?.find((x) => x.id === 'coder');
    expect(e?.description).toBe('Builds features');

    const cleared = prepareUpdateAgent(set.data.nextConfig, 'coder', { description: null });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const e2 = cleared.data.nextConfig.agents?.list?.find((x) => x.id === 'coder');
    expect(e2?.description).toBeUndefined();
  });

  it('prepareUpdateAgent sets skills and tools.disable on list entry', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'coder', enabled: true, workspace: '/tmp/c' }],
      },
    } as Partial<Config>);
    const r = prepareUpdateAgent(cfg, 'coder', {
      skills: ['note'],
      toolsDisable: ['shell'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const list = r.data.nextConfig.agents?.list ?? [];
    const e = list.find((x) => x.id === 'coder');
    expect(e?.skills).toEqual(['note']);
    expect(e?.tools?.disable).toEqual(['shell']);
  });

  it('prepareCreateAgent uses explicit id seed for agent id and keeps display name', () => {
    const cfg = minimalConfig();
    const r = prepareCreateAgent(cfg, {
      name: 'Nice Label',
      id: 'nice-bot',
      workspace: '/tmp/ws-nice',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const list = r.data.nextConfig.agents?.list ?? [];
    const e = list.find((x) => x.id === 'nice-bot');
    expect(e?.name).toBe('Nice Label');
  });

  it('prepareCreateAgent rejects duplicate id', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'coder', enabled: true, workspace: '/tmp/c' }],
      },
    } as Partial<Config>);
    const r = prepareCreateAgent(cfg, { name: 'coder', workspace: '/tmp/x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
    }
  });

  it('prepareDeleteAgent refuses main', () => {
    const cfg = minimalConfig({
      agents: {
        ...minimalConfig().agents,
        list: [{ id: 'main', enabled: true }],
      },
    } as Partial<Config>);
    const r = prepareDeleteAgent(cfg, 'main');
    expect(r.ok).toBe(false);
  });

  it('readAgentBootstrapFile rejects unsupported filename', async () => {
    const cfg = minimalConfig();
    const r = await readAgentBootstrapFile(cfg, 'main', '../../../etc/passwd');
    expect(r.ok).toBe(false);
  });
});
