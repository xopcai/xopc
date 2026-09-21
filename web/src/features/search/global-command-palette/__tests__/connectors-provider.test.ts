import { describe, expect, it, vi } from 'vitest';

import type {
  ConnectorDefinition,
  ConnectorInstance,
} from '@/features/connectors/connectors-api';
import { buildConnectorHits } from '@/features/search/global-command-palette/connectors-provider';

const labels = {
  group: 'Connectors',
  builtin: 'Built-in',
  connected: 'Connected',
  installed: 'Installed',
  needsSetup: 'Needs setup',
  disabled: 'Disabled',
};

function definition(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    id: 'filesystem',
    version: '1.0.0',
    displayName: 'Filesystem',
    description: 'Search local files',
    category: 'docs',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools'],
    tags: ['files'],
    auth: { mode: 'none' },
    setup: {},
    runtime: { type: 'mcp', serverId: 'filesystem' },
    integrationStrategy: { lane: 'mcp', workload: 'high_frequency', preferred: true },
    ...overrides,
  };
}

function instance(overrides: Partial<ConnectorInstance> = {}): ConnectorInstance {
  return {
    instanceId: 'filesystem-work',
    connectorId: 'filesystem',
    displayName: 'Filesystem',
    enabled: true,
    status: 'connected',
    connectionStatus: 'connected',
    authStatus: 'none',
    secretStatus: {},
    materialized: { type: 'mcp', serverId: 'filesystem-work' },
    usage: {},
    audit: [],
    ...overrides,
  };
}

describe('buildConnectorHits', () => {
  it('does not fill an empty command palette with connector catalog entries', () => {
    expect(buildConnectorHits({
      query: '', catalog: [definition()], instances: [], labels, navigate: vi.fn(), close: vi.fn(),
    })).toEqual([]);
  });

  it('prefers an installed instance over its built-in catalog entry', () => {
    const hits = buildConnectorHits({
      query: 'file', catalog: [definition()], instances: [instance()], labels, navigate: vi.fn(), close: vi.fn(),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: 'connector-instance:filesystem-work',
      kind: 'connector',
      subtitle: 'Connected · Search local files',
    });
  });

  it('keeps installed store connectors even when their definition is not in the built-in catalog', () => {
    const hits = buildConnectorHits({
      query: 'atlas',
      catalog: [],
      instances: [instance({ instanceId: 'atlas-main', connectorId: 'atlas', displayName: 'Atlas' })],
      labels,
      navigate: vi.fn(),
      close: vi.fn(),
    });

    expect(hits[0]).toMatchObject({
      id: 'connector-instance:atlas-main',
      title: 'Atlas',
      keywords: expect.arrayContaining(['atlas', 'atlas-main']),
    });
  });

  it('excludes non-product credential connectors and non-preferred built-ins', () => {
    const hits = buildConnectorHits({
      query: 'connector',
      catalog: [
        definition({ id: 'credential', runtime: { type: 'composio', toolkit: 'auth', role: 'credential' } }),
        definition({ id: 'secondary', integrationStrategy: { lane: 'mcp', workload: 'long_tail', preferred: false } }),
      ],
      instances: [],
      labels,
      navigate: vi.fn(),
      close: vi.fn(),
    });

    expect(hits).toEqual([]);
  });

  it('closes the palette and deep-links to the selected instance', () => {
    const navigate = vi.fn();
    const close = vi.fn();
    const [hit] = buildConnectorHits({
      query: 'file', catalog: [definition()], instances: [instance()], labels, navigate, close,
    });

    hit.run();
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/connectors?instance=filesystem-work&tab=connected');
  });

  it('deep-links an uninstalled built-in connector to discovery details', () => {
    const navigate = vi.fn();
    const close = vi.fn();
    const [hit] = buildConnectorHits({
      query: 'file', catalog: [definition()], instances: [], labels, navigate, close,
    });

    hit.run();
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/connectors?connector=filesystem&tab=discover');
  });

  it.each([
    [{ enabled: false, status: 'disabled' as const }, 'Disabled'],
    [{ status: 'unauthorized' as const }, 'Needs setup'],
    [{ status: 'installed' as const, connectionStatus: 'unknown' as const }, 'Installed'],
  ])('describes installed connector state %j as %s', (overrides, expected) => {
    const [hit] = buildConnectorHits({
      query: 'file',
      catalog: [definition()],
      instances: [instance(overrides)],
      labels,
      navigate: vi.fn(),
      close: vi.fn(),
    });

    expect(hit.subtitle).toMatch(new RegExp(`^${expected}`));
  });
});
