import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectorApi = vi.hoisted(() => ({
  fetchConnectorCatalog: vi.fn(),
  fetchConnectorInstances: vi.fn(),
}));

vi.mock('@/features/connectors/connectors-api', () => connectorApi);

import {
  clearConnectorPaletteCache,
  getConnectorPaletteIndex,
} from '@/features/search/global-command-palette/connector-palette-api';

describe('connector palette API', () => {
  beforeEach(() => {
    clearConnectorPaletteCache();
    connectorApi.fetchConnectorCatalog.mockReset();
    connectorApi.fetchConnectorInstances.mockReset();
  });

  it('caches a complete connector index', async () => {
    connectorApi.fetchConnectorCatalog.mockResolvedValue([{ id: 'files' }]);
    connectorApi.fetchConnectorInstances.mockResolvedValue([{ instanceId: 'files-main' }]);

    await expect(getConnectorPaletteIndex()).resolves.toEqual({
      catalog: [{ id: 'files' }],
      instances: [{ instanceId: 'files-main' }],
    });
    await getConnectorPaletteIndex();

    expect(connectorApi.fetchConnectorCatalog).toHaveBeenCalledOnce();
    expect(connectorApi.fetchConnectorInstances).toHaveBeenCalledOnce();
  });

  it('returns partial data for one failed source and retries on the next request', async () => {
    connectorApi.fetchConnectorCatalog
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce([{ id: 'files' }]);
    connectorApi.fetchConnectorInstances.mockResolvedValue([]);

    await expect(getConnectorPaletteIndex()).resolves.toEqual({ catalog: [], instances: [] });
    await expect(getConnectorPaletteIndex()).resolves.toEqual({
      catalog: [{ id: 'files' }],
      instances: [],
    });

    expect(connectorApi.fetchConnectorCatalog).toHaveBeenCalledTimes(2);
    expect(connectorApi.fetchConnectorInstances).toHaveBeenCalledTimes(2);
  });

  it('rejects when both sources fail and allows a later retry', async () => {
    connectorApi.fetchConnectorCatalog
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce([]);
    connectorApi.fetchConnectorInstances
      .mockRejectedValueOnce(new Error('instances unavailable'))
      .mockResolvedValueOnce([]);

    await expect(getConnectorPaletteIndex()).rejects.toThrow('catalog unavailable');
    await expect(getConnectorPaletteIndex()).resolves.toEqual({ catalog: [], instances: [] });
  });
});
