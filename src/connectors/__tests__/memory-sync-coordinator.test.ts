import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  finishKnowledgeSyncRun,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startKnowledgeSyncRun,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import { installConnector } from '../install.js';
import { syncDueMemorySources } from '../memory-sync-coordinator.js';
import { updateComposioMemorySyncProfile } from '../memory-sync-profile.js';

describe('connector memory sync coordinator', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-sync-coordinator-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('syncs due local sources and respects the configured interval', async () => {
    const config = {} as Config;
    await installConnector(config, 'local-files', {
      config: { rootPath: stateDir, autoSync: true, syncIntervalMinutes: 15 },
    });
    const syncSource = vi.fn(async () => ({
      connectorId: 'local-files',
      sourceInstanceId: 'local-folder:local-files',
      recordIds: [],
    }));
    const nowMs = Date.now();

    expect(await syncDueMemorySources({ config, agentId: 'main', nowMs, syncLocalSource: syncSource })).toEqual({
      eligible: 1,
      synced: 1,
      failed: 0,
    });

    const run = startKnowledgeSyncRun({ sourceInstanceId: 'local-folder:local-files' }, nowMs);
    finishKnowledgeSyncRun({ runId: run.id, status: 'succeeded' }, nowMs);
    expect(await syncDueMemorySources({ config, agentId: 'main', nowMs: nowMs + 60_000, syncLocalSource: syncSource })).toEqual({
      eligible: 1,
      synced: 0,
      failed: 0,
    });
    expect(await syncDueMemorySources({ config, agentId: 'main', nowMs: nowMs + 16 * 60_000, syncLocalSource: syncSource })).toEqual({
      eligible: 1,
      synced: 1,
      failed: 0,
    });
  });

  it('runs persisted Composio profiles and honors trigger opt-out', async () => {
    const config = {
      connectors: {
        instances: {
          'composio-gmail': {
            xopcConnector: { managed: true, enabled: true, connectorId: 'composio-gmail' },
            runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
          },
        },
      },
    } as Config;
    upsertConnectorInstallation({
      id: 'composio-gmail-local-owner',
      connectorId: 'composio-gmail',
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'read',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    upsertConnectorConnection({
      id: 'gmail-work',
      installationId: 'composio-gmail-local-owner',
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'ca_gmail',
      identity: { email: 'work@example.com' },
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'gmail' },
    });
    updateComposioMemorySyncProfile(config, 'composio-gmail', {
      enabled: true,
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'newer_than:1d' },
      agentId: 'main',
      connectionId: 'gmail-work',
      intervalMinutes: 15,
      triggerSync: true,
    });
    const syncComposioSource = vi.fn(async () => ({
      recordId: 'memory-1',
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_FETCH_EMAILS',
    }));

    expect(await syncDueMemorySources({
      config,
      agentId: 'main',
      toolkit: 'gmail',
      force: true,
      syncComposioSource,
    })).toEqual({ eligible: 1, synced: 1, failed: 0 });
    expect(syncComposioSource).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: 'composio-gmail',
      connectionId: 'gmail-work',
      arguments: { query: 'newer_than:1d' },
    }));

    updateComposioMemorySyncProfile(config, 'composio-gmail', {
      enabled: true,
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: {},
      agentId: 'main',
      intervalMinutes: 15,
      triggerSync: false,
    });
    expect(await syncDueMemorySources({
      config,
      agentId: 'main',
      toolkit: 'gmail',
      force: true,
      syncComposioSource,
    })).toEqual({ eligible: 0, synced: 0, failed: 0 });
  });
});
