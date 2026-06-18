import { describe, expect, it } from 'vitest';

import { ManifestRegistry } from '../../../extensions/manifest-registry.js';
import type { ExtensionMetadataSnapshot } from '../../../extensions/extension-metadata-snapshot.js';
import { normalizeExtensionManifest } from '../../../extensions/normalize-manifest.js';

import { buildChannelCatalogFromSnapshot } from '../channel-catalog-service.js';

describe('channel catalog service', () => {
  function snapshotWithManifest(manifest: ReturnType<typeof normalizeExtensionManifest>): ExtensionMetadataSnapshot {
    const registry = new ManifestRegistry();
    registry.addEntry({
      id: manifest.id,
      manifest,
      source: 'workspace',
      path: '/tmp/demo',
    });
    return {
      discovered: [],
      manifestRegistry: registry,
    };
  }

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
    const catalog = buildChannelCatalogFromSnapshot(snapshotWithManifest(manifest));

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.byId.get('demo')).toMatchObject({
      id: 'demo',
      extensionId: 'demo-channel-extension',
      label: 'Demo',
      configPath: 'channels.demo',
      capabilities: { pairing: true },
    });
  });

  it('localizes channel contribution metadata from manifest i18n', () => {
    const manifest = normalizeExtensionManifest({
      id: 'demo-channel-extension',
      name: 'Demo Channel Extension',
      kind: 'channel',
      channels: ['demo'],
      channelContributions: {
        demo: {
          label: 'Demo',
          description: 'Demo channel',
          configSchema: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean', title: 'Enabled' },
              token: { type: 'string', title: 'Token', description: 'Bot token' },
            },
          },
          uiHints: {
            token: { help: 'Token help', sensitive: true },
          },
          actions: {
            'setup.start': { label: 'Set up', result: 'qr' },
          },
          i18n: {
            zh_CN: {
              label: '演示',
              description: '演示通道',
              configSchema: {
                properties: {
                  enabled: { title: '启用' },
                  token: { title: '令牌' },
                },
              },
              uiHints: {
                token: { help: '令牌说明' },
              },
              actions: {
                'setup.start': { label: '配置' },
              },
            },
          },
        },
      },
    });

    const entry = buildChannelCatalogFromSnapshot(snapshotWithManifest(manifest), { locale: 'zh-CN' }).entries[0];

    expect(entry).toMatchObject({ label: '演示', description: '演示通道' });
    expect(entry.configSchema).toMatchObject({
      properties: {
        enabled: { type: 'boolean', title: '启用' },
        token: { type: 'string', title: '令牌', description: 'Bot token' },
      },
    });
    expect(entry.uiHints.token).toMatchObject({ help: '令牌说明', sensitive: true });
    expect(entry.actions['setup.start']).toMatchObject({ label: '配置', result: 'qr' });
  });
});
