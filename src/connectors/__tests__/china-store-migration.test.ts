import { describe, expect, it } from 'vitest';

import { getConnectorDefinition, listConnectorCatalog, listConnectorProviders } from '../catalog.js';
import { isExcludedStoreConnector } from '../excluded-connectors.js';

describe('China connectors move to Store', () => {
  it('removes the China provider and keeps only generic built-ins and Composio', () => {
    expect(listConnectorProviders().map(provider => provider.id)).toEqual(['builtin', 'composio']);
    const ids = listConnectorCatalog().map(definition => definition.id);
    expect(ids).toContain('filesystem');
    expect(ids).toContain('local-files');
    expect(ids).toContain('composio-gmail');
    for (const id of ['tencent-meeting', 'tencent-docs', 'amap-maps', 'bailian-web-search', 'dida365', 'flomo', 'railway-12306', 'antv-chart']) {
      expect(ids).not.toContain(id);
      expect(getConnectorDefinition(id)).toBeUndefined();
    }
  });

  it('allows the canonical Store Amap entry while keeping plugin duplicates excluded', () => {
    expect(isExcludedStoreConnector('amap')).toBe(false);
    expect(isExcludedStoreConnector('supabase-readonly')).toBe(false);
    expect(isExcludedStoreConnector('notion')).toBe(true);
    expect(isExcludedStoreConnector('todoist-mcp')).toBe(true);
  });
});
