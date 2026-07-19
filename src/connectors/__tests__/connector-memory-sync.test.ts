import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  getMemoryRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import type { ComposioSessionsAdapter } from '../composio-sessions.js';
import { syncComposioResultToMemory } from '../connector-memory-sync.js';

describe('connector memory sync', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-connector-memory-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
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
      providerConnectionId: 'ca_work',
      identity: { email: 'work@example.com' },
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'gmail' },
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores read-only external results as reviewable cited memory', async () => {
    const executeWithPolicy = vi.fn(async () => ({
      decision: 'allowed' as const,
      result: { messages: [{ subject: 'Quarterly plan' }] },
    }));
    const result = await syncComposioResultToMemory({
      config: {} as Config,
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'quarterly plan' },
      agentId: 'main',
      adapter: { executeWithPolicy } as unknown as ComposioSessionsAdapter,
    });
    expect(executeWithPolicy).toHaveBeenCalledOnce();
    expect(getMemoryRecord(result.recordId)).toMatchObject({
      kind: 'workspace_fact',
      status: 'needs_review',
      sensitivity: 'normal',
      source: { provider: 'composio-gmail' },
      tags: expect.arrayContaining(['connector', 'external', 'gmail']),
    });
  });

  it('rejects write actions from the memory ingestion path', async () => {
    await expect(syncComposioResultToMemory({
      config: {} as Config,
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_SEND_EMAIL',
      agentId: 'main',
      adapter: {} as ComposioSessionsAdapter,
    })).rejects.toThrow(/read action/);
  });
});
