import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  resolveDefaultTuiAgentId,
  resolveInitialTuiAgentId,
  resolveTuiSessionKey,
  resolveTuiStartupSessionKey,
} from '../../routing/resolve-tui-session-key.js';

describe('resolveTuiSessionKey', () => {
  it('uses global only as the default when scope is global', () => {
    expect(
      resolveTuiSessionKey({
        raw: '',
        sessionScope: 'global',
        currentAgentId: 'main',
        sessionMainKey: 'main',
      }),
    ).toBe('global');
    expect(
      resolveTuiSessionKey({
        raw: 'test123',
        sessionScope: 'global',
        currentAgentId: 'main',
        sessionMainKey: 'main',
      }),
    ).toBe('agent:main:test123');
  });

  it('keeps explicit agent-prefixed keys unchanged', () => {
    expect(
      resolveTuiSessionKey({
        raw: 'agent:ops:incident',
        sessionScope: 'global',
        currentAgentId: 'main',
        sessionMainKey: 'main',
      }),
    ).toBe('agent:ops:incident');
  });

  it('lowercases session keys with uppercase characters', () => {
    expect(
      resolveTuiSessionKey({
        raw: 'agent:main:Test1',
        sessionScope: 'global',
        currentAgentId: 'main',
        sessionMainKey: 'main',
      }),
    ).toBe('agent:main:test1');
    expect(
      resolveTuiSessionKey({
        raw: 'Test1',
        sessionScope: 'global',
        currentAgentId: 'main',
        sessionMainKey: 'main',
      }),
    ).toBe('agent:main:test1');
  });

  it('defaults to agent main bucket when scope is per-sender', () => {
    expect(
      resolveTuiSessionKey({
        raw: '',
        sessionScope: 'per-sender',
        currentAgentId: 'ops',
        sessionMainKey: 'main',
      }),
    ).toBe('agent:ops:main');
  });

  it('passes through global and unknown literals', () => {
    const base = {
      sessionScope: 'per-sender' as const,
      currentAgentId: 'main',
      sessionMainKey: 'main',
    };
    expect(resolveTuiSessionKey({ ...base, raw: 'global' })).toBe('global');
    expect(resolveTuiSessionKey({ ...base, raw: 'unknown' })).toBe('unknown');
  });
});

describe('resolveTuiStartupSessionKey', () => {
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
      resolveTuiStartupSessionKey({
        cfg,
        cwd: '/tmp/xopc',
        createSessionKeySuffix: () => 'tui-test-id',
      }),
    ).toEqual({
      sessionKey: 'agent:main:tui-test-id',
      agentId: 'main',
      sessionScope: 'per-sender',
      sessionMainKey: 'main',
    });
  });

  it('can still resume the agent main session explicitly', () => {
    expect(
      resolveTuiStartupSessionKey({
        cfg,
        sessionOption: 'main',
        cwd: '/tmp/xopc',
      }),
    ).toMatchObject({
      sessionKey: 'agent:main:main',
      agentId: 'main',
    });
  });

  it('resolves explicit tui sub-key under inferred agent', () => {
    expect(
      resolveTuiStartupSessionKey({
        cfg,
        sessionOption: 'tui-abc',
        cwd: '/tmp/xopc',
      }),
    ).toMatchObject({
      sessionKey: 'agent:main:tui-abc',
      agentId: 'main',
    });
  });

  it('uses tui.defaultAgent when cwd does not match an agent workspace', () => {
    expect(
      resolveTuiStartupSessionKey({
        cfg,
        cwd: '/var/tmp/unrelated',
        createSessionKeySuffix: () => 'tui-test-id',
      }),
    ).toMatchObject({
      sessionKey: 'agent:coder:tui-test-id',
      agentId: 'coder',
    });
  });

  it('lets --agent override cwd inference for fresh sessions', () => {
    expect(
      resolveTuiStartupSessionKey({
        cfg,
        agentOption: 'coder',
        cwd: '/tmp/xopc',
        createSessionKeySuffix: () => 'tui-test-id',
      }),
    ).toMatchObject({
      sessionKey: 'agent:coder:tui-test-id',
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
        initialSessionInput: '',
        cwd: '/tmp/xopc/projects/ops/src',
      }),
    ).toBe('ops');
  });

  it('keeps explicit agent prefix from --session', () => {
    expect(
      resolveInitialTuiAgentId({
        cfg,
        fallbackAgentId: 'main',
        explicitAgentId: 'ops',
        initialSessionInput: 'agent:main:incident',
        cwd: '/tmp/xopc/projects/ops/src',
      }),
    ).toBe('main');
  });

  it('falls back when cwd has no matching workspace', () => {
    expect(
      resolveInitialTuiAgentId({
        cfg,
        fallbackAgentId: 'main',
        initialSessionInput: '',
        cwd: '/var/tmp/unrelated',
      }),
    ).toBe('main');
  });
});
