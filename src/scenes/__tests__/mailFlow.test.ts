import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertKnowledgeSourceItems } from '../../storage/sqlite/index.js';
import { upsertConnectorInstallation, upsertConnectorConnection } from '../../storage/sqlite/connector-repository.js';
import { startKnowledgeSyncRun, finishKnowledgeSyncRun } from '../../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { SceneExecutionService } from '../execution.js';
import { SceneMailContextProvider } from '../mailContext.js';
import { SceneRepository } from '../repository.js';
import { SceneApplicationService } from '../service.js';
import { mailFollowUpTemplate } from '../templates.js';

describe('mail scene backend vertical slice', () => {
  it('starts, checks a real synchronized thread, and publishes one draft without calling a write tool', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-scene-mail-flow-'));
    resetXopcDatabaseSingletonForTest();
    try {
      openXopcDatabase({ path: join(directory, 'xopc.db') });
      const db = getSqliteDatabase();
      db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
      const now = Date.now();
      const principal = { ownerId: 'local-owner', workspaceId: directory };
      upsertConnectorInstallation({ id: 'mail-installation', connectorId: 'gmail', principalId: principal.ownerId,
        enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
      const connection = upsertConnectorConnection({ id: 'mail', installationId: 'mail-installation', connectorId: 'gmail',
        provider: 'composio', principalId: principal.ownerId, providerConnectionId: 'test-mail', identity: {}, status: 'active', isDefault: true, metadata: {} });
      const source = upsertKnowledgeSourceItems([{ sourceInstanceId: 'mail-source', collectionScope: 'inbox', externalId: 'first',
        itemType: 'email', occurredAt: new Date(now).toISOString(), contentHash: 'message-revision-1',
        normalizedText: JSON.stringify({ threadId: 'thread-1', content: 'Please confirm a review date.', labels: ['INBOX'] }),
        metadata: { workspaceId: directory, connectionId: connection.id }, sensitivity: 'personal', retentionClass: 'bounded',
        synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending' }]).items[0];
      const sync = startKnowledgeSyncRun({ sourceInstanceId: 'mail-source', collectionScope: 'inbox', nowMs: now });
      finishKnowledgeSyncRun({ runId: sync.id, status: 'succeeded', nowMs: now });
      const repository = new SceneRepository(db);
      repository.installTemplate(mailFollowUpTemplate);
      const provider = new SceneMailContextProvider(db, () => now);
      const permissions = { accountIds: [connection.accountId!], contextProviders: ['mail'], effectHandlers: [] };
      const authorize = async () => permissions;
      const application = new SceneApplicationService(repository, [provider], authorize, () => now);
      const activation = await application.start(principal, { templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
        goal: 'Get a confirmed review date', scope: { kind: 'objects', ids: [source.id] }, permissions }, 'start-one');
      application.check(principal, activation.id, 'check-one');
      const execute = vi.fn(async ({ evidence }) => ({ kind: 'artifact', summary: 'Could you confirm the review date?', evidenceIds: evidence.map((item) => item.id) }));
      const execution = new SceneExecutionService(repository, [provider], { execute }, authorize, () => now);
      expect(await execution.runNext('worker')).toBe('completed');
      const inbox = repository.listInbox(principal);
      expect(inbox).toHaveLength(1);
      expect(inbox[0].content).toMatchObject({ kind: 'artifact', evidenceIds: [source.id] });
      expect(execute).toHaveBeenCalledOnce();
      application.check(principal, activation.id, 'check-one');
      expect(await execution.runNext('worker')).toBe('idle');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(repository.getActivation(principal, activation.id).status).toBe('active');
    } finally {
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
    }
  });
});
