import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialResolver } from '../credentials.js';
import { XopcModelCredentialStore } from '../model-credential-store.js';
import { getOAuthProviderDefinition, getOAuthProviderIds } from '../oauth/registry.js';

let tempDir: string;
let previousCredentialsDir: string | undefined;

// Environment variables to isolate from the host environment (e.g. GITHUB_TOKEN in CI)
const GITHUB_COPILOT_ENV_VARS = [
  'COPILOT_GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_COPILOT_TOKEN',
];
let previousEnvVars: Record<string, string | undefined> = {};

describe('CredentialResolver OAuth credentials', () => {
  beforeEach(async () => {
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-credentials-oauth-'));
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');

    // Isolate from CI host environment
    previousEnvVars = {};
    for (const key of GITHUB_COPILOT_ENV_VARS) {
      previousEnvVars[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.XOPC_CONSOLE_URL;
    if (previousCredentialsDir === undefined) {
      delete process.env.XOPC_CREDENTIALS_DIR;
    } else {
      process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    }
    // Restore host environment
    for (const key of GITHUB_COPILOT_ENV_VARS) {
      if (previousEnvVars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnvVars[key];
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists OAuth token as a first-class credential source', async () => {
    const resolver = new CredentialResolver();

    await resolver.saveOAuthToken('anthropic', {
      access: 'oauth-access-token',
      refresh: 'oauth-refresh-token',
      expiresAt: Date.now() + 5 * 60_000,
      scope: ['model:read'],
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(resolver.resolveApiKey('anthropic')).resolves.toBe('oauth-access-token');
    await expect(resolver.resolveApiKeySource('anthropic')).resolves.toBe('oauth');
    await expect(resolver.loadOAuthTokenRecord('anthropic')).resolves.toMatchObject({
      type: 'oauth',
      provider: 'anthropic',
      access: 'oauth-access-token',
      refresh: 'oauth-refresh-token',
      scope: ['model:read'],
    });
  });

  it.each(['google-gemini-cli', 'google-antigravity'])(
    'preserves raw OAuth fields and reads legacy encoded access for %s',
    async (providerId) => {
      const resolver = new CredentialResolver();
      await resolver.saveOAuthCredentials(providerId, {
        access: 'raw-google-access',
        refresh: 'google-refresh',
        expires: Date.now() + 5 * 60_000,
        projectId: 'project-1',
      });

      await expect(resolver.loadOAuthTokenRecord(providerId)).resolves.toMatchObject({
        access: 'raw-google-access',
        refresh: 'google-refresh',
        projectId: 'project-1',
      });
      await expect(resolver.resolveApiKey(providerId)).resolves.toBe(
        JSON.stringify({ token: 'raw-google-access', projectId: 'project-1' }),
      );

      await resolver.saveOAuthToken(providerId, {
        access: JSON.stringify({
          token: JSON.stringify({ token: 'legacy-access', projectId: 'legacy-project' }),
        }),
        refresh: 'legacy-refresh',
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: '2026-08-04T00:00:00.000Z',
      });
      await expect(resolver.loadOAuthTokenRecord(providerId)).resolves.toMatchObject({
        access: 'legacy-access',
        projectId: 'legacy-project',
      });
    },
  );

  it('disconnects both default API key profile and OAuth token for a provider', async () => {
    const resolver = new CredentialResolver();

    await resolver.saveApiKey('github-copilot', 'stored-api-key');
    await resolver.saveOAuthToken('github-copilot', {
      access: 'oauth-access-token',
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(resolver.resolveApiKeySource('github-copilot')).resolves.toBe('global');

    await resolver.deleteProviderCredential('github-copilot');

    await expect(resolver.resolveApiKey('github-copilot')).resolves.toBeNull();
    await expect(resolver.resolveApiKeySource('github-copilot')).resolves.toBeNull();
    await expect(resolver.loadOAuthTokenRecord('github-copilot')).resolves.toBeNull();
  });

  it('refreshes and persists a rotating XOPC OAuth token before it expires', async () => {
    process.env.XOPC_CONSOLE_URL = 'https://console.test';
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-token-1');
      return Response.json({
        access_token: 'access-token-2',
        refresh_token: 'refresh-token-2',
        expires_in: 900,
        scope: 'models:read models:invoke offline_access',
      });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const resolver = new CredentialResolver();
    await resolver.saveOAuthToken('xopc-cloud', {
      access: 'access-token-1',
      refresh: 'refresh-token-1',
      expiresAt: Date.now() + 30_000,
      createdAt: '2026-08-04T00:00:00.000Z',
    });

    await expect(Promise.all([
      resolver.resolveApiKey('xopc-cloud'),
      resolver.resolveApiKey('xopc-cloud'),
    ])).resolves.toEqual(['access-token-2', 'access-token-2']);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(resolver.loadOAuthTokenRecord('xopc-cloud')).resolves.toMatchObject({
      access: 'access-token-2',
      refresh: 'refresh-token-2',
      scope: ['models:read', 'models:invoke', 'offline_access'],
    });
  });

  it('does not refresh OAuth credentials while checking provider status', async () => {
    process.env.XOPC_CONSOLE_URL = 'https://console.test';
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);
    const resolver = new CredentialResolver();
    await resolver.saveOAuthToken('xopc-cloud', {
      access: 'expired-access-token',
      refresh: 'refresh-token-1',
      expiresAt: Date.now() - 1,
      createdAt: '2026-08-04T00:00:00.000Z',
    });

    await expect(resolver.hasCredentials('xopc-cloud')).resolves.toBe(true);
    await expect(resolver.resolveApiKeySource('xopc-cloud')).resolves.toBe('oauth');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(getOAuthProviderIds())(
    'coordinates refreshes across resolver and runtime paths for %s',
    async (providerId) => {
      const definition = getOAuthProviderDefinition(providerId);
      if (!definition) throw new Error(`Missing OAuth provider definition for ${providerId}`);
      let markRefreshStarted!: () => void;
      let releaseRefresh!: () => void;
      const refreshStarted = new Promise<void>((resolve) => {
        markRefreshStarted = resolve;
      });
      const refreshCanFinish = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const refreshToken = vi.spyOn(definition.provider, 'refreshToken').mockImplementation(async (current) => {
        expect(current).toMatchObject({ projectId: 'project-1', accountId: 'account-1' });
        markRefreshStarted();
        await refreshCanFinish;
        return {
          ...current,
          access: `access-token-2:${providerId}`,
          refresh: `refresh-token-2:${providerId}`,
          expires: Date.now() + 15 * 60_000,
        };
      });
      const resolver = new CredentialResolver();
      const store = new XopcModelCredentialStore(resolver);
      await resolver.saveOAuthToken(providerId, {
        access: `access-token-1:${providerId}`,
        refresh: `refresh-token-1:${providerId}`,
        expiresAt: Date.now() - 1,
        projectId: 'project-1',
        accountId: 'account-1',
        createdAt: '2026-08-04T00:00:00.000Z',
      });

      const resolverRefresh = resolver.loadOAuthToken(providerId);
      await refreshStarted;
      const runtimeRefresh = store.modify(providerId, async (current) => {
        expect(current).toMatchObject({
          type: 'oauth',
          access: `access-token-2:${providerId}`,
          refresh: `refresh-token-2:${providerId}`,
        });
        return undefined;
      });
      releaseRefresh();

      await expect(Promise.all([resolverRefresh, runtimeRefresh])).resolves.toEqual([
        expect.objectContaining({ access: `access-token-2:${providerId}` }),
        expect.objectContaining({ access: `access-token-2:${providerId}` }),
      ]);
      expect(refreshToken).toHaveBeenCalledOnce();
    },
  );

  it('rejects static credentials for the OAuth-only XOPC provider', async () => {
    const resolver = new CredentialResolver();
    await expect(resolver.saveApiKey('xopc-cloud', 'static-key')).rejects.toThrow(
      'xopc-cloud only supports OAuth credentials',
    );
  });
});
