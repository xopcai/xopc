import { getXopcCloudCatalogCoordinator } from './xopc-cloud-catalog-coordinator.js';
import {
  disconnectProviderCore,
  type ProviderDisconnectOptions,
} from './provider-disconnect-core.js';

export type { ProviderDisconnectOptions } from './provider-disconnect-core.js';

export async function disconnectProvider(
  providerId: string,
  options: ProviderDisconnectOptions = {},
): Promise<void> {
  return disconnectProviderCore(providerId, {
    ...options,
    clearCloudCatalog:
      options.clearCloudCatalog
      ?? (() => getXopcCloudCatalogCoordinator().clear('revoke')),
  });
}
