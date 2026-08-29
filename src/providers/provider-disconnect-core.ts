import { evictAllEmbeddedSessionRunners } from '../agent/embedded/session-runner.js';
import { CredentialResolver } from '../auth/credentials.js';
import { withOAuthProviderLock } from '../auth/oauth-provider-lock.js';
import { createLogger } from '../utils/logger.js';
import { getModelRegistry } from './model-registry.js';
import { getProviderAuthService } from './provider-auth-service.js';

const log = createLogger('ProviderDisconnect');

export interface ProviderDisconnectOptions {
  resolver?: Pick<CredentialResolver, 'deleteProviderCredential'>;
  invalidateAuth?: () => void;
  clearCloudCatalog?: () => Promise<void>;
  refreshModels?: () => void;
  evictRunners?: () => void;
  withLock?: <T>(providerId: string, operation: () => Promise<T>) => Promise<T>;
}

/** Low-level disconnect operation. Cloud callers must inject catalog cleanup. */
export async function disconnectProviderCore(
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
      if (!options.clearCloudCatalog) {
        throw new Error('XOPC Cloud disconnect requires a catalog cleanup hook');
      }
      await options.clearCloudCatalog();
    } else {
      (options.refreshModels ?? (() => getModelRegistry().refresh()))();
    }
    (options.evictRunners ?? (() => evictAllEmbeddedSessionRunners('provider_disconnected')))();
  });

  log.info({ provider, phase: 'provider_revoked' }, `Disconnected provider: ${provider}`);
}
