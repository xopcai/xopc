import { describe, expect, it } from 'vitest';

import { ManifestRegistry } from '../../../extensions/manifest-registry.js';
import type { ExtensionMetadataSnapshot } from '../../../extensions/extension-metadata-snapshot.js';
import { normalizeExtensionManifest } from '../../../extensions/normalize-manifest.js';

import { buildChannelCatalogFromSnapshot } from '../channel-catalog-service.js';

describe('channel catalog service', () => {
  it('builds channel catalog entries from extension manifest contributions', () => {
    const manifest = normalizeExtensionManifest({
      id: 'demo-channel-extension',
      name: 'Demo Channel Extension',
      kind: 'channel',
      channels: ['demo'],
      channelContributions: {
        demo: {
          label: 'Demo',
          description: 'Demo channel',
          docsPath: '/channels/demo',
          order: 42,
          configPath: 'channels.demo',
          capabilities: { pairing: true },
          configSchema: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
            },
          },
          uiHints: {
            token: { sensitive: true },
          },
          actions: {
            'doctor.run': { label: 'Run doctor', result: 'diagnostics' },
          },
        },
      },
    });
    const registry = new ManifestRegistry();
    registry.addEntry({
      id: 'demo-channel-extension',
      manifest,
      source: 'workspace',
      path: '/tmp/demo',
    });
    const snapshot: ExtensionMetadataSnapshot = {
      discovered: [],
      manifestRegistry: registry,
    };

    const catalog = buildChannelCatalogFromSnapshot(snapshot);

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.byId.get('demo')).toMatchObject({
      id: 'demo',
      extensionId: 'demo-channel-extension',
      label: 'Demo',
      configPath: 'channels.demo',
      capabilities: { pairing: true },
    });
  });
});
