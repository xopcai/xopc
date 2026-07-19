import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  listConnectorConnections,
  listConnectorExecutionAudit,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
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
});
