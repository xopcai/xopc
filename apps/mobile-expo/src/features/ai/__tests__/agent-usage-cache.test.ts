import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatAgentOption } from '../../../query/agents';

const memory = vi.hoisted(() => new Map<string, string>());

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import {
  parseAgentUsage,
  readAgentUsage,
  sortHomeAgents,
  touchAgentUsage,
} from '../agent-usage-cache';

function agent(id: string, overrides: Partial<ChatAgentOption> = {}): ChatAgentOption {
  return {
    id,
    typedModels: { defaults: [], effective: [] },
    skills: { defaults: [] },
    tools: { defaultsDisable: [], entryDisable: [], effectiveDisable: [] },
    ...overrides,
  };
}

describe('agent-usage-cache', () => {
  beforeEach(() => {
    memory.clear();
    vi.useRealTimers();
  });

  it('ignores non-structured usage records', () => {
    expect(parseAgentUsage(JSON.stringify({ Main: 1000 }))).toEqual({});
  });

  it('increments structured usage and keeps the first timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    touchAgentUsage('g1', 'Main');

    vi.setSystemTime(2000);
    touchAgentUsage('g1', 'main');

    expect(readAgentUsage('g1')).toEqual({
      main: { count: 2, firstUsedAt: 1000, lastUsedAt: 2000 },
    });
  });

  it('does not move a single-use agent ahead of the gateway order', () => {
    const agents = [agent('alpha'), agent('beta'), agent('gamma')];

    expect(
      sortHomeAgents(
        agents,
        { gamma: { count: 1, firstUsedAt: 1000, lastUsedAt: 1000 } },
        undefined,
      ).map((item) => item.id),
    ).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('promotes repeated-use agents by bucket while preserving order within a bucket', () => {
    const agents = [agent('alpha'), agent('beta'), agent('gamma'), agent('delta')];

    expect(
      sortHomeAgents(
        agents,
        {
          gamma: { count: 3, firstUsedAt: 1000, lastUsedAt: 3000 },
          delta: { count: 3, firstUsedAt: 1000, lastUsedAt: 4000 },
        },
        undefined,
      ).map((item) => item.id),
    ).toEqual(['gamma', 'delta', 'alpha', 'beta']);
  });

  it('keeps the default agent first', () => {
    const agents = [agent('alpha'), agent('beta'), agent('gamma')];

    expect(
      sortHomeAgents(
        agents,
        { gamma: { count: 8, firstUsedAt: 1000, lastUsedAt: 1000 } },
        'beta',
      ).map((item) => item.id),
    ).toEqual(['beta', 'gamma', 'alpha']);
  });
});
