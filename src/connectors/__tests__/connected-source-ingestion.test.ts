import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
import { ingestComposioConnectedSource, ingestLocalFolderSource } from '../connected-source-ingestion.js';
import { installConnector } from '../install.js';

describe('connected source ingestion', () => {
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
      result: {
        messages: [{
          subject: 'Quarterly plan',
          sender: { email: 'lead@example.com' },
          attendees: [{ displayName: 'Planning Team', email: 'planning@example.com' }],
          apiKey: 'sk-this-must-never-enter-memory',
        }],
      },
    }));
    const result = await ingestComposioConnectedSource({
      config: {} as Config,
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'quarterly plan' },
      agentId: 'main',
      adapter: { executeWithPolicy } as unknown as ComposioSessionsAdapter,
    });
    expect(executeWithPolicy).toHaveBeenCalledOnce();
    const [recordId] = result.recordIds;
    const memory = getMemoryRecord(recordId!);
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
      itemType: 'email',
      synthesisStatus: 'completed',
      metadata: {
        connectorId: 'composio-gmail',
        connectionId: 'gmail-work',
        toolkit: 'gmail',
        people: ['lead@example.com', 'planning@example.com', 'Planning Team'],
      },
    });
    expect(listMemoryEvidence(recordId!)[0]).toMatchObject({
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
    const updated = await ingestComposioConnectedSource({
      config: {} as Config,
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'quarterly plan' },
      agentId: 'main',
      adapter: { executeWithPolicy } as unknown as ComposioSessionsAdapter,
    });
    expect(updated.recordIds).toEqual([recordId]);
    expect(listKnowledgeSourceItems()).toHaveLength(1);
    expect(listKnowledgeSyncRuns()[0]).toMatchObject({ itemsCreated: 0, itemsUpdated: 1 });
    expect(getMemoryRecord(recordId!)?.content).toContain('Quarterly plan approved');
  });

  it('rejects write actions from the memory ingestion path', async () => {
    await expect(ingestComposioConnectedSource({
      config: {} as Config,
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_SEND_EMAIL',
      agentId: 'main',
      adapter: {} as ComposioSessionsAdapter,
    })).rejects.toThrow(/read action/);
  });

  it('syncs curated GitHub activity through the shared knowledge source adapter', async () => {
    upsertConnectorInstallation({
      id: 'composio-github-local-owner',
      connectorId: 'composio-github',
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'read',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    upsertConnectorConnection({
      id: 'github-work',
      installationId: 'composio-github-local-owner',
      connectorId: 'composio-github',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'ca_github',
      identity: { username: 'octocat' },
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'github' },
    });
    const executeWithPolicy = vi.fn(async () => ({
      decision: 'allowed' as const,
      result: { items: [{ id: 'commit-1', message: 'Ship connected source learning' }] },
    }));

    await ingestComposioConnectedSource({
      config: {} as Config,
      connectorId: 'composio-github',
      actionId: 'GITHUB_LIST_COMMITS',
      arguments: { owner: 'xopc-ai', repo: 'xopc' },
      agentId: 'main',
      adapter: { executeWithPolicy } as unknown as ComposioSessionsAdapter,
    });

    expect(listKnowledgeSourceItems()).toContainEqual(expect.objectContaining({
      sourceInstanceId: 'composio:composio-github:github-work',
      externalId: 'commit-1',
      itemType: 'development_activity',
      metadata: expect.objectContaining({ connectorId: 'composio-github' }),
    }));
  });

  it('normalizes Linear issues as work context', async () => {
    upsertConnectorInstallation({
      id: 'composio-linear-local-owner',
      connectorId: 'composio-linear',
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'read',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    upsertConnectorConnection({
      id: 'linear-work',
      installationId: 'composio-linear-local-owner',
      connectorId: 'composio-linear',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'ca_linear',
      identity: { workspace: 'xopc' },
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'linear' },
    });
    const executeWithPolicy = vi.fn(async () => ({
      decision: 'allowed' as const,
      result: { items: [{ id: 'XOPC-42', title: 'Build the connector knowledge pipeline', assignee: { email: 'owner@example.com' } }] },
    }));

    await ingestComposioConnectedSource({
      config: {} as Config,
      connectorId: 'composio-linear',
      actionId: 'LINEAR_LIST_ISSUES',
      agentId: 'main',
      adapter: { executeWithPolicy } as unknown as ComposioSessionsAdapter,
    });

    expect(listKnowledgeSourceItems()).toContainEqual(expect.objectContaining({
      sourceInstanceId: 'composio:composio-linear:linear-work',
      externalId: 'XOPC-42',
      itemType: 'work_item',
      metadata: expect.objectContaining({ people: ['owner@example.com'] }),
    }));
  });

  it('ingests an installed local knowledge folder end to end', async () => {
    const notesPath = join(stateDir, 'notes');
    mkdirSync(notesPath);
    writeFileSync(join(notesPath, 'profile.md'), '# Preferences\nThe user prefers concise status updates.');
    const config = {} as Config;
    await installConnector(config, 'local-files', { config: { rootPath: notesPath } });

    const result = await ingestLocalFolderSource({ config, connectorId: 'local-files', agentId: 'main' });

    expect(result.recordIds).toHaveLength(1);
    expect(listKnowledgeSourceItems()).toContainEqual(expect.objectContaining({
      sourceInstanceId: 'local-folder:local-files',
      externalId: 'profile.md',
      itemType: 'local_file',
    }));
    expect(getMemoryRecord(result.recordIds[0]!)).toMatchObject({
      status: 'active',
      sensitivity: 'personal',
    });

    unlinkSync(join(notesPath, 'profile.md'));
    await ingestLocalFolderSource({ config, connectorId: 'local-files', agentId: 'main' });

    expect(listKnowledgeSourceItems({ includeDeleted: true })).toContainEqual(expect.objectContaining({
      externalId: 'profile.md',
      synthesisStatus: 'ignored',
      deletedAt: expect.any(String),
    }));
    expect(getMemoryRecord(result.recordIds[0]!)?.status).toBe('archived');

    const restoredPath = join(notesPath, 'profile.md');
    writeFileSync(restoredPath, '# Preferences\nThe user prefers concise status updates and weekly summaries.');
    const future = new Date(Date.now() + 1_000);
    utimesSync(restoredPath, future, future);
    await ingestLocalFolderSource({ config, connectorId: 'local-files', agentId: 'main' });

    expect(listKnowledgeSourceItems()).toContainEqual(expect.objectContaining({
      externalId: 'profile.md',
      synthesisStatus: 'completed',
    }));
    expect(listKnowledgeSourceItems()[0]?.deletedAt).toBeUndefined();
    expect(getMemoryRecord(result.recordIds[0]!)?.status).toBe('active');
  });
});
