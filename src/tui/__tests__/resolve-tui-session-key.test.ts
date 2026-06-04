import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
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
    agents: { default: 'main', list: [{ id: 'main', workspace: '/tmp/xopc' }] },
    session: { scope: 'per-sender', mainKey: 'main' },
  } as Config;

  it('defaults to agent main when session option omitted', () => {
    expect(resolveTuiStartupSessionKey({ cfg, cwd: '/tmp/xopc' })).toEqual({
      sessionKey: 'agent:main:main',
      agentId: 'main',
      sessionScope: 'per-sender',
      sessionMainKey: 'main',
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
