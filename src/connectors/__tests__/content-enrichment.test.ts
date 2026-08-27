import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  getMemoryRecord,
  getKnowledgeSourceItem,
  listKnowledgeSourceItems,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorInstallation,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { listConnectedContentCandidates, readConnectedContent } from '../content-enrichment.js';

describe('connected content enrichment', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-content-enrichment-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    upsertConnectorInstallation({
      id: 'composio-googledrive-local-owner',
      connectorId: 'composio-googledrive',
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'read',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    upsertConnectorConnection({
      id: 'drive-work',
      installationId: 'composio-googledrive-local-owner',
      connectorId: 'composio-googledrive',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'ca_drive_work',
      identity: { email: 'owner@example.com' },
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'googledrive', providerPrincipalId: 'provider-owner' },
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('reads only explicitly selected bounded content and indexes it', async () => {
    const sourceItem = upsertKnowledgeSourceItems([{
      sourceInstanceId: 'composio:composio-googledrive:drive-work',
      collectionScope: 'files',
      externalId: 'doc-1',
      itemType: 'cloud_document',
      contentHash: 'metadata-hash',
      normalizedText: JSON.stringify({ title: 'Atlas launch brief', mimeType: 'application/vnd.google-apps.document' }),
      metadata: {
        connectorId: 'composio-googledrive', connectionId: 'drive-work', toolkit: 'googledrive',
        agentId: 'main', workspaceId: 'workspace-main', mimeType: 'application/vnd.google-apps.document',
      },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'ignored',
    }]).items[0]!;
    expect(listConnectedContentCandidates({ agentId: 'main' })).toEqual([
      expect.objectContaining({ sourceItemId: sourceItem.id, title: 'Atlas launch brief' }),
    ]);

    const executeWithPolicy = vi.fn(async () => ({ decision: 'allowed' as const, result: {} as unknown }));
    const result = await readConnectedContent({
      sourceItemIds: [sourceItem.id],
      agentId: 'main',
      adapterFactory: (downloadDirectory) => ({
        executeWithPolicy: vi.fn(async (request) => {
          const path = join(downloadDirectory, 'atlas.txt');
          await writeFile(path, 'Atlas launches in September. Token sk-secretvalue123 must be redacted.', 'utf8');
          executeWithPolicy(request);
          return { decision: 'allowed' as const, result: { file: { uri: path } } };
        }),
      }),
    });

    expect(result).toMatchObject({ requested: 1, completed: 1, failed: [] });
    expect(executeWithPolicy).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ actionId: 'GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE' }),
      args: { fileId: 'doc-1', mimeType: 'text/plain' },
      confirmed: true,
    }));
    expect(getKnowledgeSourceItem(sourceItem.id)?.metadata.explicitContentRead).toBeUndefined();
    const contentItem = listKnowledgeSourceItems({ collectionScope: 'content-reads' })[0]!;
    expect(contentItem.metadata).toMatchObject({ explicitContentRead: true, sourceMetadataItemId: sourceItem.id });
    expect(contentItem.normalizedText).toContain('Atlas launches in September');
    expect(contentItem.normalizedText).not.toContain('sk-secretvalue123');
    expect(getMemoryRecord(`knowledge:${contentItem.id}`)?.content).toContain('Atlas launches in September');
    expect(listConnectedContentCandidates({ agentId: 'main' })).toEqual([]);
  });

  it('rejects oversized selections before contacting a connector', async () => {
    await expect(readConnectedContent({
      sourceItemIds: ['1', '2', '3', '4', '5', '6'],
      agentId: 'main',
    })).rejects.toThrow('Select between 1 and 5 source items.');
  });
});
