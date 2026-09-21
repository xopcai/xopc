import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialResolver } from '../../auth/credentials.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { listComposioBackends } from '../composio-backends.js';
import { configureComposioApiKey } from '../composio.js';

const directRuntime = vi.hoisted(() => ({
  createSession: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock('@composio/core', () => ({
  Composio: class MockComposio {
    readonly sessions = { create: directRuntime.createSession };
    readonly connectedAccounts = {
      list: directRuntime.listAccounts,
      delete: vi.fn(),
      refresh: vi.fn(),
    };
  },
}));

describe('Composio project setup', () => {
  beforeEach(() => {
    directRuntime.createSession.mockReset();
    directRuntime.listAccounts.mockReset();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('validates with a read-only API before saving the key', async () => {
    directRuntime.listAccounts.mockResolvedValue({ items: [] });
    const saveApiKey = vi.fn().mockResolvedValue(undefined);
    const resolver = {
      resolveApiKey: vi.fn().mockResolvedValue(null),
      saveApiKey,
    } as unknown as CredentialResolver;

    await configureComposioApiKey('new-project-key', resolver);

    expect(directRuntime.listAccounts).toHaveBeenCalledOnce();
    expect(directRuntime.createSession).not.toHaveBeenCalled();
    expect(saveApiKey).toHaveBeenCalledOnce();
    expect(directRuntime.listAccounts.mock.invocationCallOrder[0])
      .toBeLessThan(saveApiKey.mock.invocationCallOrder[0]!);
    expect(listComposioBackends()).toHaveLength(2);
  });

  it('does not save or register a key when read-only validation fails', async () => {
    directRuntime.listAccounts.mockRejectedValue(new Error('invalid API key'));
    const saveApiKey = vi.fn().mockResolvedValue(undefined);
    const resolver = {
      resolveApiKey: vi.fn().mockResolvedValue(null),
      saveApiKey,
    } as unknown as CredentialResolver;

    await expect(configureComposioApiKey('invalid-key', resolver)).rejects.toThrow('invalid API key');

    expect(directRuntime.createSession).not.toHaveBeenCalled();
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(listComposioBackends()).toEqual([]);
  });
});
