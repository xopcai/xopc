import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryManager } from '../manager.js';
import { discoverMemoryPlugins, loadMemoryPluginProviders } from '../plugin-discovery.js';

describe('memory provider plugins', () => {
  const previousBundledRoot = process.env.XOPC_BUNDLED_EXTENSIONS_ROOT;

  beforeEach(() => {
    process.env.XOPC_BUNDLED_EXTENSIONS_ROOT = resolve('extensions');
  });

  afterEach(() => {
    if (previousBundledRoot === undefined) {
      delete process.env.XOPC_BUNDLED_EXTENSIONS_ROOT;
    } else {
      process.env.XOPC_BUNDLED_EXTENSIONS_ROOT = previousBundledRoot;
    }
  });

  it('discovers and loads the demo memory provider', async () => {
    const plugins = await discoverMemoryPlugins();
    const demo = plugins.find((plugin) => plugin.name === 'demo-memory');

    expect(demo).toMatchObject({
      name: 'demo-memory',
      available: true,
      manifest: {
        type: 'memory-provider',
        id: 'demo-memory',
        displayName: 'Demo Memory Provider',
      },
    });

    const providers = await loadMemoryPluginProviders();
    expect(providers.map((provider) => provider.id)).toContain('demo-memory');
  });

  it('routes external writes, search, reads, and signals through a loaded provider', async () => {
    const manager = new MemoryManager({
      searchStrategy: 'external-only',
      writeStrategy: 'external-only',
      writePolicy: { allowExternalWrites: true, allowedProviderIds: ['demo-memory'] },
      loadProviders: loadMemoryPluginProviders,
    });

    await manager.initializeAll('session-1', {
      workspace: '/tmp/xopc-memory-demo',
      config: { agentId: 'agent-demo' },
    });

    expect(manager.providersList.map((provider) => provider.id)).toContain('demo-memory');

    const write = await manager.write({
      kind: 'workspace_fact',
      content: 'The demo provider stores searchable memory records.',
      tags: ['demo'],
    });
    expect(write.success).toBe(true);
    expect(write.record?.id).toMatch(/^demo-memory-/);

    const results = await manager.search({ query: 'searchable memory', maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.citation.providerId).toBe('demo-memory');

    const read = await manager.read({ id: write.record?.id });
    expect(read?.record.content).toContain('searchable memory records');

    manager.recordSignal({
      source: 'search_recall',
      content: 'Signals can be promoted into demo provider memory.',
    });

    const signalResults = await manager.search({ query: 'promoted into demo provider', maxResults: 5 });
    expect(signalResults[0]?.record.kind).toBe('derived_insight');
  });
});
