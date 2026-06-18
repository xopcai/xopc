import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelPlugin } from '../../../../../channels/plugin-types.js';

const mocks = vi.hoisted(() => {
  const plugin = {
    id: 'mock-channel',
    meta: {
      id: 'mock-channel',
      label: 'Mock Channel',
      blurb: 'Mock channel onboarding',
      order: 10,
    },
    capabilities: {},
    onboard: {
      isConfigured: () => false,
      configure: async (config: unknown) => config,
    },
  } as unknown as ChannelPlugin;

  class ExtensionLoaderMock {
    registry = { channelPlugins: [plugin] };
    setConfig = vi.fn();
    setManifestSnapshot = vi.fn();
    loadExtensions = vi.fn();
    getRegistry() {
      return this.registry;
    }
  }

  return {
    plugin,
    listChannelPlugins: vi.fn(() => [] as ChannelPlugin[]),
    buildExtensionMetadataSnapshot: vi.fn(() => ({
      discovered: [],
      manifestRegistry: {
        getAllEntries: () => [
          {
            id: 'mock-extension',
            name: 'Mock Extension',
            source: 'bundled',
            path: '/tmp/mock-extension',
            manifest: {
              id: 'mock-extension',
              name: 'Mock Extension',
              channelContributions: {
                'mock-channel': { label: 'Mock Channel' },
              },
            },
          },
        ],
      },
    })),
    resolveExtensionLoaderOptionsFromConfig: vi.fn(() => ({})),
    ExtensionLoaderMock,
  };
});

vi.mock('../../../../../channels/plugins/registry.js', () => ({
  listChannelPlugins: mocks.listChannelPlugins,
}));

vi.mock('../../../../../extensions/extension-metadata-snapshot.js', () => ({
  buildExtensionMetadataSnapshot: mocks.buildExtensionMetadataSnapshot,
  resolveExtensionLoaderOptionsFromConfig: mocks.resolveExtensionLoaderOptionsFromConfig,
}));

vi.mock('../../../../../extensions/loader.js', () => ({
  ExtensionLoader: mocks.ExtensionLoaderMock,
}));

describe('getChannelConfigurators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listChannelPlugins.mockReturnValue([]);
  });

  it('loads channel extensions for onboard when global channel registry is empty', async () => {
    const { getChannelConfigurators } = await import('../registry.js');

    const configurators = await getChannelConfigurators({ channels: {} } as never);

    expect(configurators.map((c) => c.id)).toEqual(['mock-channel']);
    expect(mocks.buildExtensionMetadataSnapshot).toHaveBeenCalledOnce();
  });

  it('uses already registered channel plugins when available', async () => {
    mocks.listChannelPlugins.mockReturnValue([mocks.plugin]);
    const { getChannelConfigurators } = await import('../registry.js');

    const configurators = await getChannelConfigurators({ channels: {} } as never);

    expect(configurators.map((c) => c.id)).toEqual(['mock-channel']);
    expect(mocks.buildExtensionMetadataSnapshot).not.toHaveBeenCalled();
  });
});
