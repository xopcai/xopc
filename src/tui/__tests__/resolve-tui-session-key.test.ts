import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  resolveDefaultTuiAgentId,
  resolveInitialTuiAgentId,
  resolveTuiConversationId,
  resolveTuiStartupConversationId,
} from '../../routing/resolve-tui-session-key.js';

describe('resolveTuiConversationId', () => {
  const base = {};
  it('creates independent UUIDs and normalizes explicit UUIDs', () => {
    const first = resolveTuiConversationId(base);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveTuiConversationId(base)).not.toBe(first);
    expect(resolveTuiConversationId({ ...base, raw: first.toUpperCase() })).toBe(first);
  });
  it.each(['global', 'unknown', 'main', 'agent:main:main'])('rejects old aliases: %s', (raw) => {
    expect(() => resolveTuiConversationId({ ...base, raw })).toThrow();
  });
});

describe('resolveTuiStartupConversationId', () => {
  const cfg = {
    agents: {
      default: 'main',
      list: [
        { id: 'main', workspace: '/tmp/xopc' },
        { id: 'coder', workspace: '/tmp/xopc-coder' },
      ],
    },
    tui: { defaultAgent: 'coder' },
    session: { scope: 'per-sender', mainKey: 'main' },
  } as Config;

  it('defaults to a fresh TUI session when session option is omitted', () => {
    expect(
      resolveTuiStartupConversationId({
        cfg,
        cwd: '/tmp/xopc',
        createId: () => 'eb04e730-5bda-41a4-8d12-acdeb5a7a4da',
      }),
    ).toEqual({
      conversationId: "eb04e730-5bda-41a4-8d12-acdeb5a7a4da",
      agentId: 'main',
    });
  });

  it('resumes an explicit conversation UUID', () => {
    expect(
      resolveTuiStartupConversationId({
        cfg,
        sessionOption: '6d9217fe-77c7-411d-8cc9-92aabe81a2d0',
        cwd: '/tmp/xopc',
      }),
    ).toMatchObject({
      conversationId: "6d9217fe-77c7-411d-8cc9-92aabe81a2d0",
      agentId: 'main',
    });
  });

  it('keeps an explicit UUID under the initially selected agent', () => {
    expect(
      resolveTuiStartupConversationId({
        cfg,
        sessionOption: '7d4675b4-115e-4da9-8d96-62dfbf8d7494',
        cwd: '/tmp/xopc',
      }),
    ).toMatchObject({
      conversationId: "7d4675b4-115e-4da9-8d96-62dfbf8d7494",
      agentId: 'main',
    });
  });

  it('uses tui.defaultAgent when cwd does not match an agent workspace', () => {
    expect(
      resolveTuiStartupConversationId({
        cfg,
        cwd: '/var/tmp/unrelated',
        createId: () => 'eb04e730-5bda-41a4-8d12-acdeb5a7a4da',
      }),
    ).toMatchObject({
      conversationId: "eb04e730-5bda-41a4-8d12-acdeb5a7a4da",
      agentId: 'coder',
    });
  });

  it('uses agents.default when tui.defaultAgent is not configured', () => {
    expect(
      resolveTuiStartupConversationId({
        cfg: {
          ...cfg,
          tui: {},
        },
        cwd: '/var/tmp/unrelated',
        createId: () => 'eb04e730-5bda-41a4-8d12-acdeb5a7a4da',
      }),
    ).toMatchObject({
      conversationId: "eb04e730-5bda-41a4-8d12-acdeb5a7a4da",
      agentId: 'main',
    });
  });

  it('lets --agent override cwd inference for fresh sessions', () => {
    expect(
      resolveTuiStartupConversationId({
        cfg,
        agentOption: 'coder',
        cwd: '/tmp/xopc',
        createId: () => 'eb04e730-5bda-41a4-8d12-acdeb5a7a4da',
      }),
    ).toMatchObject({
      conversationId: "eb04e730-5bda-41a4-8d12-acdeb5a7a4da",
      agentId: 'coder',
    });
  });
});

describe('resolveDefaultTuiAgentId', () => {
  it('falls back to agents.default when tui.defaultAgent is missing from agents.list', () => {
    expect(
      resolveDefaultTuiAgentId({
        agents: {
          default: 'main',
          list: [{ id: 'main', workspace: '/tmp/xopc' }],
        },
        tui: { defaultAgent: 'coder' },
      } as Config),
    ).toBe('main');
  });
});

describe('resolveInitialTuiAgentId', () => {
  const cfg = {
    agents: {
      list: [
        { id: 'main', workspace: '/tmp/xopc' },
        { id: 'ops', workspace: '/tmp/xopc/projects/ops' },
      ],
    },
  } as Config;

  it('infers agent from cwd when session is not agent-prefixed', () => {
    expect(
      resolveInitialTuiAgentId({
        cfg,
        fallbackAgentId: 'main',
        cwd: '/tmp/xopc/projects/ops/src',
      }),
    ).toBe('ops');
  });

  it('uses explicit agent selection independently of the UUID', () => {
    expect(
      resolveInitialTuiAgentId({
        cfg,
        fallbackAgentId: 'main',
        explicitAgentId: 'ops',
        cwd: '/tmp/xopc/projects/ops/src',
      }),
    ).toBe('ops');
  });

  it('falls back when cwd has no matching workspace', () => {
    expect(
      resolveInitialTuiAgentId({
        cfg,
        fallbackAgentId: 'main',
        cwd: '/var/tmp/unrelated',
      }),
    ).toBe('main');
  });
});
