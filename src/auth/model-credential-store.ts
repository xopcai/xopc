import {
  type ApiKeyCredential,
  type AuthOperationOptions,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type OAuthCredential,
} from '@earendil-works/pi-ai';

import { CredentialResolver, type OAuthToken } from './credentials.js';

const providerModificationTails = new Map<string, Promise<void>>();

type OAuthCredentialRepository = Pick<
  CredentialResolver,
  'deleteOAuthToken' | 'listOAuthTokens' | 'loadOAuthTokenRecord' | 'saveOAuthToken'
>;
type PersistedOAuthToken = OAuthToken & Record<string, unknown>;

function normalizeProviderId(providerId: string): string {
  return providerId.toLowerCase();
}

function toRuntimeCredential(token: OAuthToken): OAuthCredential {
  const {
    type: _type,
    provider: _provider,
    expiresAt,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...credential
  } = token as PersistedOAuthToken;

  return {
    ...credential,
    type: 'oauth',
    access: token.access,
    refresh: token.refresh ?? '',
    expires: expiresAt ?? Number.MAX_SAFE_INTEGER,
  };
}

function toPersistedToken(
  credential: OAuthCredential,
  current: OAuthToken | null,
): Omit<OAuthToken, 'type' | 'provider' | 'updatedAt'> & Record<string, unknown> {
  const { type: _type, expires, ...token } = credential;
  let previous: Record<string, unknown> = {};
  if (current) {
    const {
      type: _previousType,
      expires: _previousExpires,
      ...previousFields
    } = toRuntimeCredential(current);
    previous = previousFields;
  }
  return {
    ...previous,
    ...token,
    access: credential.access,
    refresh: credential.refresh || undefined,
    expiresAt: expires,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  };
}

async function serializeProviderModification<T>(
  providerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = providerModificationTails.get(providerId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  providerModificationTails.set(providerId, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (providerModificationTails.get(providerId) === tail) {
      providerModificationTails.delete(providerId);
    }
  }
}

/**
 * ModelRuntime credential store backed by xopc OAuth persistence.
 * API keys remain process-local because their canonical sources are xopc config and environment.
 */
export class XopcModelCredentialStore implements CredentialStore {
  private readonly runtimeApiKeys = new Map<string, ApiKeyCredential>();

  constructor(
    private readonly repository: OAuthCredentialRepository = new CredentialResolver(),
  ) {}

  async read(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    const normalizedProvider = normalizeProviderId(providerId);
    const runtimeApiKey = this.runtimeApiKeys.get(normalizedProvider);
    if (runtimeApiKey) return runtimeApiKey;
    const token = await this.repository.loadOAuthTokenRecord(normalizedProvider);
    options?.signal?.throwIfAborted();
    return token ? toRuntimeCredential(token) : undefined;
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const oauthTokens = await this.repository.listOAuthTokens();
    options?.signal?.throwIfAborted();

    const credentials = new Map<string, CredentialInfo>();
    for (const token of oauthTokens) {
      credentials.set(normalizeProviderId(token.provider), {
        providerId: normalizeProviderId(token.provider),
        type: 'oauth',
      });
    }
    for (const providerId of this.runtimeApiKeys.keys()) {
      credentials.set(providerId, { providerId, type: 'api_key' });
    }
    return [...credentials.values()];
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const normalizedProvider = normalizeProviderId(providerId);
    return serializeProviderModification(normalizedProvider, async () => {
      options?.signal?.throwIfAborted();
      const persisted = await this.repository.loadOAuthTokenRecord(normalizedProvider);
      const current = this.runtimeApiKeys.get(normalizedProvider)
        ?? (persisted ? toRuntimeCredential(persisted) : undefined);
      const updated = await update(current);
      options?.signal?.throwIfAborted();

      if (!updated) return current;
      if (updated.type === 'oauth') {
        await this.repository.saveOAuthToken(
          normalizedProvider,
          toPersistedToken(updated, persisted),
        );
        this.runtimeApiKeys.delete(normalizedProvider);
      } else {
        this.runtimeApiKeys.set(normalizedProvider, updated);
      }
      return updated;
    });
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    const normalizedProvider = normalizeProviderId(providerId);
    await serializeProviderModification(normalizedProvider, async () => {
      options?.signal?.throwIfAborted();
      await this.repository.deleteOAuthToken(normalizedProvider);
      this.runtimeApiKeys.delete(normalizedProvider);
    });
  }
}
