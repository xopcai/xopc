import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  getMemoryRecord,
  listKnowledgeSourceItems,
  listKnowledgeSyncRuns,
  listMemoryEvidence,
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

  it('stores read-only external results as normalized, active, cited knowledge', async () => {
    const executeWithPolicy = vi.fn(async () => ({
      decision: 'allowed' as const,
      result: { messages: [{ subject: 'Quarterly plan', apiKey: 'sk-this-must-never-enter-memory' }] },
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
    const memory = getMemoryRecord(result.recordId);
    expect(memory).toMatchObject({
      kind: 'workspace_fact',
      status: 'active',
      sensitivity: 'personal',
      source: { provider: 'composio-gmail' },
      tags: expect.arrayContaining(['connected-source', 'external', 'composio-gmail']),
    });
    expect(memory?.content).toContain('[REDACTED]');
    expect(memory?.content).not.toContain('sk-this-must-never-enter-memory');
    const [sourceItem] = listKnowledgeSourceItems();
    expect(sourceItem).toMatchObject({
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      synthesisStatus: 'completed',
      metadata: { connectorId: 'composio-gmail', connectionId: 'gmail-work' },
    });
    expect(listMemoryEvidence(result.recordId)[0]).toMatchObject({
      sourceItemId: sourceItem?.id,
      relation: 'derived_from',
    });
    expect(listKnowledgeSyncRuns()[0]).toMatchObject({
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      status: 'succeeded',
      itemsSeen: 1,
      itemsCreated: 1,
    });

    executeWithPolicy.mockResolvedValueOnce({
      decision: 'allowed' as const,
      result: { messages: [{ subject: 'Quarterly plan approved' }] },
    });
    const updated = await syncComposioResultToMemory({
      config: {} as Config,
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'quarterly plan' },
      agentId: 'main',
      adapter: { executeWithPolicy } as unknown as ComposioSessionsAdapter,
    });
    expect(updated.recordId).toBe(result.recordId);
    expect(listKnowledgeSourceItems()).toHaveLength(1);
    expect(listKnowledgeSyncRuns()[0]).toMatchObject({ itemsCreated: 0, itemsUpdated: 1 });
    expect(getMemoryRecord(updated.recordId)?.content).toContain('Quarterly plan approved');
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
