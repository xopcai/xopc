import { describe, expect, it, vi } from 'vitest';

import { disconnectProvider } from '../provider-disconnect.js';

describe('disconnectProvider', () => {
  it('clears credentials, runtime, cloud catalog, and pooled sessions under one lock', async () => {
    const events: string[] = [];
    const deleteProviderCredential = vi.fn(async () => { events.push('credentials'); });
    const invalidateAuth = vi.fn(() => { events.push('auth-runtime'); });
    const clearCloudCatalog = vi.fn(async () => { events.push('catalog'); });
    const evictRunners = vi.fn(() => { events.push('runners'); });
    const withLock = vi.fn(async (_provider: string, operation: () => Promise<void>) => {
      events.push('lock:start');
      await operation();
      events.push('lock:end');
    });

    await disconnectProvider('XOPC-CLOUD', {
      resolver: { deleteProviderCredential }, invalidateAuth, clearCloudCatalog,
      evictRunners, withLock,
    });

    expect(events).toEqual([
      'lock:start', 'credentials', 'auth-runtime', 'catalog', 'runners', 'lock:end',
    ]);
    expect(deleteProviderCredential).toHaveBeenCalledWith('xopc-cloud');
  });

  it('refreshes the registry for non-cloud providers without clearing cloud state', async () => {
    const refreshModels = vi.fn();
    const clearCloudCatalog = vi.fn();
    await disconnectProvider('openai', {
      resolver: { deleteProviderCredential: vi.fn(async () => {}) },
      invalidateAuth: vi.fn(), clearCloudCatalog, refreshModels,
      evictRunners: vi.fn(), withLock: async (_provider, operation) => operation(),
    });

    expect(refreshModels).toHaveBeenCalledOnce();
    expect(clearCloudCatalog).not.toHaveBeenCalled();
  });
});
