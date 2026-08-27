import { evictAllEmbeddedSessionRunners } from '../agent/embedded/session-runner.js';
import { CredentialResolver } from '../auth/credentials.js';
import { withOAuthProviderLock } from '../auth/oauth-provider-lock.js';
import { createLogger } from '../utils/logger.js';
import { getModelRegistry } from './model-registry.js';
import { getProviderAuthService } from './provider-auth-service.js';
import { getXopcCloudCatalogCoordinator } from './xopc-cloud-catalog-coordinator.js';

const log = createLogger('ProviderDisconnect');

interface ProviderDisconnectOptions {
  resolver?: Pick<CredentialResolver, 'deleteProviderCredential'>;
  invalidateAuth?: () => void;
  clearCloudCatalog?: () => Promise<void>;
  refreshModels?: () => void;
  evictRunners?: () => void;
  withLock?: <T>(providerId: string, operation: () => Promise<T>) => Promise<T>;
}

export async function disconnectProvider(
  providerId: string,
  options: ProviderDisconnectOptions = {},
): Promise<void> {
  const provider = providerId.trim().toLowerCase();
  if (!provider) throw new Error('Provider id is required');
  const resolver = options.resolver ?? new CredentialResolver();
  const withLock = options.withLock ?? ((id, operation) => withOAuthProviderLock(id, operation));

  await withLock(provider, async () => {
    await resolver.deleteProviderCredential(provider);
    (options.invalidateAuth ?? (() => getProviderAuthService().invalidate()))();
    if (provider === 'xopc-cloud') {
      await (options.clearCloudCatalog
        ?? (() => getXopcCloudCatalogCoordinator().clear('revoke')))();
    } else {
      (options.refreshModels ?? (() => getModelRegistry().refresh()))();
    }
    (options.evictRunners ?? (() => evictAllEmbeddedSessionRunners('provider_disconnected')))();
  });

  log.info({ provider, phase: 'provider_revoked' }, `Disconnected provider: ${provider}`);
}
