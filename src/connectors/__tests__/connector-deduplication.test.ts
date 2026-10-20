import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, replaceConnectorCatalogEntries, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getConnectorDefinition, listConnectorCatalog } from '../catalog.js';
import { getCliAdapter } from '../cli/adapterRegistry.js';
import { connectorDefinitionFromComposioToolkit, listComposioConnectorCatalog } from '../composio-catalog.js';
import { ComposioSessionsAdapter } from '../composio-sessions.js';
import { installConnector } from '../install.js';

beforeEach(() => {
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: ':memory:' });
});
afterEach(() => {
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  vi.restoreAllMocks();
});

describe('Store plugin priority', () => {
  it.each(['feishu-workspace', 'dingtalk-workspace', 'yuque', 'composio-notion', 'composio-todoist', 'wecom-workspace', 'wps365-workspace'])('removes the duplicate connector %s', async (id) => {
    expect(listConnectorCatalog().some((definition) => definition.id === id)).toBe(false);
    expect(getConnectorDefinition(id)).toBeUndefined();
    await expect(installConnector({} as Config, id, {})).rejects.toThrow('Unknown connector');
  });

  it('removes provider-specific CLI adapters from core', () => {
    expect(() => getCliAdapter('lark')).toThrow('Unknown CLI adapter');
    expect(() => getCliAdapter('wecom')).toThrow('Unknown CLI adapter');
    expect(() => getCliAdapter('wps365')).toThrow('Unknown CLI adapter');
  });

  it('excludes live, cached, and stale Composio duplicates before pagination', async () => {
    const toolkits = ['notion', 'todoist', 'gmail', 'github'].map((slug) => ({ slug, name: slug, isNoAuth: false, connected: false }));
    const adapter = { listToolkitCatalog: vi.fn().mockResolvedValue(toolkits) } as unknown as ComposioSessionsAdapter;
    const live = await listComposioConnectorCatalog({ adapter, refresh: true, pageSize: 1 });
    expect(live.connectors.map((definition) => definition.id)).toEqual(['composio-gmail']);
    expect(live.meta).toMatchObject({ total: 2, totalPages: 2 });
    const cached = await listComposioConnectorCatalog({ adapter, page: 2, pageSize: 1 });
    expect(cached.source).toBe('cache');
    expect(cached.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect(cached.connectors).toHaveLength(1);
    expect(['composio-gmail', 'composio-github']).toContain(cached.connectors[0]!.id);
    replaceConnectorCatalogEntries('composio', toolkits.map((toolkit) => {
      const definition = connectorDefinitionFromComposioToolkit(toolkit);
      return { connectorId: definition.id, provider: 'composio', definition, fetchedAt: '1999-12-31T00:00:00Z', expiresAt: '2000-01-01T00:00:00Z' };
    }));
    vi.mocked(adapter.listToolkitCatalog).mockRejectedValue(new Error('offline'));
    const stale = await listComposioConnectorCatalog({ adapter });
    expect(stale.stale).toBe(true);
    expect(stale.connectors.map((definition) => definition.id).sort()).toEqual(['composio-github', 'composio-gmail']);
  });

  it.each(['notion', 'todoist'])('rejects direct Composio authorization for %s', async (toolkit) => {
    const clientFactory = vi.fn();
    const adapter = new ComposioSessionsAdapter({ clientFactory });
    await expect(adapter.authorize({ principalId: 'local-owner', toolkit })).rejects.toThrow('Use Store plugin');
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
