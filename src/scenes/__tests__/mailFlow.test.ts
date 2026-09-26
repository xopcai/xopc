import { mkdtempSync, rmSync } from 'node:fs';
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
import { SceneCapabilityRegistry } from '../registry.js';
import { mailFollowUpTemplate } from '../templates.js';
import { SceneMailObservationService } from '../mailObservations.js';
import { SceneRuntime } from '../runtime.js';

describe('mail scene backend vertical slice', () => {
  it('starts, checks a real synchronized thread, and publishes one draft without calling a write tool', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-scene-mail-flow-'));
    let runtime: SceneRuntime | undefined;
    resetXopcDatabaseSingletonForTest();
    try {
      openXopcDatabase({ path: join(directory, 'xopc.db') });
      const db = getSqliteDatabase();

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
      const application = new SceneApplicationService(repository, new SceneCapabilityRegistry([provider]), authorize, () => now);
      const activation = await application.start(principal, { templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
        goal: 'Get a confirmed review date', scope: { kind: 'objects', ids: [source.id] }, permissions }, 'start-one');
      application.check(principal, activation.id, 'check-one');
      const execute = vi.fn(async ({ evidence }) => ({ kind: 'artifact', summary: 'Could you confirm the review date?', evidenceIds: evidence.map((item) => item.id) }));
      const execution = new SceneExecutionService(repository, new SceneCapabilityRegistry([provider]), { execute }, authorize, () => now);
      expect(await execution.runNext('worker')).toBe('completed');
      const inbox = repository.listInbox(principal);
      expect(inbox).toHaveLength(1);
      expect(inbox[0].content).toMatchObject({ kind: 'artifact', evidenceIds: [source.id] });
      expect(execute).toHaveBeenCalledOnce();
      application.check(principal, activation.id, 'check-one');
      expect(await execution.runNext('worker')).toBe('idle');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(repository.getActivation(principal, activation.id).status).toBe('active');

      repository.createWorkItem(principal, activation.id, { subjectId: source.id, accountId: connection.accountId!, dueAt: now + 86_400_000 }, now);
      const observations = new SceneMailObservationService(repository, provider, authorize, () => now);
      runtime = new SceneRuntime(repository, execution, observations, () => now);
      await runtime.tick();
      expect(execute).toHaveBeenCalledOnce();
      upsertKnowledgeSourceItems([{ sourceInstanceId: 'mail-source', collectionScope: 'inbox', externalId: 'reply',
        itemType: 'email', occurredAt: new Date(now).toISOString(), contentHash: 'reply-revision-1',
        normalizedText: JSON.stringify({ threadId: 'thread-1', content: 'Could we review it on Friday?', labels: ['INBOX'] }),
        metadata: { workspaceId: directory, connectionId: connection.id }, sensitivity: 'personal', retentionClass: 'bounded',
        synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending' }]);
      await runtime.tick();
      expect(repository.listInbox(principal)).toEqual([]);
      await runtime.tick(); await runtime.tick();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(repository.listInbox(principal)).toHaveLength(1);
      expect(repository.listInbox(principal)[0].content.evidenceIds).toHaveLength(2);
      await runtime.stop();
      runtime = new SceneRuntime(repository, execution, observations, () => now);
      await runtime.tick();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    } finally {
      await runtime?.stop();
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
    }
  });
});
