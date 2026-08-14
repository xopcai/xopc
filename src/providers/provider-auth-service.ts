import { InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import {
  CredentialResolver,
  type CredentialResolverOptions,
} from '../auth/credentials.js';
import { XopcModelCredentialStore } from '../auth/model-credential-store.js';
import { resolveModelsJsonPath } from '../config/paths.js';
import { registerBundledOAuthFlows } from './register-bundled-oauth-flows.js';
import { registerRuntimeProviders } from './register-runtime-providers.js';

type ApiKeyResolver = Pick<CredentialResolver, 'resolveApiKey'>;

export interface ProviderAuthServiceOptions {
  credentials?: XopcModelCredentialStore;
  resolver?: ApiKeyResolver;
  runtimeFactory?: (credentials: XopcModelCredentialStore) => Promise<ModelRuntime>;
}

async function createAuthRuntime(credentials: XopcModelCredentialStore): Promise<ModelRuntime> {
  registerBundledOAuthFlows();
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: resolveModelsJsonPath(),
    modelsStore: new InMemoryModelsStore(),
  });
  registerRuntimeProviders(runtime);
  return runtime;
}

/** Resolves request credentials while keeping OAuth refresh inside the shared persistent store. */
export class ProviderAuthService {
  private readonly credentials: XopcModelCredentialStore;
  private readonly resolver: ApiKeyResolver;
  private readonly runtimeFactory: (credentials: XopcModelCredentialStore) => Promise<ModelRuntime>;
  private runtime: Promise<ModelRuntime> | undefined;

  constructor(options: ProviderAuthServiceOptions = {}) {
    const defaultResolver = new CredentialResolver();
    this.resolver = options.resolver ?? defaultResolver;
    this.credentials = options.credentials
      ?? new XopcModelCredentialStore(defaultResolver);
    this.runtimeFactory = options.runtimeFactory ?? createAuthRuntime;
  }

  async resolveApiKey(providerId: string, signal?: AbortSignal): Promise<string | null> {
    const stored = await this.credentials.read(providerId, { signal });
    if (stored?.type === 'oauth') {
      const runtime = await this.getRuntime();
      const provider = runtime.getProvider(providerId);
      if (provider?.auth.oauth && !provider.auth.apiKey) {
        const result = await runtime.getAuth(providerId, { signal });
        return result?.auth.apiKey ?? null;
      }
    }
    return await this.resolver.resolveApiKey(providerId);
  }

  private getRuntime(): Promise<ModelRuntime> {
    this.runtime ??= this.runtimeFactory(this.credentials).catch((error) => {
      this.runtime = undefined;
      throw error;
    });
    return this.runtime;
  }
}

let defaultProviderAuthService: ProviderAuthService | undefined;

export function getProviderAuthService(): ProviderAuthService {
  defaultProviderAuthService ??= new ProviderAuthService();
  return defaultProviderAuthService;
}

export async function resolveProviderApiKey(
  providerId: string,
  credentialOptions?: CredentialResolverOptions,
): Promise<string | null> {
  if (!credentialOptions) {
    return await getProviderAuthService().resolveApiKey(providerId);
  }
  const resolver = new CredentialResolver(credentialOptions);
  const credentials = new XopcModelCredentialStore(resolver);
  return await new ProviderAuthService({ credentials, resolver }).resolveApiKey(providerId);
}
