import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialResolver } from '../../auth/credentials.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorConnection } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { activateComposioBackend, addComposioBackend, ensureComposioBackend, getComposioBackend, removeComposioBackend, resolveBackendKey } from '../composio-backends.js';

describe('explicit connection services', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { vi.unstubAllEnvs(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  const resolver = () => ({ resolveApiKey: vi.fn(async () => null), deleteProviderCredential: vi.fn(async () => {}) });

  it('bootstraps once and never silently falls back from missing BYOK credentials', async () => {
    vi.stubEnv('XOPC_COMPOSIO_API_KEY', 'test-key');
    const credentials = resolver();
    const backend = await ensureComposioBackend(credentials as unknown as CredentialResolver);
    expect(backend).toMatchObject({ mode: 'byok', credential_source: 'environment', credential_ref: 'XOPC_COMPOSIO_API_KEY' });
    expect(await resolveBackendKey(backend, credentials as unknown as CredentialResolver)).toBe('test-key');
    vi.stubEnv('XOPC_COMPOSIO_API_KEY', '');
    expect((await ensureComposioBackend(credentials as unknown as CredentialResolver)).id).toBe(backend.id);
    expect(await resolveBackendKey(backend, credentials as unknown as CredentialResolver)).toBeNull();
    expect(getComposioBackend()?.mode).toBe('byok');
  });

  it('requires switching and revoking accounts before deleting stored credentials', async () => {
    const credentials = resolver();
    const backend = addComposioBackend({ mode: 'byok', label: 'Work', credentialRef: 'project-work' });
    activateComposioBackend(backend.id);
    await expect(removeComposioBackend(backend.id, credentials as unknown as CredentialResolver)).rejects.toThrow('another connection service');
    const cloud = addComposioBackend({ mode: 'managed', label: 'Cloud' });
    activateComposioBackend(cloud.id);
    const connection = upsertConnectorConnection({ id: 'work', connectorId: 'composio-gmail', provider: 'composio',
      principalId: 'local-owner', providerConnectionId: 'ca-work', identity: {}, status: 'active', isDefault: false, metadata: {} });
    getSqliteDatabase().prepare('UPDATE connector_accounts SET backend_id = ? WHERE id = ?').run(backend.id, connection.accountId!);
    await expect(removeComposioBackend(backend.id, credentials as unknown as CredentialResolver)).rejects.toThrow('Disconnect');
    expect(credentials.deleteProviderCredential).not.toHaveBeenCalled();
    upsertConnectorConnection({ ...connection, status: 'revoked' });
    await removeComposioBackend(backend.id, credentials as unknown as CredentialResolver);
    expect(credentials.deleteProviderCredential).toHaveBeenCalledWith('project-work');
    expect(getComposioBackend(backend.id)).toBeUndefined();
  });
});
