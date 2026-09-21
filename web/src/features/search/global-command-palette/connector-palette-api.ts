import {
  fetchConnectorCatalog,
  fetchConnectorInstances,
  type ConnectorDefinition,
  type ConnectorInstance,
} from '@/features/connectors/connectors-api';

export type ConnectorPaletteIndex = {
  catalog: ConnectorDefinition[];
  instances: ConnectorInstance[];
};

let cachedIndex: Promise<ConnectorPaletteIndex> | null = null;

export function clearConnectorPaletteCache(): void {
  cachedIndex = null;
}

export function getConnectorPaletteIndex(): Promise<ConnectorPaletteIndex> {
  if (cachedIndex) return cachedIndex;

  cachedIndex = Promise.allSettled([
    fetchConnectorCatalog(),
    fetchConnectorInstances(),
  ]).then(([catalog, instances]) => {
    if (catalog.status === 'rejected' && instances.status === 'rejected') {
      throw catalog.reason;
    }
    const index = {
      catalog: catalog.status === 'fulfilled' ? catalog.value : [],
      instances: instances.status === 'fulfilled' ? instances.value : [],
    };
    if (catalog.status === 'rejected' || instances.status === 'rejected') {
      cachedIndex = null;
    }
    return index;
  }).catch((error: unknown) => {
    cachedIndex = null;
    throw error;
  });

  return cachedIndex;
}
