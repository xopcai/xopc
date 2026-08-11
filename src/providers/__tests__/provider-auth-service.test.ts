import { describe, expect, it, vi } from 'vitest';

import type { OAuthToken } from '../../auth/credentials.js';
import { XopcModelCredentialStore } from '../../auth/model-credential-store.js';
import { resetModelCatalogStore } from '../model-catalog-store.js';
import { ProviderAuthService } from '../provider-auth-service.js';

function createRepository(expiresAt: number, provider = 'xopc-cloud') {
  let token: OAuthToken | null = {
    type: 'oauth',
    provider,
    access: 'access-1',
    refresh: 'refresh-1',
    expiresAt,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
  return {
    deleteOAuthToken: vi.fn(async () => {
      token = null;
    }),
    listOAuthTokens: vi.fn(async () => token
      ? [{
          type: token.type,
          provider: token.provider,
          expiresAt: token.expiresAt,
          createdAt: token.createdAt,
          updatedAt: token.updatedAt,
          hasAccess: true,
          hasRefresh: Boolean(token.refresh),
        }]
      : []),
    loadOAuthTokenRecord: vi.fn(async () => token),
    saveOAuthToken: vi.fn(async (provider: string, updated: Omit<OAuthToken, 'type' | 'provider' | 'updatedAt'>) => {
      token = {
        ...updated,
        type: 'oauth',
        provider,
        updatedAt: '2026-08-11T01:00:00.000Z',
      };
    }),
  };
}

describe('ProviderAuthService', () => {
  it('resolves xopc-cloud through its OAuth runtime even before model discovery', async () => {
    resetModelCatalogStore();
    const store = new XopcModelCredentialStore(
      createRepository(Date.now() + 60 * 60_000),
    );
    const service = new ProviderAuthService({ credentials: store });

    await expect(service.resolveApiKey('xopc-cloud')).resolves.toBe('access-1');
  });

  it('serializes concurrent refreshes and persists a rotating refresh token', async () => {
    resetModelCatalogStore();
    const repository = createRepository(Date.now() + 1_000);
    const store = new XopcModelCredentialStore(repository);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 3_600,
      scope: 'models:invoke offline_access',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ProviderAuthService({ credentials: store });

    try {
      await expect(Promise.all([
        service.resolveApiKey('xopc-cloud'),
        service.resolveApiKey('xopc-cloud'),
      ])).resolves.toEqual(['access-2', 'access-2']);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(repository.saveOAuthToken).toHaveBeenCalledWith(
      'xopc-cloud',
      expect.objectContaining({ access: 'access-2', refresh: 'refresh-2' }),
    );
  });

  it('uses the existing resolver when no OAuth credential is stored', async () => {
    const repository = createRepository(Date.now() + 60 * 60_000);
    await repository.deleteOAuthToken();
    const resolver = { resolveApiKey: vi.fn(async () => 'configured-api-key') };
    const service = new ProviderAuthService({
      credentials: new XopcModelCredentialStore(repository),
      resolver,
    });

    await expect(service.resolveApiKey('openai')).resolves.toBe('configured-api-key');
    expect(resolver.resolveApiKey).toHaveBeenCalledWith('openai');
  });

  it('preserves API-key priority for providers that support both auth modes', async () => {
    const repository = createRepository(Date.now() + 60 * 60_000, 'anthropic');
    const resolver = { resolveApiKey: vi.fn(async () => 'configured-api-key') };
    const service = new ProviderAuthService({
      credentials: new XopcModelCredentialStore(repository),
      resolver,
    });

    await expect(service.resolveApiKey('anthropic')).resolves.toBe('configured-api-key');
    expect(resolver.resolveApiKey).toHaveBeenCalledWith('anthropic');
  });
});
