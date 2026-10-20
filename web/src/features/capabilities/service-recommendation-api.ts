import {
  fetchConnectorCatalog,
  fetchStoreConnectorCatalog,
  type StoreConnectorCatalogItem,
} from '@/features/connectors/connectors-api';
import { getExtensionMarketplaceItems } from '@/features/extensions/extension-marketplace-api';

import { connectorCapabilityItems, extensionCapabilityItems } from './capability-catalog';
import { recommendServices } from './service-recommendations';

/** Ranking must see later pages too, including newly published domestic services. */
export async function fetchRecommendationStoreConnectors(query = ''): Promise<StoreConnectorCatalogItem[]> {
  const first = await fetchStoreConnectorCatalog({ q: query, page: 1, pageSize: 50, sort: 'downloads' });
  const remaining = await Promise.all(Array.from({ length: Math.max(0, first.meta.totalPages - 1) }, (_, index) => (
    fetchStoreConnectorCatalog({ q: query, page: index + 2, pageSize: 50, sort: 'downloads' })
  )));
  return [...first.items, ...remaining.flatMap(page => page.items)];
}

export async function fetchServiceRecommendations(language: string) {
  const [plugins, builtins, store] = await Promise.allSettled([
    getExtensionMarketplaceItems(), fetchConnectorCatalog(), fetchRecommendationStoreConnectors(),
  ]);
  const failedSources = [plugins, builtins, store].filter(result => result.status === 'rejected').length;
  if (failedSources === 3) throw new Error('Service recommendations unavailable');
  const definitions = builtins.status === 'fulfilled' ? builtins.value : [];
  const items = recommendServices([
    ...extensionCapabilityItems(plugins.status === 'fulfilled' ? plugins.value.filter(item => item.packageType === 'plugin') : [], new Set(), language),
    ...connectorCapabilityItems(definitions, store.status === 'fulfilled' ? store.value : [], [], language),
  ], language);
  return { items, definitions, failedSources };
}
