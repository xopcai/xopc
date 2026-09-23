import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import type { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import {
  resolveDefaultTuiAgentId,
  resolveInitialTuiAgentId,
  resolveTuiConversationId,
  resolveTuiStartupConversationId,
} from '../../routing/resolve-tui-session-key.js';

let catalog: AgentCatalogRepository;

beforeEach(() => {
  catalog = initializeTestAgentCatalog({
    agents: [
      { id: 'main', enabled: true, workspace: '/tmp/xopc' },
      { id: 'coder', enabled: true, workspace: '/tmp/xopc-coder' },
      { id: 'ops', enabled: true, workspace: '/tmp/xopc/projects/ops' },
    ],
    surfaceDefaults: { tui: 'coder' },
  });
});

afterEach(() => closeXopcDatabase());

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
  const cfg = ConfigSchema.parse({
    session: { scope: 'per-sender', mainKey: 'main' },
  });

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
    catalog.clearSurfaceDefault('tui');
    expect(
      resolveTuiStartupConversationId({
        cfg,
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
    catalog.clearSurfaceDefault('tui');
    expect(
      resolveDefaultTuiAgentId(),
    ).toBe('main');
  });
});

describe('resolveInitialTuiAgentId', () => {
  const cfg = ConfigSchema.parse({});

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
