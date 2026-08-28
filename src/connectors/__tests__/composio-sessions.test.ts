import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  listConnectorAccounts,
  listConnectorConnections,
  listConnectorExecutionAudit,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import {
  ComposioSessionsAdapter,
  createComposioPrincipalId,
  type ComposioSessionLike,
  type ComposioSessionsClient,
} from '../composio-sessions.js';

describe('ComposioSessionsAdapter', () => {
  let stateDir: string;
  let session: ComposioSessionLike;
  let client: ComposioSessionsClient;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-composio-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    session = {
      sessionId: 'session-1',
      toolkits: vi.fn(async () => ({
        items: [{
          slug: 'gmail',
          name: 'Gmail',
          logo: 'https://logos.composio.dev/api/gmail',
          isNoAuth: false,
          connection: { isActive: false },
        }],
      })),
      authorize: vi.fn(async () => ({
        id: 'ca_pending',
        status: 'INITIATED',
        redirectUrl: 'https://connect.example.test/gmail',
      })),
      search: vi.fn(async () => ({ items: [] })),
      execute: vi.fn(async () => ({ successful: true })),
    };
    client = {
      sessions: { create: vi.fn(async () => session) },
      connectedAccounts: {
        list: vi.fn(async () => ({ items: [] })),
        delete: vi.fn(async () => ({})),
        refresh: vi.fn(async () => ({})),
      },
      authConfigs: {
        list: vi.fn(async () => ({ items: [] })),
      },
      toolkits: {
        get: vi.fn(async () => ({ composioManagedAuthSchemes: ['OAUTH2'], authConfigDetails: [{}] })),
      },
    };
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('uses stable opaque provider identities', () => {
    const first = createComposioPrincipalId('owner@example.com', stateDir);
    expect(first).toBe(createComposioPrincipalId('owner@example.com', stateDir));
    expect(first).not.toContain('owner@example.com');
    expect(first).not.toBe(createComposioPrincipalId('other@example.com', stateDir));
  });

  it('lists dynamic catalog metadata and persists pending authorization', async () => {
    const adapter = new ComposioSessionsAdapter({ clientFactory: async () => client });
    await expect(adapter.listToolkitCatalog({ principalId: 'owner', installationScope: stateDir })).resolves.toEqual([
      expect.objectContaining({ slug: 'gmail', name: 'Gmail', connected: false }),
    ]);
    expect(session.toolkits).toHaveBeenCalledWith({ limit: 50, cursor: undefined });
    const authorization = await adapter.authorize({
      principalId: 'owner',
      installationScope: stateDir,
      toolkit: 'gmail',
      installationId: 'install-1',
      alias: 'Work',
    });
    expect(authorization.connectUrl).toBe('https://connect.example.test/gmail');
    expect(listConnectorConnections({ principalId: 'owner' })[0]).toMatchObject({
      providerConnectionId: 'ca_pending',
      alias: 'Work',
      status: 'pending',
    });
  });

  it('discovers custom auth requirements and passes an explicit auth config to the session', async () => {
    client.toolkits!.get = vi.fn(async () => ({ composioManagedAuthSchemes: [], authConfigDetails: [{}] }));
    client.authConfigs!.list = vi.fn(async () => ({
      items: [{
        id: 'ac_twitter',
        name: 'Twitter OAuth',
        status: 'ENABLED',
        authScheme: 'OAUTH2',
        isComposioManaged: false,
        isEnabledForToolRouter: true,
      }],
    }));
    const adapter = new ComposioSessionsAdapter({ clientFactory: async () => client });

    await expect(adapter.getToolkitAuthState('Twitter')).resolves.toEqual({
      toolkit: 'twitter',
      managedAuthAvailable: false,
      requiresCustomAuthConfig: true,
      authConfigs: [expect.objectContaining({ id: 'ac_twitter', isEnabledForToolRouter: true })],
    });
    await adapter.authorize({
      principalId: 'owner',
      installationScope: stateDir,
      toolkit: 'twitter',
      authConfigId: 'ac_twitter',
    });

    expect(client.sessions.create).toHaveBeenLastCalledWith(
      expect.stringMatching(/^xopc_/),
      expect.objectContaining({
        toolkits: { enable: ['twitter'] },
        authConfigs: { twitter: 'ac_twitter' },
      }),
    );
    expect(listConnectorConnections({ principalId: 'owner' })[0]?.metadata).toMatchObject({
      authConfigId: 'ac_twitter',
    });
  });

  it('turns Tool Router missing-auth failures into an actionable connector error', async () => {
    client.sessions.create = vi.fn(async () => {
      throw new Error('The following toolkits require auth configs but none exist and cannot be auto-created: twitter.');
    });
    const adapter = new ComposioSessionsAdapter({ clientFactory: async () => client });

    await expect(adapter.authorize({
      principalId: 'owner',
      installationScope: stateDir,
      toolkit: 'twitter',
    })).rejects.toThrow('requires a custom auth config');
  });

  it('groups provider authorizations that resolve to the same account identity', async () => {
    client.connectedAccounts.list = vi.fn(async () => ({
      items: [
        {
          id: 'ca_old',
          status: 'ACTIVE',
          createdAt: '2026-08-01T00:00:00.000Z',
          toolkit: { slug: 'gmail' },
          connectionData: { emailAddress: 'owner@example.com' },
        },
        {
          id: 'ca_new',
          status: 'ACTIVE',
          createdAt: '2026-08-02T00:00:00.000Z',
          toolkit: { slug: 'gmail' },
          connectionData: { emailAddress: 'OWNER@example.com' },
        },
      ],
    }));
    const adapter = new ComposioSessionsAdapter({ clientFactory: async () => client });

    const connections = await adapter.syncConnections({ principalId: 'owner', installationScope: stateDir });

    expect(new Set(connections.map((connection) => connection.accountId)).size).toBe(1);
    expect(listConnectorAccounts({ principalId: 'owner', connectorId: 'composio-gmail' })).toEqual([
      expect.objectContaining({
        identityKey: 'gmail:owner@example.com',
        currentConnectionId: 'composio-ca_new',
      }),
    ]);
  });

  it('does not execute writes before confirmation and audits both decisions', async () => {
    const installation = upsertConnectorInstallation({
      id: 'install-1',
      connectorId: 'composio-gmail',
      principalId: 'owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'write',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    const adapter = new ComposioSessionsAdapter({ clientFactory: async () => client });
    const action = {
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_SEND_EMAIL',
      toolkit: 'gmail',
      scope: 'write' as const,
      curated: true,
      cachedAt: new Date().toISOString(),
    };

    await expect(adapter.executeWithPolicy({
      context: { principalId: 'owner', installationScope: stateDir },
      installation,
      action,
      agentId: 'main',
    })).resolves.toMatchObject({ decision: 'confirmation_required' });
    expect(session.execute).not.toHaveBeenCalled();

    await expect(adapter.executeWithPolicy({
      context: { principalId: 'owner', installationScope: stateDir },
      installation,
      action,
      agentId: 'main',
      confirmed: true,
    })).resolves.toMatchObject({ decision: 'allowed' });
    expect(session.execute).toHaveBeenCalledWith('GMAIL_SEND_EMAIL', {}, undefined);
    expect(listConnectorExecutionAudit({ principalId: 'owner' }).map((row) => row.decision)).toEqual([
      'allowed',
      'confirmation_required',
    ]);
  });

  it('executes a connection with the provider identity that owns the account', async () => {
    const installation = upsertConnectorInstallation({
      id: 'install-1',
      connectorId: 'composio-gmail',
      principalId: 'owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'read',
      confirmationPolicy: 'never',
      selectedConnectionIds: [],
    });
    const connection = upsertConnectorConnection({
      id: 'gmail-work',
      installationId: installation.id,
      connectorId: installation.connectorId,
      provider: 'composio',
      principalId: 'owner',
      providerConnectionId: 'ca_work',
      identity: {},
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'gmail', providerPrincipalId: 'xopc_provider_owner' },
    });
    const adapter = new ComposioSessionsAdapter({ clientFactory: async () => client });

    await expect(adapter.executeWithPolicy({
      context: { principalId: 'owner', installationScope: stateDir },
      installation,
      connection,
      action: {
        connectorId: installation.connectorId,
        actionId: 'GMAIL_FETCH_EMAILS',
        toolkit: 'gmail',
        scope: 'read',
        curated: true,
        cachedAt: new Date().toISOString(),
      },
      agentId: 'main',
      confirmed: true,
    })).resolves.toMatchObject({ decision: 'allowed' });

    expect(client.sessions.create).toHaveBeenCalledWith('xopc_provider_owner', expect.any(Object));
    expect(session.execute).toHaveBeenCalledWith('GMAIL_FETCH_EMAILS', {}, { account: 'ca_work' });
  });
});
