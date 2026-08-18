import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthToken } from '../credentials.js';
import { XopcModelCredentialStore } from '../model-credential-store.js';

type ExtendedOAuthToken = OAuthToken & Record<string, unknown>;

let tempDir: string;
let previousCredentialsDir: string | undefined;

function oauthToken(overrides: Partial<ExtendedOAuthToken> = {}): ExtendedOAuthToken {
  return {
    type: 'oauth',
    provider: 'xopc-cloud',
    access: 'access-1',
    refresh: 'refresh-1',
    expiresAt: 1_800_000_000_000,
    scope: ['models:invoke'],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

function repository(initial: OAuthToken | null = oauthToken()) {
  let token = initial;
  return {
    deleteOAuthToken: vi.fn(async () => {
      token = null;
    }),
    listOAuthTokens: vi.fn(async () => token
      ? [{
          type: token.type,
          provider: token.provider,
          expiresAt: token.expiresAt,
          scope: token.scope,
          createdAt: token.createdAt,
          updatedAt: token.updatedAt,
          hasAccess: Boolean(token.access),
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

describe('XopcModelCredentialStore', () => {
  beforeEach(async () => {
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-model-credential-store-'));
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');
  });

  afterEach(async () => {
    if (previousCredentialsDir === undefined) {
      delete process.env.XOPC_CREDENTIALS_DIR;
    } else {
      process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('maps persisted OAuth tokens to canonical runtime credentials', async () => {
    const store = new XopcModelCredentialStore(repository());

    await expect(store.read('XOPC-CLOUD')).resolves.toEqual({
      type: 'oauth',
      access: 'access-1',
      refresh: 'refresh-1',
      expires: 1_800_000_000_000,
      scope: ['models:invoke'],
    });
  });

  it('persists rotating OAuth credentials without losing provider fields', async () => {
    const repo = repository(oauthToken({ tenantId: 'tenant-1' }));
    const store = new XopcModelCredentialStore(repo);
    const updated: OAuthCredential = {
      type: 'oauth',
      access: 'access-2',
      refresh: 'refresh-2',
      expires: 1_900_000_000_000,
      scope: ['models:invoke'],
    };

    await expect(store.modify('xopc-cloud', async () => updated)).resolves.toEqual(updated);
    expect(repo.saveOAuthToken).toHaveBeenCalledWith('xopc-cloud', {
      access: 'access-2',
      refresh: 'refresh-2',
      expiresAt: 1_900_000_000_000,
      scope: ['models:invoke'],
      tenantId: 'tenant-1',
      createdAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('serializes modifications for the same provider across store instances', async () => {
    const repo = repository();
    const firstStore = new XopcModelCredentialStore(repo);
    const secondStore = new XopcModelCredentialStore(repo);
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = firstStore.modify('xopc-cloud', async (current) => {
      order.push('first:start');
      await firstCanFinish;
      order.push('first:end');
      return current;
    });
    const second = secondStore.modify('xopc-cloud', async (current) => {
      order.push('second:start');
      return current;
    });

    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('leaves the stored credential unchanged when an updater returns undefined', async () => {
    const repo = repository();
    const store = new XopcModelCredentialStore(repo);

    await expect(store.modify('xopc-cloud', async () => undefined)).resolves.toMatchObject({
      type: 'oauth',
      access: 'access-1',
    });
    expect(repo.saveOAuthToken).not.toHaveBeenCalled();
  });

  it('keeps API keys in memory and does not expose secrets from list', async () => {
    const repo = repository(null);
    const store = new XopcModelCredentialStore(repo);
    const apiKey: Credential = { type: 'api_key', key: 'secret-key' };

    await store.modify('openai', async () => apiKey);

    await expect(store.read('openai')).resolves.toEqual(apiKey);
    await expect(store.list()).resolves.toEqual([{ providerId: 'openai', type: 'api_key' }]);
    expect(repo.saveOAuthToken).not.toHaveBeenCalled();
  });

  it('uses API keys as process-local overrides without deleting persisted OAuth', async () => {
    const repo = repository();
    const store = new XopcModelCredentialStore(repo);
    const apiKey: Credential = { type: 'api_key', key: 'secret-key' };

    await store.modify('anthropic', async () => apiKey);

    expect(repo.deleteOAuthToken).not.toHaveBeenCalled();
    await expect(store.read('anthropic')).resolves.toEqual(apiKey);
    await expect(new XopcModelCredentialStore(repo).read('anthropic')).resolves.toMatchObject({
      type: 'oauth',
      access: 'access-1',
    });
  });

  it('serializes deletion and removes both persisted and runtime credentials', async () => {
    const repo = repository();
    const store = new XopcModelCredentialStore(repo);

    await store.delete('xopc-cloud');

    expect(repo.deleteOAuthToken).toHaveBeenCalledWith('xopc-cloud');
    await expect(store.read('xopc-cloud')).resolves.toBeUndefined();
  });
});
