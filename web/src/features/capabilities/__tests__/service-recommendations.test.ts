import { describe, expect, it } from 'vitest';

import { canonicalServiceId, recommendServices, type ServiceSource } from '../service-recommendations';
import { connectorCapabilityItems, extensionCapabilityItems, filterCapabilityCatalog } from '../capability-catalog';
import type { ConnectorDefinition, StoreConnectorCatalogItem } from '@/features/connectors/connectors-api';

function service(id: string, source: ServiceSource) { return { service: { id, source } }; }

describe('service recommendations', () => {
  it('prioritizes domestic services for Chinese while preserving English order', () => {
    const items = [service('gmail', 'store-plugin'), service('tencent-docs', 'store-connector'), service('dingtalk', 'store-plugin'), service('wecom', 'store-plugin'), service('feishu', 'store-plugin')];
    expect(recommendServices(items, 'zh').map(item => item.service.id)).toEqual(['feishu', 'wecom', 'dingtalk', 'tencent-docs', 'gmail']);
    expect(recommendServices(items, 'en')).toEqual(items);
  });

  it('retains the highest-priority source regardless of arrival order', () => {
    const store = service('notion', 'store-connector');
    const builtin = service('notion', 'builtin-connector');
    const plugin = service('notion-office', 'store-plugin');
    const registry = service('composio-notion', 'registry-connector');
    for (const items of [[store, builtin, plugin, registry], [registry, plugin, builtin, store], [plugin, store, registry, builtin]]) {
      expect(recommendServices(items, 'zh')).toEqual([plugin]);
    }
    expect(recommendServices([store, builtin], 'zh')).toEqual([builtin]);
    expect(recommendServices([registry, store], 'zh')).toEqual([store]);
  });

  it('preserves Supabase read-only and does not merge unrelated packages by display name', () => {
    const items = [service('supabase', 'store-plugin'), service('supabase-readonly', 'store-connector'), service('unknown-a', 'store-plugin'), service('unknown-b', 'store-connector'), { id: 'supabase', kind: 'skill', service: undefined }];
    expect(recommendServices(items, 'zh')).toHaveLength(5);
    expect(canonicalServiceId('amap-maps')).toBe('amap');
  });

  it('uses regional metadata for newly published domestic services', () => {
    const international = service('international', 'store-plugin');
    const domestic = { service: { id: 'new-domestic-service', source: 'store-connector' as const, regions: ['china'] } };
    expect(recommendServices([international, domestic], 'zh')).toEqual([domestic, international]);
  });

  it('localizes Store entries, uses package names for installation, and deduplicates across kinds', () => {
    const store = connectorCapabilityItems([], [{ id: 'database-row-id', name: 'feishu', type: 'connector', category: 'docs', description: 'English', author: { username: 'team', avatarUrl: null }, downloads: 0, updatedAt: 1, localizations: { 'zh-CN': { displayName: '飞书连接器', description: '中文说明' } } }], [], 'zh');
    expect(store[0]).toMatchObject({ id: 'feishu', name: '飞书连接器', description: '中文说明' });
    expect(store[0].href).toContain('storeConnector=feishu');
    const plugins = extensionCapabilityItems([{ id: 'feishu', name: 'Feishu', npmPackage: 'feishu', packageType: 'plugin', localizations: { 'zh-CN': { displayName: '飞书' } } }], new Set(['feishu']), 'zh');
    expect(filterCapabilityCatalog([...store, ...plugins], 'all', '', 'zh')).toEqual(plugins);
    expect(plugins[0]).toMatchObject({ name: '飞书', status: 'installed' });
    expect(filterCapabilityCatalog([...store, ...plugins], 'connector', '', 'zh')).toEqual([]);
  });

  it('prefers a builtin even when Store rows use unrelated database IDs', () => {
    const builtin = { id: 'amap', displayName: '高德', description: '', source: 'builtin', category: 'custom', kind: 'mcp' } as ConnectorDefinition;
    const store = { id: 'database-id', name: 'amap', author: { username: 'team' }, description: '', category: 'custom' } as StoreConnectorCatalogItem;
    expect(connectorCapabilityItems([builtin], [store], [], 'zh').map(item => item.service?.source)).toEqual(['builtin-connector']);
  });
});
